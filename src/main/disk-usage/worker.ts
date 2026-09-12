import { parentPort, workerData } from 'worker_threads'
import { promises as fs } from 'fs'
import path from 'path'
import { DiskIndex, type NodeRecord } from './index-store'
import { NdjsonParser } from './protocol'
import type { DirectoryQuery, ScanState } from '@shared/disk-usage'
import { DISK_LIMITS } from '@shared/disk-usage'

/**
 * Disk Usage worker thread. Owns the node index for ONE scan and answers
 * directory/warnings/resolve queries so the main process never sorts
 * 200k-node trees. Two modes:
 *  - local: walks the filesystem itself (scan-local)
 *  - remote: parses NDJSON chunks forwarded from the SSH exec channel
 */

interface ScanOptions {
  scanId: string
  rootPath: string
  maxNodes?: number
  stayOnFilesystem?: boolean
}

const index = new DiskIndex()
let canceled = false
let finished = false
let mode: 'local' | 'remote' = (workerData?.mode as 'local' | 'remote') ?? 'remote'
let lastSeq = 0

const port = parentPort!
const post = (msg: Record<string, unknown>): void => port.postMessage(msg)

function emitBatch(records: NodeRecord[]): void {
  for (const r of records) index.upsert(r)
  index.commitBatch()
  post({ type: 'batch', revision: index.revision, count: records.length })
}

function emitTerminal(state: ScanState, extra: Record<string, unknown> = {}): void {
  if (finished) return
  finished = true
  post({ type: 'terminal', state, ...extra })
}

// ---------------- remote mode: NDJSON protocol parsing ----------------

const parser = new NdjsonParser(
  (msg) => {
    try {
      routeRemote(msg)
    } catch (e) {
      emitTerminal('failed', { error: `PROTOCOL_ERROR: ${(e as Error).message}`, errorCode: 'PROTOCOL_ERROR' })
    }
  },
  (err) => emitTerminal('failed', { error: err.message, errorCode: 'PROTOCOL_ERROR' })
)

function routeRemote(msg: Record<string, unknown>): void {
  if (finished) return
  const type = msg.type
  if (type === 'hello') {
    index.setRoot(String(msg.rootNodeId), String(msg.rootPath))
    post({
      type: 'hello',
      rootPath: msg.rootPath,
      rootNodeId: msg.rootNodeId,
      rootIdentity: msg.rootIdentity,
      python: msg.python
    })
    return
  }
  if (!index.rootId) {
    emitTerminal('failed', { error: 'PROTOCOL_ERROR: nodes before hello', errorCode: 'PROTOCOL_ERROR' })
    return
  }
  switch (type) {
    case 'nodes': {
      const seq = Number(msg.seq)
      if (seq <= lastSeq) return // duplicate batch (replay) — ignore
      lastSeq = seq
      emitBatch(msg.nodes as NodeRecord[])
      break
    }
    case 'progress':
      post({ type: 'progress', ...pick(msg, ['scannedFiles', 'scannedDirs', 'knownBytes', 'warningCount', 'currentPath']) })
      break
    case 'warning':
      index.addWarning({ code: String(msg.code), path: String(msg.path), message: String(msg.message) })
      post({ type: 'warning-count', count: index.warnings.length + index.warningOverflow })
      break
    case 'terminal':
      emitTerminal(msg.state as ScanState, {
        ...pick(msg, ['scannedFiles', 'scannedDirs', 'knownBytes', 'warningCount', 'limitReason', 'error']),
        errorCode: msg.errorCode
      })
      break
    default:
      break
  }
}

function pick(obj: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of keys) if (k in obj) out[k] = obj[k]
  return out
}

// ---------------- local mode: Node walker (mirrors remote.py) ----------------

const SKIP_AT_ROOT = new Set(['/proc', '/sys', '/dev', '/run'])

interface LocalFrame {
  path: string
  id: string
  depth: number
  dev: number
  ino: number
  entries: import('fs').Dirent[] | null
  cursor: number
  partial?: boolean
  extraIssue?: number
}

