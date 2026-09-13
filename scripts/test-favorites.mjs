#!/usr/bin/env node
// Favorites lib unit tests: toggle/dedupe/star state/recents cap & ordering.
// Run: node scripts/test-favorites.mjs

import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const outDir = mkdtempSync(path.join(tmpdir(), 'janus-fav-test-'))
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
    `--alias:@shared=${path.join(root, 'src/shared')}`,
    `--outfile=${path.join(outDir, 'favorites.mjs')}`,
    path.join(root, 'src/renderer/src/lib/favorites.ts')
  ],
  { stdio: 'pipe' }
)
const { toggleFavorite, removeFavorite, isFavorite, recordRecent, sameTarget, favoriteDisplayName, folderViewTabId, RECENT_CAP } =
  await import(path.join(outDir, 'favorites.mjs'))

const LOCAL = { kind: 'local' }
const SSH1 = { kind: 'ssh', serverId: 's1' }
const SSH2 = { kind: 'ssh', serverId: 's2' }
let seq = 0
const makeId = () => `id${++seq}`

console.log('[favorites] target equality & star toggle')
{
  ok('local targets equal', sameTarget(LOCAL, { kind: 'local' }))
  ok('ssh equality needs serverId', sameTarget(SSH1, { kind: 'ssh', serverId: 's1' }) && !sameTarget(SSH1, SSH2))
  ok('kind mismatch never equal', !sameTarget(LOCAL, SSH1))

  let list = []
  list = toggleFavorite(list, SSH1, '/data', 'data', makeId)
  ok('add favorite', list.length === 1 && isFavorite(list, SSH1, '/data'))
  ok('same path on another server is NOT favorite', !isFavorite(list, SSH2, '/data'))
  ok('same path locally is NOT favorite', !isFavorite(list, LOCAL, '/data'))
  list = toggleFavorite(list, SSH1, '/data', 'data', makeId)
  ok('toggle again removes', list.length === 0)
  list = toggleFavorite(list, SSH1, '/data', 'data', makeId)
  list = toggleFavorite(list, SSH2, '/data', 'data', makeId)
  ok('same path different servers coexist', list.length === 2)
  list = removeFavorite(list, 'id2')
  ok('removeFavorite by id', list.length === 1 && list[0].id === 'id3')
}

console.log('[favorites] display name')
{
  ok('given name wins', favoriteDisplayName({ name: 'Movies', path: '/data/movies' }) === 'Movies')
  ok('falls back to last segment', favoriteDisplayName({ name: '', path: '/data/movies' }) === 'movies')
  ok('root falls back to /', favoriteDisplayName({ name: '', path: '/' }) === '/')
}

console.log('[favorites] recents: dedupe, ordering, cap')
{
  let rec = []
  rec = recordRecent(rec, SSH1, '/a', 1)
  rec = recordRecent(rec, LOCAL, '/b', 2)
  rec = recordRecent(rec, SSH1, '/a', 3)
  ok('revisit moves to front without duplicating', rec.length === 2 && rec[0].path === '/a' && rec[0].openedAt === 3)
  ok('same path on different target kept separate', recordRecent(rec, SSH2, '/a', 4).length === 3)
  rec = recordRecent(rec, SSH1, '', 5)
  ok('empty path ignored', rec.length === 2)

  let big = []
  for (let i = 0; i < 60; i++) big = recordRecent(big, LOCAL, `/dir-${i}`, i)
  ok(`caps at ${RECENT_CAP}`, big.length === RECENT_CAP)
  ok('keeps most recent, drops oldest', big[0].path === '/dir-59' && !big.some((r) => r.path === '/dir-9'))
}

console.log('[favorites] pseudo tab ids')
{
  ok('favorite id direct', folderViewTabId({ kind: 'favorite', id: 'abc' }) === 'fav-abc')
  const a = folderViewTabId({ kind: 'recent', target: SSH1, path: '/x' })
  const b = folderViewTabId({ kind: 'recent', target: SSH2, path: '/x' })
  const c = folderViewTabId({ kind: 'recent', target: LOCAL, path: '/x' })
  ok('recent ids unique per target', a !== b && a !== c && b !== c)
  ok('recent ids stable', a === folderViewTabId({ kind: 'recent', target: { kind: 'ssh', serverId: 's1' }, path: '/x' }))
}

rmSync(outDir, { recursive: true, force: true })
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
