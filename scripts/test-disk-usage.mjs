#!/usr/bin/env node
// Disk Usage smoke/unit tests: NDJSON protocol parser, path guards, index
// store, and the Python remote helper against an isolated fixture directory.
// Run: node scripts/test-disk-usage.mjs

import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, readdirSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const outDir = mkdtempSync(path.join(tmpdir(), 'janus-du-test-'))
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

// Bundle the TS modules under test with the project's esbuild.
function bundle(entry, outName) {
  execFileSync(
    path.join(root, 'node_modules', '.bin', 'esbuild'),
    [
      '--bundle',
      '--platform=node',
      '--format=esm',
      `--alias:@shared=${path.join(root, 'src/shared')}`,
      `--outfile=${path.join(outDir, outName)}`,
      entry
    ],
    { stdio: 'pipe' }
  )
}
bundle(path.join(root, 'src/main/disk-usage/index-store.ts'), 'index-store.mjs')
bundle(path.join(root, 'src/main/disk-usage/protocol.ts'), 'protocol.mjs')
bundle(path.join(root, 'src/main/disk-usage/path-guards.ts'), 'path-guards.mjs')

const { DiskIndex } = await import(path.join(outDir, 'index-store.mjs'))
const { NdjsonParser } = await import(path.join(outDir, 'protocol.mjs'))
const { isStrictDescendantPosix, isStrictDescendantLocal, normalizePosix } = await import(path.join(outDir, 'path-guards.mjs'))

console.log('\n[protocol] NDJSON parser')
{
  const lines = []
  const errors = []
  const p = new NdjsonParser((m) => lines.push(m), (e) => errors.push(e.message))
  const payload = JSON.stringify({ type: 'progress', name: '视频-ümlaut', n: 42 }) + '\n'
  const bytes = Buffer.from(payload, 'utf8')
  // Split inside a multi-byte character.
  const mid = payload.indexOf('视') + 1
  p.push(bytes.subarray(0, mid))
  p.push(bytes.subarray(mid))
  ok('multi-byte UTF-8 across chunk boundary', lines.length === 1 && lines[0].name === '视频-ümlaut')

  const p2 = new NdjsonParser(() => {}, (e) => errors.push(e.message))
  p2.push(Buffer.from('{"a":1}\n{"b":'))
  p2.push(Buffer.from('2}\n'))
  ok('JSON split across chunks', errors.length === 0)

  let longErr = null
  const p3 = new NdjsonParser(() => {}, (e) => (longErr = e.message))
  p3.push(Buffer.from('x'.repeat(2 * 1024 * 1024)))
  ok('over-long line rejected', /line too long/.test(longErr || ''))

  let badErr = null
  const p4 = new NdjsonParser(() => {}, (e) => (badErr = e.message))
  p4.push(Buffer.from('not json\n'))
  ok('malformed JSON rejected', /malformed/.test(badErr || ''))
}

console.log('\n[path-guards] containment')
{
  ok('/data contains /data/x', isStrictDescendantPosix('/data', '/data/x'))
  ok('/data does NOT contain /data2', !isStrictDescendantPosix('/data', '/data2'))
  ok('root itself is not a strict descendant', !isStrictDescendantPosix('/data', '/data'))
  ok('.. traversal rejected', !isStrictDescendantPosix('/data', '/data/../etc'))
  ok('normalizePosix collapses .. and .', normalizePosix('/a/./b/../c') === '/a/c')
  ok('local: /a/b contains /a/b/c', isStrictDescendantLocal('/a/b', '/a/b/c'))
  ok('local: /a/b does NOT contain /a/bc', !isStrictDescendantLocal('/a/b', '/a/bc'))
}

