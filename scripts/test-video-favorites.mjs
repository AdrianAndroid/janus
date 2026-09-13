#!/usr/bin/env node
// Video favorites + timefmt unit tests.
// Run: node scripts/test-video-favorites.mjs

import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const outDir = mkdtempSync(path.join(tmpdir(), 'janus-vfav-test-'))
let passed = 0
let failed = 0
function ok(name, cond, extra = '') {
  if (cond) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.error(`  ✗ ${name} ${extra}`)
  }
}

const esbuild = path.join(root, 'node_modules', '.bin', 'esbuild')
const alias = `--alias:@shared=${path.join(root, 'src/shared')}`
execFileSync(esbuild, ['--bundle', '--platform=node', '--format=esm', alias, `--outfile=${path.join(outDir, 'vf.mjs')}`, path.join(root, 'src/shared/video-favorites.ts')], { stdio: 'pipe' })
execFileSync(esbuild, ['--bundle', '--platform=node', '--format=esm', alias, `--outfile=${path.join(outDir, 'tf.mjs')}`, path.join(root, 'src/shared/timefmt.ts')], { stdio: 'pipe' })
const { toggleVideoFav, removeVideoFav, isVideoFav, mergeProgress, favoriteKeys } = await import(path.join(outDir, 'vf.mjs'))
const { fmtShort, fmtFull } = await import(path.join(outDir, 'tf.mjs'))

let seq = 0
const makeId = () => `v${++seq}`

console.log('[video-favorites] toggle / identity')
{
  let list = []
  let fav
  ;[list, fav] = toggleVideoFav(list, 'srv1', '/data/a.mkv', 'a.mkv', makeId)
  ok('add returns favorited=true', fav === true && list.length === 1)
  ok('isVideoFav by server+path', isVideoFav(list, 'srv1', '/data/a.mkv'))
  ok('same path different server not fav', !isVideoFav(list, 'srv2', '/data/a.mkv'))
  ok('same path local not fav', !isVideoFav(list, undefined, '/data/a.mkv'))
  ;[list, fav] = toggleVideoFav(list, 'srv1', '/data/a.mkv', 'a.mkv', makeId)
  ok('toggle again removes (false)', fav === false && list.length === 0)
  ;[list] = toggleVideoFav(list, undefined, '/home/m.mp4', 'm.mp4', makeId)
  ok('local favorite coexists with remote', isVideoFav(list, undefined, '/home/m.mp4'))
  list = removeVideoFav(list, 'v2')
  ok('remove by id', list.length === 0)
}

console.log('[video-favorites] mergeProgress & favoriteKeys')
{
  let list = []
  ;[list] = toggleVideoFav(list, 'srv1', '/data/a.mkv', 'a.mkv', makeId)
  ;[list] = toggleVideoFav(list, undefined, '/b.mp4', 'b.mp4', makeId)
  const progress = {
    'srv1:/data/a.mkv': { t: 120, at: 1000, done: false },
    '/b.mp4': { t: 0, at: 0 },
    'srv1:/data/other.mkv': { t: 5, at: 999 }
  }
  const merged = mergeProgress(list, progress)
  ok('watched time merged', merged.find((m) => m.name === 'a.mkv').lastWatchedAt === 1000)
  ok('resume time merged', merged.find((m) => m.name === 'a.mkv').resumeT === 120)
  ok('at=0 means never watched', merged.find((m) => m.name === 'b.mp4').lastWatchedAt === undefined)
  ok('unrelated progress ignored', !merged.some((m) => m.name === 'other.mkv'))
  ok('addedAt desc order', merged[0].addedAt >= merged[1].addedAt)
  ok('favoriteKeys format', JSON.stringify(favoriteKeys(list)) === JSON.stringify(['srv1:/data/a.mkv', '/b.mp4']))
}

console.log('[timefmt] short & full (fixed epochs, TZ-agnostic)')
{
  const now = new Date(2026, 8, 13, 15, 0, 0) // local 2026-09-13 15:00
  const sameDay = new Date(2026, 8, 13, 9, 5, 0).getTime()
  const sameYear = new Date(2026, 0, 2, 8, 30, 0).getTime()
  const older = new Date(2024, 11, 31, 23, 59, 0).getTime()
  ok('same day → HH:mm', fmtShort(sameDay, now) === '09:05', fmtShort(sameDay, now))
  ok('same year → MM-DD HH:mm', fmtShort(sameYear, now) === '01-02 08:30', fmtShort(sameYear, now))
  ok('older → YY-MM-DD', fmtShort(older, now) === '24-12-31', fmtShort(older, now))
  ok('zero/invalid → —', fmtShort(0, now) === '—' && fmtShort(NaN, now) === '—')
  const full = fmtFull(sameDay)
  ok('full → YYYY-MM-DD HH:mm:ss', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(full), full)
  ok('full zero → —', fmtFull(0) === '—')
}

rmSync(outDir, { recursive: true, force: true })
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
