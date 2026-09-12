import { randomUUID } from 'crypto'
import path from 'path'
import { Worker } from 'worker_threads'
import type { ClientChannel } from 'ssh2'
import type { ServerProfile } from '@shared/types'
import type {
  DeleteOperation,
  DeletePlan,
  DirectoryQuery,
  DirectoryView,
  DiskTarget,
  OpenInFilesRequest,
  ScanSnapshot,
  ScanState,
  WarningsPage
} from '@shared/disk-usage'
import { DISK_LIMITS, DiskError } from '@shared/disk-usage'
import { IPC } from '@shared/ipc'
import type { SSHManager } from '../ssh-manager'
import type { TransferManager } from '../transfer-manager'
import type { ResolvedTarget } from './index-store'
import { ensurePython, forgetServer, openHelperChannel, writeCancel, writeEnvelope } from './remote-adapter'
import { executeLocalTrash, executeRemoteDelete } from './delete-manager'
import { NdjsonParser } from './protocol'

/**
 * Disk Usage task manager. Owns scan workers, SSH helper channels, delete
 * plans and event sequencing. The worker thread holds the node index; this
 * class keeps only summaries, handles and plans.
 */

export interface ManagerDeps {
  ssh: SSHManager
  transfers: TransferManager
  isUnlocked: () => boolean
  findServer: (id: string) => ServerProfile
  jumpFor: (p: ServerProfile) => ServerProfile | null
  /** Send to the analysis window that owns ownerId. */
  sendToOwner: (ownerId: number, channel: string, payload: unknown) => void
  /** Send to the main window. */
  sendToMain: (channel: string, payload: unknown) => void
}

interface RemoteIo {
  stream: ClientChannel
  close: () => void
  inFlight: number
  cancelTimer?: NodeJS.Timeout
}

interface TaskRecord {
  scanId: string
  target: DiskTarget
  ownerId: number
  state: ScanState
  revision: number
  eventSeq: number
  startedAt: number
  finishedAt?: number
  scannedFiles: number
  scannedDirs: number
  knownBytes: number
  warningCount: number
  currentPath?: string
  rootPath: string
  rootNodeId: string
  stale: boolean
  limitReason?: ScanSnapshot['limitReason']
  error?: string
  worker: Worker | null
  remote: RemoteIo | null
  profile: ServerProfile | null
  jump: ServerProfile | null
  pending: Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>
  helloWaiter: ((rec: TaskRecord) => void) | null
  deleting: boolean
  /** Local-scan cancel fallback timer (remote uses its own TERM/close chain). */
  cancelFallback?: NodeJS.Timeout
}

interface StoredPlan extends DeletePlan {
  ownerId: number
  scanRef: TaskRecord
  consumed: boolean
  operationId?: string
}

function deviceKey(target: DiskTarget): string {
  return target.kind === 'local' ? 'local' : `ssh:${target.serverId}`
}

export class DiskUsageManager {
  private tasks = new Map<string, TaskRecord>()
  private plans = new Map<string, StoredPlan>()
  private operations = new Map<string, DeleteOperation & { ownerId: number; canceled: boolean }>()
  private requestCounter = 0

  constructor(private deps: ManagerDeps) {}

  // ---------------- helpers ----------------

  private assertUnlocked(): void {
    if (!this.deps.isUnlocked()) throw new DiskError('VAULT_LOCKED', 'Vault is locked')
  }

  private taskFor(scanId: string, ownerId: number): TaskRecord {
    const t = this.tasks.get(scanId)
    if (!t || t.ownerId !== ownerId) throw new DiskError('INVALID_OWNER', 'Unknown scan for this window')
    return t
  }

  private emit(t: TaskRecord, type: string, payload: Record<string, unknown>): void {
    t.eventSeq += 1
    this.deps.sendToOwner(t.ownerId, IPC.diskEvent, {
      version: 1,
      scanId: t.scanId,
      seq: t.eventSeq,
      revision: t.revision,
      type,
      payload
    })
  }

  snapshot(t: TaskRecord): ScanSnapshot {
    return {
      scanId: t.scanId,
      target: t.target,
      rootPath: t.rootPath,
      rootNodeId: t.rootNodeId,
      state: t.state,
      revision: t.revision,
      eventSeq: t.eventSeq,
      startedAt: t.startedAt,
      finishedAt: t.finishedAt,
      scannedFiles: t.scannedFiles,
      scannedDirs: t.scannedDirs,
      knownBytes: t.knownBytes,
      warningCount: t.warningCount,
      currentPath: t.currentPath,
      stale: t.stale,
      limitReason: t.limitReason,
      error: t.error
    }
  }