console.log('\n[index-store] aggregation / query / resolve')
{
  const idx = new DiskIndex()
  idx.setRoot('1', '/root')
  idx.upsert({ id: '1', parentId: null, name: '/root', rel: '', kind: 'directory', knownBytes: 0, coverage: 'pending' })
  idx.upsert({ id: '2', parentId: '1', name: 'big', rel: 'big', kind: 'file', knownBytes: 500, ownBytes: 500, coverage: 'complete', dev: '1', ino: '2', size: 500 })
  idx.upsert({ id: '3', parentId: '1', name: 'dir', rel: 'dir', kind: 'directory', knownBytes: 0, coverage: 'pending' })
  idx.upsert({ id: '4', parentId: '3', name: 'inner', rel: 'dir/inner', kind: 'file', knownBytes: 100, ownBytes: 100, coverage: 'complete', dev: '1', ino: '4', size: 100 })
  idx.upsert({ id: '3', coverage: 'complete', knownBytes: 100, childCount: 1, fileCount: 1 }) // close-dir update
  idx.commitBatch()

  const view = idx.query({ scanId: 's', nodeId: '1', offset: 0, limit: 200, sortBy: 'size', order: 'desc' })
  ok('root children sorted by size desc, dirs first', view.entries.map((e) => e.name).join(',') === 'dir,big')
  ok('breadcrumbs walk to root', view.breadcrumbs.map((b) => b.name).join('|') === '/root')
  ok('treemap has all children', view.treemap.length === 2 && !view.treemap.some((t) => t.synthetic))

  const inner = idx.query({ scanId: 's', nodeId: '3', offset: 0, limit: 200, sortBy: 'name', order: 'asc' })
  ok('inner query works', inner.entries.length === 1 && inner.entries[0].name === 'inner')
  ok('breadcrumb to inner', inner.breadcrumbs.map((b) => b.name).join('/') === '/root/dir')

  const res = idx.resolveForDelete(['1', '3', '4'])
  ok('root rejected from delete', res.rejected.some((r) => r.nodeId === '1'))
  ok('child covered by selected parent rejected', res.rejected.some((r) => r.nodeId === '4'))
  ok('parent dir resolvable with identity', res.targets.length === 1 && res.targets[0].expect.ino !== undefined)

  const filter = idx.query({ scanId: 's', nodeId: '1', offset: 0, limit: 200, sortBy: 'name', order: 'asc', nameFilter: 'BIG' })
  ok('case-insensitive name filter', filter.entries.length === 1 && filter.entries[0].name === 'big')
}