async function scanLocal(opts: ScanOptions): Promise<void> {
  const maxNodes = opts.maxNodes ?? DISK_LIMITS.maxNodes
  const stayOnFs = opts.stayOnFilesystem ?? true
  let nodesSeen = 0
  let scannedFiles = 0
  let scannedDirs = 0
  let knownBytes = 0
  let warningCount = 0
  let nextId = 1
  let batch: NodeRecord[] = []
  let lastProgress = 0
  let ticks = 0
  const sums = new Map<string, [number, number, number, number]>()
  const ancestors = new Set<string>()

  const newId = (): string => String(nextId++)

  const flush = (): void => {
    if (batch.length === 0) return
    const out = batch
    batch = []
    emitBatch(out)
  }

  const push = (rec: NodeRecord): void => {
    batch.push(rec)
    nodesSeen += 1
    if (batch.length >= 256) flush()
  }

  const warn = (code: string, p: string, message: string): void => {
    warningCount += 1
    index.addWarning({ code, path: p, message })
    if (warningCount <= DISK_LIMITS.maxWarnings) post({ type: 'warning-count', count: warningCount })
  }

  const progress = (current: string, force = false): void => {
    const now = Date.now()
    if (!force && now - lastProgress < 250) return
    lastProgress = now
    post({ type: 'progress', scannedFiles, scannedDirs, knownBytes, warningCount, currentPath: current })
  }

  const addChildStats = (parentId: string, bytes: number, files: number, issue: number): void => {
    const s = sums.get(parentId) ?? [0, 0, 0, 0]
    s[0] += bytes
    s[1] += files
    s[2] += 1
    s[3] += issue
    sums.set(parentId, s)
  }

  const closeDir = (stack: LocalFrame[], frame: LocalFrame): void => {
    const s = sums.get(frame.id) ?? [0, 0, 0, 0]
    sums.delete(frame.id)
    const issues = s[3] + (frame.extraIssue ?? 0)
    batch.push({
      id: frame.id,
      coverage: frame.partial ? 'partial' : 'complete',
      knownBytes: s[0],
      fileCount: s[1],
      childCount: s[2],
      issueCount: issues
    })
    if (batch.length >= 256) flush()
    if (stack.length > 0) {
      const parent = stack[stack.length - 1].id
      const ps = sums.get(parent) ?? [0, 0, 0, 0]
      ps[0] += s[0]
      ps[1] += s[1]
      ps[3] += issues
      sums.set(parent, ps)
    }
    ancestors.delete(`${frame.dev}:${frame.ino}`)
  }

  let rootPath: string
  try {
    rootPath = await fs.realpath(opts.rootPath)
  } catch {
    rootPath = path.resolve(opts.rootPath)
  }
  let rootStat: import('fs').Stats
  try {
    rootStat = await fs.lstat(rootPath)
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    emitTerminal('failed', {
      error: code === 'ENOENT' ? `Path not found: ${opts.rootPath}` : (e as Error).message,
      errorCode: code === 'ENOENT' ? 'PATH_NOT_FOUND' : code === 'EACCES' ? 'PERMISSION_DENIED' : undefined
    })
    return
  }
  if (!rootStat.isDirectory()) {
    emitTerminal('failed', { error: `Not a directory: ${rootPath}`, errorCode: 'NOT_DIRECTORY' })
    return
  }

  const rootId = newId()
  index.setRoot(rootId, rootPath)
  ancestors.add(`${rootStat.dev}:${rootStat.ino}`)
  sums.set(rootId, [0, 0, 0, 0])
  post({
    type: 'hello',
    rootPath,
    rootNodeId: rootId,
    rootIdentity: { dev: String(rootStat.dev), ino: String(rootStat.ino) },
    python: null
  })
  push({
    id: rootId,
    parentId: null,
    name: rootPath,
    rel: '',
    kind: 'directory',
    ownBytes: 0,
    knownBytes: 0,
    coverage: 'pending',
    childCount: 0,
    fileCount: 0,
    mtimeMs: rootStat.mtimeMs,
    issueCount: 0,
    dev: String(rootStat.dev),
    ino: String(rootStat.ino)
  })

  const rootDev = rootStat.dev
  let limited = false
  const stack: LocalFrame[] = [
    { path: rootPath, id: rootId, depth: 0, dev: rootStat.dev, ino: rootStat.ino, entries: null, cursor: 0 }
  ]

  while (stack.length > 0) {
    if (canceled) break
    const frame = stack[stack.length - 1]
    if (frame.entries === null) {
      scannedDirs += 1
      progress(frame.path)
      if (nodesSeen >= maxNodes) {
        limited = true
        break
      }
      if (frame.depth >= DISK_LIMITS.maxDepth) {
        warn('depth-limit', frame.path, 'Maximum depth reached')
        frame.partial = true
        frame.extraIssue = (frame.extraIssue ?? 0) + 1
        frame.entries = []
        continue
      }
      try {
        frame.entries = await fs.readdir(frame.path, { withFileTypes: true })
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code
        warn(code === 'EACCES' ? 'permission-denied' : 'read-error', frame.path, (e as Error).message)
        frame.partial = true
        frame.extraIssue = (frame.extraIssue ?? 0) + 1
        frame.entries = []
      }
      continue
    }

    if (frame.cursor >= frame.entries.length) {
      stack.pop()
      closeDir(stack, frame)
      continue
    }
    const entry = frame.entries[frame.cursor++]

    ticks += 1
    if (ticks >= 200) {
      ticks = 0
      progress(frame.path)
      if (canceled) break
      // Yield so query/cancel messages interleave on big directories.
      await new Promise((r) => setImmediate(r))
    }
    if (nodesSeen >= maxNodes) {
      limited = true
      break
    }

    const full = path.join(frame.path, entry.name)
    const rel = path.relative(rootPath, full).split(path.sep).join('/')
    let st: import('fs').Stats
    try {
      st = await fs.lstat(full)
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      warn(code === 'ENOENT' ? 'vanished' : code === 'EACCES' ? 'permission-denied' : 'stat-error', full, (e as Error).message)
      continue
    }
    const isLink = st.isSymbolicLink()
    const kind = isLink ? 'symlink' : st.isDirectory() ? 'directory' : st.isFile() ? 'file' : 'other'
    const own = kind === 'file' ? st.size : 0
    let issue = 0
    let selectable = true
    // Surrogate halves indicate a non-UTF-8 filename — display only.
    // eslint-disable-next-line no-control-regex
    if (/[\ud800-\udfff]/.test(entry.name)) {
      issue += 1
      selectable = false
      warn('unsupported-filename', full, 'Non-UTF-8 filename')
    }
    // mtimeNs is bigint-precision; carry as string (exceeds MAX_SAFE_INTEGER).
    const mtimeNs = (st as unknown as { mtimeNs?: bigint }).mtimeNs?.toString() ?? null

    if (kind === 'directory') {
      if (stayOnFs && st.dev !== rootDev) {
        warn('mount-boundary', full, 'Different filesystem — skipped')
        push({
          id: newId(), parentId: frame.id, name: entry.name, rel, kind: 'other',
          ownBytes: 0, knownBytes: 0, coverage: 'excluded', childCount: 0, fileCount: 0,
          mtimeMs: st.mtimeMs, issueCount: 1, selectable: false,
          dev: String(st.dev), ino: String(st.ino)
        })
        addChildStats(frame.id, 0, 0, 1)
        continue
      }
      if (rootPath === '/' && SKIP_AT_ROOT.has(full)) {
        warn('excluded', full, 'Pseudo filesystem — skipped')
        push({
          id: newId(), parentId: frame.id, name: entry.name, rel, kind: 'other',
          ownBytes: 0, knownBytes: 0, coverage: 'excluded', childCount: 0, fileCount: 0,
          mtimeMs: st.mtimeMs, issueCount: 1, selectable: false,
          dev: String(st.dev), ino: String(st.ino)
        })
        addChildStats(frame.id, 0, 0, 1)
        continue
      }
      const key = `${st.dev}:${st.ino}`
      if (ancestors.has(key)) {
        warn('cycle', full, 'Directory cycle — skipped')
        addChildStats(frame.id, 0, 0, 1)
        continue
      }
      const cid = newId()
      sums.set(cid, [0, 0, 0, issue])
      push({
        id: cid, parentId: frame.id, name: entry.name, rel, kind: 'directory',
        ownBytes: 0, knownBytes: 0, coverage: 'pending', childCount: 0, fileCount: 0,
        mtimeMs: st.mtimeMs, issueCount: issue, selectable,
        dev: String(st.dev), ino: String(st.ino), size: 0, mtimeNs
      })
      addChildStats(frame.id, 0, 0, 0)
      ancestors.add(key)
      stack.push({ path: full, id: cid, depth: frame.depth + 1, dev: st.dev, ino: st.ino, entries: null, cursor: 0 })
    } else {
      if (kind === 'file') {
        scannedFiles += 1
        knownBytes += own
        if (!Number.isSafeInteger(knownBytes)) {
          limited = true
          break
        }
      }
      push({
        id: newId(), parentId: frame.id, name: entry.name, rel, kind,
        ownBytes: own, knownBytes: own, coverage: 'complete', childCount: 0,
        fileCount: kind === 'file' ? 1 : 0, mtimeMs: st.mtimeMs, issueCount: issue, selectable,
        dev: String(st.dev), ino: String(st.ino), size: own, mtimeNs
      })
      addChildStats(frame.id, own, kind === 'file' ? 1 : 0, issue)
    }
  }

  flush()
  progress(rootPath, true)
  const state: ScanState = canceled ? 'canceled' : limited ? 'limited' : 'completed'
  emitTerminal(state, {
    scannedFiles,
    scannedDirs,
    knownBytes,
    warningCount,
    limitReason: limited ? 'entries' : undefined
  })
}