  snapshotFor(scanId: string | undefined, ownerId: number): ScanSnapshot | null {
    if (scanId) {
      const t = this.tasks.get(scanId)
      return t && t.ownerId === ownerId ? this.snapshot(t) : null
    }
    // Most recent task owned by this window (renderer reload recovery).
    let best: TaskRecord | null = null
    for (const t of this.tasks.values()) {
      if (t.ownerId === ownerId && (!best || t.startedAt > best.startedAt)) best = t
    }
    return best ? this.snapshot(best) : null
  }

  // ---------------- scan lifecycle ----------------

  async start(ownerId: number, target: DiskTarget, rootPath: string): Promise<ScanSnapshot> {
    this.assertUnlocked()
    if (!rootPath || !rootPath.trim()) throw new DiskError('PATH_NOT_FOUND', 'Path is empty')
    if (target.kind === 'ssh' && !target.serverId) throw new DiskError('INVALID_TARGET', 'Missing server id')

    const key = deviceKey(target)
    for (const t of this.tasks.values()) {
      const active = t.state === 'starting' || t.state === 'scanning'
      if (active && deviceKey(t.target) === key) {
        throw new DiskError('SCAN_BUSY', 'This device already has an active scan — stop it first')
      }
    }
    const activeGlobal = [...this.tasks.values()].filter((t) => t.state === 'starting' || t.state === 'scanning')
    if (activeGlobal.length >= DISK_LIMITS.maxActiveScans) {
      throw new DiskError('SCAN_BUSY', 'Another scan is already running — stop it first')
    }

    // Result retention: drop the oldest finished result beyond the cap.
    const finished = [...this.tasks.values()]
      .filter((t) => t.state !== 'starting' && t.state !== 'scanning' && t.state !== 'canceling')
      .sort((a, b) => a.startedAt - b.startedAt)
    while (finished.length >= DISK_LIMITS.maxRetainedResults) {
      const oldest = finished.shift()!
      if (oldest.deleting) break
      this.disposeTask(oldest)
      this.tasks.delete(oldest.scanId)
    }

    let profile: ServerProfile | null = null
    let jump: ServerProfile | null = null
    if (target.kind === 'ssh') {
      profile = this.deps.findServer(target.serverId)
      jump = this.deps.jumpFor(profile)
      await ensurePython(this.deps.ssh, profile, jump)
    }

    const scanId = randomUUID()
    const rec: TaskRecord = {
      scanId,
      target,
      ownerId,
      state: 'starting',
      revision: 0,
      eventSeq: 0,
      startedAt: Date.now(),
      scannedFiles: 0,
      scannedDirs: 0,
      knownBytes: 0,
      warningCount: 0,
      rootPath: '',
      rootNodeId: '',
      stale: false,
      worker: null,
      remote: null,
      profile,
      jump,
      pending: new Map(),
      helloWaiter: null,
      deleting: false
    }
    this.tasks.set(scanId, rec)

    try {
      this.spawnWorker(rec)
      if (target.kind === 'ssh') {
        await this.startRemote(rec, rootPath.trim())
      } else {
        rec.worker!.postMessage({
          cmd: 'scan-local',
          opts: {
            scanId,
            rootPath: rootPath.trim(),
            maxNodes: DISK_LIMITS.maxNodes,
            stayOnFilesystem: true
          }
        })
      }
      rec.state = 'scanning'
      this.emit(rec, 'state', { state: 'scanning' })
    } catch (e) {
      rec.state = 'failed'
      rec.error = (e as Error).message
      rec.finishedAt = Date.now()
      this.emit(rec, 'state', { state: 'failed', error: rec.error })
      this.disposeTask(rec)
      throw e
    }

    // Resolve start() once hello AND the first node batch are indexed (or fail).
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new DiskError('PROTOCOL_ERROR', 'Timed out waiting for scan to start')), 30_000)
      rec.helloWaiter = () => {
        clearTimeout(timeout)
        if (rec.rootNodeId && rec.revision >= 1) resolve()
        else reject(new DiskError('PROTOCOL_ERROR', rec.error || 'Scan failed to start'))
      }
      if (rec.rootNodeId && rec.revision >= 1) {
        clearTimeout(timeout)
        resolve()
      } else if (rec.state === 'failed') {
        clearTimeout(timeout)
        reject(new DiskError('PROTOCOL_ERROR', rec.error || 'Scan failed to start'))
      }
    })
    return this.snapshot(rec)
  }

  private spawnWorker(rec: TaskRecord): void {
    const workerPath = path.join(__dirname, 'disk-usage-worker.js')
    const worker = new Worker(workerPath, {
      workerData: { mode: rec.target.kind === 'local' ? 'local' : 'remote' },
      resourceLimits: { maxOldGenerationSizeMb: 512 }
    })
    rec.worker = worker
    worker.on('message', (msg: Record<string, unknown>) => this.onWorkerMessage(rec, msg))
    worker.on('error', (e) => this.finishTask(rec, 'failed', `Worker error: ${e.message}`))
    worker.on('exit', (code) => {
      if (rec.state === 'starting' || rec.state === 'scanning' || rec.state === 'canceling') {
        if (code !== 0) this.finishTask(rec, 'failed', `Worker exited (${code})`)
      }
    })
  }

  private async startRemote(rec: TaskRecord, rootPath: string): Promise<void> {
    const handle = await openHelperChannel(this.deps.ssh, rec.profile!, rec.jump)
    rec.remote = { stream: handle.stream, close: handle.close, inFlight: 0 }

    handle.stream.on('data', (chunk: Buffer) => {
      if (!rec.worker) return
      rec.remote!.inFlight += chunk.length
      rec.worker.postMessage({ cmd: 'feed', chunk })
      // Backpressure: pause the SSH readable when the worker falls behind.
      if (rec.remote!.inFlight > 4 * 1024 * 1024) handle.stream.pause()
    })
    handle.stream.stderr.on('data', () => {
      /* stderr retained only for diagnostics; protocol runs on stdout */
    })
    handle.stream.on('close', () => {
      rec.worker?.postMessage({ cmd: 'eof' })
    })
    handle.stream.on('error', () => {
      rec.worker?.postMessage({ cmd: 'eof' })
    })

    await writeEnvelope(handle.stream, {
      version: 1,
      action: 'scan',
      rootPath,
      stayOnFilesystem: true,
      maxNodes: DISK_LIMITS.maxNodes
    })
  }

  private maybeResolveHello(rec: TaskRecord): void {
    if (rec.helloWaiter && rec.rootNodeId && rec.revision >= 1) {
      rec.helloWaiter(rec)
      rec.helloWaiter = null
    }
  }

  private onWorkerMessage(rec: TaskRecord, msg: Record<string, unknown>): void {
    const type = msg.type as string
    switch (type) {
      case 'ack':
        if (rec.remote) {
          rec.remote.inFlight -= Number(msg.bytes) || 0
          if (rec.remote.inFlight < 1024 * 1024) rec.remote.stream.resume()
        }
        break
      case 'hello':
        rec.rootPath = String(msg.rootPath)
        rec.rootNodeId = String(msg.rootNodeId)
        this.maybeResolveHello(rec)
        this.emit(rec, 'state', { state: rec.state, rootPath: rec.rootPath, rootNodeId: rec.rootNodeId })
        break
      case 'batch':
        rec.revision = Number(msg.revision)
        // start() resolves only after hello AND the first node batch are both
        // in the index — otherwise the renderer's first directory query can
        // race ahead of the index and hit PATH_NOT_FOUND.
        this.maybeResolveHello(rec)
        break
      case 'progress':
        rec.scannedFiles = Number(msg.scannedFiles) || 0
        rec.scannedDirs = Number(msg.scannedDirs) || 0
        rec.knownBytes = Number(msg.knownBytes) || 0
        rec.warningCount = Number(msg.warningCount) || 0
        rec.currentPath = msg.currentPath as string | undefined
        this.emit(rec, 'progress', {
          scannedFiles: rec.scannedFiles,
          scannedDirs: rec.scannedDirs,
          knownBytes: rec.knownBytes,
          warningCount: rec.warningCount,
          currentPath: rec.currentPath
        })
        break
      case 'warning-count':
        rec.warningCount = Number(msg.count) || 0
        break
      case 'terminal': {
        const state = msg.state as ScanState
        if (msg.scannedFiles !== undefined) rec.scannedFiles = Number(msg.scannedFiles)
        if (msg.scannedDirs !== undefined) rec.scannedDirs = Number(msg.scannedDirs)
        if (msg.knownBytes !== undefined) rec.knownBytes = Number(msg.knownBytes)
        if (msg.warningCount !== undefined) rec.warningCount = Number(msg.warningCount)
        this.finishTask(rec, state, msg.error as string | undefined, msg.limitReason as ScanSnapshot['limitReason'])
        break
      }
      case 'query-result':
      case 'query-error':
      case 'warnings-result':
      case 'resolve-result': {
        const p = rec.pending.get(String(msg.requestId))
        if (p) {
          rec.pending.delete(String(msg.requestId))
          if (type === 'query-error') p.reject(new DiskError('PATH_NOT_FOUND', String(msg.error)))
          else p.resolve(msg)
        }
        break
      }
      default:
        break
    }
  }

  private finishTask(rec: TaskRecord, state: ScanState, error?: string, limitReason?: ScanSnapshot['limitReason']): void {
    if (rec.state === 'completed' || rec.state === 'canceled' || rec.state === 'failed' || rec.state === 'limited') return
    rec.state = state
    rec.error = error
    rec.limitReason = limitReason
    rec.finishedAt = Date.now()
    if (rec.cancelFallback) {
      clearTimeout(rec.cancelFallback)
      rec.cancelFallback = undefined
    }
    // Unblock a pending start() waiter (rejects unless fully indexed).
    if (rec.helloWaiter) {
      rec.helloWaiter(rec)
      rec.helloWaiter = null
    }
    this.emit(rec, 'state', { state, error, limitReason, finishedAt: rec.finishedAt })
    this.disposeTask(rec, true)
  }

  /** Release worker/channel. keepIndex=true keeps the worker alive for queries. */
  private disposeTask(rec: TaskRecord, keepIndex = false): void {
    if (rec.cancelFallback) {
      clearTimeout(rec.cancelFallback)
      rec.cancelFallback = undefined
    }
    if (rec.remote) {
      if (rec.remote.cancelTimer) clearInterval(rec.remote.cancelTimer)
      try {
        rec.remote.close()
      } catch {
        /* gone */
      }
      rec.remote = null
    }
    if (rec.worker && !keepIndex) {
      void rec.worker.terminate()
      rec.worker = null
    }
    for (const p of rec.pending.values()) p.reject(new DiskError('CONNECTION_LOST', 'Scan disposed'))
    rec.pending.clear()
  }

  async cancel(scanId: string, ownerId: number): Promise<void> {
    const rec = this.taskFor(scanId, ownerId)
    if (rec.state !== 'starting' && rec.state !== 'scanning') return
    rec.state = 'canceling'
    this.emit(rec, 'state', { state: 'canceling' })
    if (rec.remote) {
      writeCancel(rec.remote.stream)
      // 3s without a response → SSH TERM; 2s more → close the scan connection.
      rec.remote.cancelTimer = setTimeout(() => {
        try {
          void (rec.remote?.stream as unknown as { signal?: (s: string) => void }).signal?.('TERM')
        } catch {
          /* unsupported */
        }
        rec.remote!.cancelTimer = setTimeout(() => {
          this.finishTask(rec, 'canceled')
        }, 2000)
      }, 3000)
    } else {
      // Local scans have no protocol to abort — the worker normally honors
      // the cancel message within a second. If it is stuck (huge readdir,
      // hung filesystem call), end the task and kill the worker after 5s.
      rec.cancelFallback = setTimeout(() => {
        if (rec.state !== 'canceling') return
        this.finishTask(rec, 'canceled')
        if (rec.worker) {
          void rec.worker.terminate()
          rec.worker = null
        }
      }, 5000)
    }
    rec.worker?.postMessage({ cmd: 'cancel' })
  }

  /** Cancel and dispose everything owned by a closing analysis window. */
  async cancelOwner(ownerId: number): Promise<void> {
    for (const rec of [...this.tasks.values()]) {
      if (rec.ownerId !== ownerId) continue
      if (rec.state === 'starting' || rec.state === 'scanning' || rec.state === 'canceling') {
        await this.cancel(rec.scanId, ownerId)
      }
      this.disposeTask(rec)
      this.tasks.delete(rec.scanId)
    }
    for (const [id, plan] of this.plans) if (plan.ownerId === ownerId) this.plans.delete(id)
  }

  /** Vault lock / app shutdown: cancel everything. */
  async shutdown(): Promise<void> {
    for (const rec of this.tasks.values()) {
      this.disposeTask(rec)
    }
    this.tasks.clear()
    this.plans.clear()
    this.operations.clear()
  }

  forgetServer(serverId: string): void {
    forgetServer(serverId)
  }

  // ---------------- queries ----------------

  private workerCall<T>(rec: TaskRecord, msg: Record<string, unknown>): Promise<T> {
    if (!rec.worker) return Promise.reject(new DiskError('RESULT_STALE', 'Scan result was released'))
    const requestId = `r${++this.requestCounter}`
    return new Promise<T>((resolve, reject) => {
      rec.pending.set(requestId, { resolve: resolve as (v: unknown) => void, reject })
      rec.worker!.postMessage({ ...msg, requestId })
      setTimeout(() => {
        if (rec.pending.delete(requestId)) reject(new DiskError('PROTOCOL_ERROR', 'Query timed out'))
      }, 30_000)
    })
  }

  async directory(ownerId: number, query: DirectoryQuery): Promise<DirectoryView> {
    this.assertUnlocked()
    const rec = this.taskFor(query.scanId, ownerId)
    const res = (await this.workerCall(rec, { cmd: 'query', query })) as { view: DirectoryView }
    return res.view
  }

  async warnings(ownerId: number, scanId: string, offset: number, limit: number): Promise<WarningsPage> {
    this.assertUnlocked()
    const rec = this.taskFor(scanId, ownerId)
    const res = (await this.workerCall(rec, { cmd: 'warnings', offset, limit })) as {
      warnings: WarningsPage['warnings']
      total: number
    }
    return { scanId, warnings: res.warnings, total: res.total }
  }

  // ---------------- delete ----------------

  async prepareDelete(ownerId: number, scanId: string, revision: number, nodeIds: string[]): Promise<DeletePlan> {
    this.assertUnlocked()
    const rec = this.taskFor(scanId, ownerId)
    if (rec.state !== 'completed') throw new DiskError('RESULT_STALE', 'Delete requires a successfully completed scan')
    if (rec.stale) throw new DiskError('RESULT_STALE', 'Results are outdated — run Start Analysis again')
    if (rec.deleting) throw new DiskError('SCAN_BUSY', 'A delete operation is already running for this scan')
    if (revision !== rec.revision) throw new DiskError('RESULT_STALE', 'Results changed — review and try again')
    if (nodeIds.length === 0) throw new DiskError('INVALID_TARGET', 'Nothing selected')
    if (nodeIds.length > DISK_LIMITS.deleteMaxItems) {
      throw new DiskError('INVALID_TARGET', `Too many items (max ${DISK_LIMITS.deleteMaxItems})`)
    }

    const res = (await this.workerCall(rec, { cmd: 'resolve-delete', nodeIds })) as {
      targets: ResolvedTarget[]
      rejected: Array<{ nodeId: string; reason: string }>
    }
    const plan: StoredPlan = {
      planId: randomUUID(),
      scanId,
      revision,
      mode: rec.target.kind === 'local' ? 'local-trash' : 'remote-permanent',
      expiresAt: Date.now() + DISK_LIMITS.planTtlMs,
      targets: res.targets,
      rejected: res.rejected,
      estimatedBytes: res.targets.reduce((n, t) => n + t.knownBytes, 0),
      ownerId,
      scanRef: rec,
      consumed: false
    }
    this.plans.set(plan.planId, plan)
    const { ownerId: _o, scanRef: _s, consumed: _c, operationId: _op, ...pub } = plan
    return pub
  }

  private checkTransferConflicts(rec: TaskRecord, targets: ResolvedTarget[]): void {
    const active = this.deps.transfers.activePaths()
    const isRemote = rec.target.kind === 'ssh'
    for (const t of targets) {
      for (const a of active) {
        if (isRemote) {
          if (rec.target.kind === 'ssh' && a.serverId !== rec.target.serverId) continue
          if (this.pathsOverlap(t.path, a.remotePath)) {
            throw new DiskError('TRANSFER_CONFLICT', `An active transfer involves ${a.remotePath} — stop it first`)
          }
        } else if (this.pathsOverlap(t.path, a.localPath)) {
          throw new DiskError('TRANSFER_CONFLICT', `An active transfer involves ${a.localPath} — stop it first`)
        }
      }
    }
  }

  private pathsOverlap(a: string, b: string): boolean {
    const pa = a.endsWith('/') ? a : a + '/'
    const pb = b.endsWith('/') ? b : b + '/'
    return a === b || pa.startsWith(pb) || pb.startsWith(pa)
  }

  async executeDelete(ownerId: number, planId: string): Promise<{ operationId: string }> {
    this.assertUnlocked()
    const plan = this.plans.get(planId)
    if (!plan || plan.ownerId !== ownerId) throw new DiskError('INVALID_OWNER', 'Unknown delete plan')
    // Repeat execution of the same plan returns the same operation.
    if (plan.consumed && plan.operationId) return { operationId: plan.operationId }
    if (Date.now() > plan.expiresAt) throw new DiskError('PLAN_EXPIRED', 'Preview expired — prepare again')
    const rec = plan.scanRef
    if (rec.revision !== plan.revision || rec.stale) throw new DiskError('RESULT_STALE', 'Results changed — prepare again')
    this.checkTransferConflicts(rec, plan.targets)

    plan.consumed = true
    const operationId = randomUUID()
    plan.operationId = operationId
    const op: DeleteOperation & { ownerId: number; canceled: boolean } = {
      operationId,
      planId,
      state: 'running',
      results: [],
      startedAt: Date.now(),
      ownerId,
      canceled: false
    }
    this.operations.set(operationId, op)
    rec.deleting = true

    const total = plan.targets.length
    const onProgress = (done: number, t: number, currentItem: string): void => {
      this.emit(rec, 'delete-progress', { operationId, done, total: t, currentItem })
    }
    const isCanceled = (): boolean => op.canceled

    void (async () => {
      try {
        const results =
          plan.mode === 'local-trash'
            ? await executeLocalTrash(plan, rec.rootPath, { onProgress, isCanceled })
            : await executeRemoteDelete(this.deps.ssh, rec.profile!, rec.jump, plan, rec.rootPath, { onProgress, isCanceled })
        op.results = results
        op.state = op.canceled ? 'done' : 'done'
      } catch (e) {
        op.results = [...op.results, { path: '', status: 'failed', message: (e as Error).message }]
        op.state = 'done'
      } finally {
        op.finishedAt = Date.now()
        rec.deleting = false
        rec.stale = true
        this.emit(rec, 'delete-progress', { operationId, done: total, total, finished: true })
        this.emit(rec, 'state', { state: rec.state, stale: true })
        const affected = plan.targets.map((t) => t.path)
        this.deps.sendToMain(IPC.diskFilesChanged, { target: rec.target, affectedPaths: affected, operationId })
      }
    })()
    return { operationId }
  }

  cancelDelete(ownerId: number, operationId: string): void {
    const op = this.operations.get(operationId)
    if (!op || op.ownerId !== ownerId) throw new DiskError('INVALID_OWNER', 'Unknown operation')
    if (op.state === 'running') {
      op.canceled = true
      op.state = 'canceling'
    }
  }

  deleteSnapshot(ownerId: number, operationId: string): DeleteOperation {
    const op = this.operations.get(operationId)
    if (!op || op.ownerId !== ownerId) throw new DiskError('INVALID_OWNER', 'Unknown operation')
    const { ownerId: _o, canceled: _c, ...pub } = op
    return pub
  }

  // ---------------- open in Files ----------------

  async openInFiles(ownerId: number, scanId: string, nodeId: string): Promise<void> {
    this.assertUnlocked()
    const rec = this.taskFor(scanId, ownerId)
    const res = (await this.workerCall(rec, { cmd: 'resolve-delete', nodeIds: [nodeId] })) as {
      targets: ResolvedTarget[]
      rejected: Array<{ nodeId: string; reason: string }>
    }
    // resolve-delete rejects the root itself; opening the root is allowed.
    let targetPath: string
    let selectName: string | undefined
    let kind: string | undefined
    if (nodeId === rec.rootNodeId) {
      targetPath = rec.rootPath
      kind = 'directory'
    } else {
      if (res.targets.length === 0) throw new DiskError('PATH_NOT_FOUND', res.rejected[0]?.reason ?? 'Unknown node')
      const t = res.targets[0]
      if (t.expect.kind === 'directory') {
        targetPath = t.path
        kind = 'directory'
      } else {
        const idx = t.path.lastIndexOf('/')
        targetPath = idx > 0 ? t.path.slice(0, idx) : '/'
        selectName = t.path.slice(idx + 1)
        kind = t.expect.kind
      }
    }
    void kind
    const request: OpenInFilesRequest = {
      requestId: randomUUID(),
      target: rec.target,
      path: targetPath,
      selectName
    }
    this.deps.sendToMain(IPC.diskOpenInFilesRequest, request)
  }
}