console.log('\n[remote.py] Python helper scan against isolated fixture')
{
  const fx = mkdtempSync(path.join(tmpdir(), 'janus-du-fx-'))
  mkdirSync(path.join(fx, 'sub', 'deep'), { recursive: true })
  writeFileSync(path.join(fx, 'a.bin'), Buffer.alloc(1000, 1))
  writeFileSync(path.join(fx, 'sub', 'b.bin'), Buffer.alloc(2000, 2))
  writeFileSync(path.join(fx, 'sub', 'deep', 'c.bin'), Buffer.alloc(4000, 3))
  writeFileSync(path.join(fx, 'empty'), '')
  symlinkSync(path.join(fx, 'a.bin'), path.join(fx, 'link-to-a'))
  mkdirSync(path.join(fx, 'empty-dir'))

  const driver = `
import json, sys
sys.path.insert(0, ${JSON.stringify(path.join(root, 'resources', 'disk-usage'))})
import remote
out = []
remote.run({'action': 'scan', 'rootPath': sys.argv[1], 'stayOnFilesystem': True, 'maxNodes': 100000}, lambda: False, out.append)
for line in out:
    print(json.dumps(line))
`
  let stdout
  try {
    stdout = execFileSync('python3', ['-c', driver, fx], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  } catch (e) {
    ok('python3 helper runs', false, String(e).slice(0, 200))
    stdout = ''
  }
  const msgs = stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
  const hello = msgs.find((m) => m.type === 'hello')
  const term = msgs.find((m) => m.type === 'terminal')
  const nodes = msgs.filter((m) => m.type === 'nodes').flatMap((m) => m.nodes)
  ok('hello with canonical root', hello && hello.rootNodeId && hello.rootPath === realpathSync(fx))
  ok('terminal completed', term && term.state === 'completed', JSON.stringify(term))
  ok('logical bytes = 7000', term && term.knownBytes === 7000, String(term && term.knownBytes))
  ok('file count = 4', term && term.scannedFiles === 4, String(term && term.scannedFiles))
  const link = nodes.find((n) => n.name === 'link-to-a')
  ok('symlink recorded as 0-byte link, not followed', link && link.kind === 'symlink' && link.knownBytes === 0)
  const sub = nodes.find((n) => n.name === 'sub' && n.kind === 'directory')
  const subClose = nodes.filter((n) => n.id === (sub && sub.id))
  const finalSub = subClose[subClose.length - 1]
  ok('post-order aggregation: sub = 6000', finalSub && finalSub.knownBytes === 6000, JSON.stringify(finalSub))
  ok('empty dir and empty file present', nodes.some((n) => n.name === 'empty-dir') && nodes.some((n) => n.name === 'empty'))

  // delete action: only inside the fixture
  const delDriver = `
import json, sys
sys.path.insert(0, ${JSON.stringify(path.join(root, 'resources', 'disk-usage'))})
import remote
out = []
items = [{'path': sys.argv[2], 'expect': {'kind': 'directory'}}]
remote.run({'action': 'delete', 'rootPath': sys.argv[1], 'items': items}, lambda: False, out.append)
for line in out:
    print(json.dumps(line))
`
  // without dev/ino the identity check must fail → PATH_CHANGED (safe)
  const delOut = execFileSync('python3', ['-c', delDriver, fx, path.join(fx, 'sub', 'deep')], { encoding: 'utf8' })
  const delMsgs = delOut.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
  const item = delMsgs.find((m) => m.type === 'delete-item')
  ok('identity mismatch blocks delete (PATH_CHANGED)', item && item.message === 'PATH_CHANGED', JSON.stringify(item))

  const outsideOut = execFileSync('python3', ['-c', delDriver, fx, '/etc/hostname'], { encoding: 'utf8' })
  const outsideMsgs = outsideOut.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
  const outsideItem = outsideMsgs.find((m) => m.type === 'delete-item')
  ok('outside-root delete refused', outsideItem && outsideItem.message === 'OUTSIDE_ROOT', JSON.stringify(outsideItem))
  ok('fixture intact after refused deletes', readdirSync(fx).includes('sub'))

  rmSync(fx, { recursive: true, force: true })
}

console.log('\n[worker] local scan cancel responsiveness')
{
  const { Worker } = await import('node:worker_threads')
  const fx = mkdtempSync(path.join(tmpdir(), 'janus-du-cancel-'))
  // ~40k files so the cancel reliably lands mid-scan on fast machines.
  for (let i = 0; i < 200; i++) {
    mkdirSync(path.join(fx, `d${i}`), { recursive: true })
    for (let j = 0; j < 200; j++) writeFileSync(path.join(fx, `d${i}`, `f${j}`), Buffer.alloc(64, 1))
  }
  const worker = new Worker(path.join(root, 'out/main/disk-usage-worker.js'), { workerData: { mode: 'local' } })
  const started = Date.now()
  const result = await new Promise((resolve) => {
    let terminal = null
    worker.on('message', (m) => {
      if (m.type === 'terminal' && !terminal) {
        terminal = m
        resolve(m)
      }
    })
    worker.on('error', (e) => resolve({ state: 'worker-error', error: e.message }))
    worker.postMessage({ cmd: 'scan-local', opts: { scanId: 't', rootPath: fx, maxNodes: 100000, stayOnFilesystem: true } })
    setTimeout(() => worker.postMessage({ cmd: 'cancel' }), 300)
    setTimeout(() => resolve({ state: 'timeout' }), 15000)
  })
  const elapsed = Date.now() - started
  ok('cancel honored promptly (canceled, <5s)', result.state === 'canceled' && elapsed < 5000, `${result.state} ${elapsed}ms`)
  await worker.terminate()
  rmSync(fx, { recursive: true, force: true })
}

console.log('\n[remote.py] helper cancel responsiveness')
{
  const fx = mkdtempSync(path.join(tmpdir(), 'janus-du-pycancel-'))
  for (let i = 0; i < 200; i++) {
    mkdirSync(path.join(fx, `d${i}`), { recursive: true })
    for (let j = 0; j < 200; j++) writeFileSync(path.join(fx, `d${i}`, `f${j}`), Buffer.alloc(64, 1))
  }
  const driver = `
import json, sys, time, threading
sys.path.insert(0, ${JSON.stringify(path.join(root, 'resources', 'disk-usage'))})
import remote
stop = threading.Event()
threading.Timer(0.01, stop.set).start()
t0 = time.monotonic()
out = []
remote.run({'action': 'scan', 'rootPath': sys.argv[1], 'stayOnFilesystem': True, 'maxNodes': 1000000}, stop.is_set, out.append)
term = [m for m in out if m.get('type') == 'terminal']
print(json.dumps({'terminal': term[-1] if term else None, 'elapsed': time.monotonic() - t0}))
`
  const out = execFileSync('python3', ['-c', driver, fx], { encoding: 'utf8' })
  const parsed = JSON.parse(out.trim())
  ok('helper stops on cancel flag (canceled, <5s)', parsed.terminal && parsed.terminal.state === 'canceled' && parsed.elapsed < 5, JSON.stringify(parsed).slice(0, 200))
  rmSync(fx, { recursive: true, force: true })
}

rmSync(outDir, { recursive: true, force: true })
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