// ---------------- message routing ----------------

port.on('message', (msg: Record<string, unknown>) => {
  switch (msg.cmd) {
    case 'scan-local':
      void scanLocal(msg.opts as ScanOptions)
      break
    case 'feed':
      parser.push(msg.chunk as Uint8Array)
      post({ type: 'ack', bytes: (msg.chunk as Uint8Array).byteLength })
      break
    case 'eof':
      parser.end()
      if (!finished) emitTerminal('failed', { error: 'CONNECTION_LOST: channel closed before terminal', errorCode: 'CONNECTION_LOST' })
      break
    case 'cancel':
      canceled = true
      break
    case 'query': {
      try {
        const view = index.query(msg.query as DirectoryQuery)
        post({ type: 'query-result', requestId: msg.requestId, view })
      } catch (e) {
        post({ type: 'query-error', requestId: msg.requestId, error: (e as Error).message })
      }
      break
    }
    case 'warnings': {
      const page = index.warningsPage(Number(msg.offset) || 0, Number(msg.limit) || 100)
      post({ type: 'warnings-result', requestId: msg.requestId, ...page })
      break
    }
    case 'resolve-delete': {
      const res = index.resolveForDelete(msg.nodeIds as string[])
      post({ type: 'resolve-result', requestId: msg.requestId, ...res })
      break
    }
    default:
      break
  }
})

post({ type: 'ready', mode })
