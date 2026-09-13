#!/usr/bin/env node
// Player unit tests: natural episode ordering + video-file filtering +
// progress store v1→v2 migration semantics (shared/media.ts is pure).
// Run: node scripts/test-player.mjs

import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const outDir = mkdtempSync(path.join(tmpdir(), 'janus-player-test-'))
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

execFileSync(
  path.join(root, 'node_modules', '.bin', 'esbuild'),
  [
    '--bundle',
    '--platform=node',
    '--format=esm',
    `--outfile=${path.join(outDir, 'media.mjs')}`,
    path.join(root, 'src/shared/media.ts')
  ],
  { stdio: 'pipe' }
)
const { naturalCompare, isVideoFile } = await import(path.join(outDir, 'media.mjs'))

console.log('[player] natural ordering')
{
  const sorted = (arr) => [...arr].sort(naturalCompare)
  ok(
    'E1 < E2 < E10',
    JSON.stringify(sorted(['E10.mp4', 'E2.mp4', 'E1.mp4'])) === JSON.stringify(['E1.mp4', 'E2.mp4', 'E10.mp4'])
  )
  ok(
    'S01E01 < S01E02 < S01E10',
    JSON.stringify(sorted(['show.S01E10.1080p.mp4', 'show.S01E02.1080p.mp4', 'show.S01E01.1080p.mp4'])) ===
      JSON.stringify(['show.S01E01.1080p.mp4', 'show.S01E02.1080p.mp4', 'show.S01E10.1080p.mp4'])
  )
  ok(
    '第1集 < 第2集 < 第10集',
    JSON.stringify(sorted(['第10集.mp4', '第2集.mp4', '第1集.mp4'])) === JSON.stringify(['第1集.mp4', '第2集.mp4', '第10集.mp4'])
  )
  ok(
    'mixed names keep alpha order',
    JSON.stringify(sorted(['b.mp4', 'A.mp4'])) === JSON.stringify(['A.mp4', 'b.mp4'])
  )
}

console.log('[player] video-file filtering')
{
  ok('mp4/mkv/webm accepted', isVideoFile('a.mp4') && isVideoFile('b.MKV') && isVideoFile('c.webm'))
  ok('txt/srt/nfo rejected', !isVideoFile('a.txt') && !isVideoFile('b.srt') && !isVideoFile('c.nfo'))
  ok('no extension rejected', !isVideoFile('README'))
  ok('dotfile without name rejected', !isVideoFile('.mp4'))
}

console.log('[player] progress migration semantics (v1 number → v2 object)')
{
  // Mirror of readProgressMap() normalization in src/main/media.ts.
  const normalize = (raw) => {
    const out = {}
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = { t: v, at: 0 }
      else if (v && typeof v === 'object' && typeof v.t === 'number') out[k] = v
    }
    return out
  }
  const legacy = JSON.stringify({ '/a/b.mp4': 123.4, 'srv:/c.mp4': { t: 5, d: 100, done: true, at: 9 } })
  const map = normalize(JSON.parse(legacy))
  ok('v1 seconds migrates to entry', map['/a/b.mp4'].t === 123.4 && map['/a/b.mp4'].at === 0)
  ok('v2 entry preserved', map['srv:/c.mp4'].done === true && map['srv:/c.mp4'].d === 100)
}

rmSync(outDir, { recursive: true, force: true })
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
