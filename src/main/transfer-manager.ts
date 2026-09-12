import { promises as fs, createReadStream, createWriteStream } from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import type {
  ConflictAction,
  ServerProfile,
  TransferConflict,
  TransferDirection,
  TransferRequest,
  TransferTask
} from '@shared/types'
import { IPC } from '@shared/ipc'
import type { SSHManager } from './ssh-manager'

const MAX_CONCURRENT = 3

interface FileItem {
  local: string
  remote: string
  size: number
  /** Bytes confirmed written at the destination (resume offset). */
  offset: number
  done: boolean
}

interface InternalTask extends TransferTask {
  profile: ServerProfile
  jump: ServerProfile | null
  files: FileItem[]
  fileIndex: number
  cancelFlag: boolean
  destroyActive: (() => void) | null
  conflictWaiter: ((res: { action: ConflictAction; newName?: string }) => void) | null
  lastEmit: number
}

type EmitFn = (channel: string, payload: unknown) => void
type FindFn = (serverId: string) => { profile: ServerProfile; jump: ServerProfile | null }

/**
 * Queue-based SFTP transfer engine. Chunked stream copies with byte-offset
 * resume, conflict negotiation via renderer events, max MAX_CONCURRENT tasks.
 */
export class TransferManager {
  private tasks = new Map<string, InternalTask>()

  constructor(
    private ssh: SSHManager,
    private emit: EmitFn,
    private find: FindFn
  ) {}

  list(): TransferTask[] {
    return [...this.tasks.values()].map((t) => this.public(t))
  }

  start(req: TransferRequest): string {
    const { profile, jump } = this.find(req.serverId)
    const name = (req.direction === 'upload' ? req.localPath : req.remotePath).split(/[\\/]/).pop() || 'transfer'
    const task: InternalTask = {
      id: randomUUID(),
      serverId: req.serverId,
      direction: req.direction,
      name,
      localPath: req.localPath,
      remotePath: req.remotePath,
      isDir: req.isDir,
      size: 0,
      transferred: 0,
      status: 'queued',
      profile,
      jump,
      files: [],
      fileIndex: 0,
      cancelFlag: false,
      destroyActive: null,
      conflictWaiter: null,
      lastEmit: 0
    }
    this.tasks.set(task.id, task)
    this.emitTask(task, true)
    void this.pump()
    return task.id
  }

  cancel(id: string): void {
    const t = this.tasks.get(id)
    if (!t) return
    if (t.status === 'queued' || t.status === 'scanning' || t.status === 'waiting-conflict') {
      t.cancelFlag = true
      t.conflictWaiter?.({ action: 'skip' })
      this.setStatus(t, 'canceled')
      return
    }
    if (t.status !== 'running') return
    t.cancelFlag = true
    t.destroyActive?.()
  }

  resume(id: string): void {
    const t = this.tasks.get(id)
    if (!t || (t.status !== 'canceled' && t.status !== 'interrupted' && t.status !== 'error')) return
    t.cancelFlag = false
    t.error = undefined
    t.status = 'queued'
    this.emitTask(t, true)
    void this.pump()
  }

  resolve(id: string, action: ConflictAction, newName?: string): void {
    const t = this.tasks.get(id)
    t?.conflictWaiter?.({ action, newName })
  }

  /** Drop finished tasks (done/error/canceled) from the list. */
  clear(): void {
    for (const [id, t] of this.tasks) {
      if (t.status === 'done' || t.status === 'error' || t.status === 'canceled') this.tasks.delete(id)
    }
  }

  // ---------------- internals ----------------

  private public(t: InternalTask): TransferTask {
    const { profile: _p, jump: _j, files: _f, cancelFlag: _c, destroyActive: _d, conflictWaiter: _w, lastEmit: _l, fileIndex: _i, ...rest } = t
    return { ...rest }
  }

  private emitTask(t: InternalTask, force = false): void {
    const now = Date.now()
    if (!force && now - t.lastEmit < 150) return
    t.lastEmit = now
    this.emit(IPC.transferProgress, this.public(t))
  }

  private setStatus(t: InternalTask, status: TransferTask['status'], error?: string): void {
    t.status = status
    if (error) t.error = error
    if (status === 'done' || status === 'error' || status === 'canceled' || status === 'interrupted') {
      t.finishedAt = Date.now()
    }
    this.emitTask(t, true)
  }

  private runningCount(): number {
    let n = 0
    for (const t of this.tasks.values()) if (t.status === 'running' || t.status === 'scanning') n++
    return n
  }

  private async pump(): Promise<void> {
    for (const t of this.tasks.values()) {
      if (this.runningCount() >= MAX_CONCURRENT) return
      if (t.status !== 'queued') continue
      void this.run(t).catch((e) => {
        if (t.status !== 'canceled') this.setStatus(t, 'error', (e as Error).message)
      })
    }
  }

  private async run(t: InternalTask): Promise<void> {
    if (!t.startedAt) t.startedAt = Date.now()
    try {
      if (t.isDir && t.files.length === 0) {
        this.setStatus(t, 'scanning')
        await this.scan(t)
        if (t.cancelFlag) return this.setStatus(t, 'canceled')
      }
      if (!t.isDir && t.files.length === 0) {
        const size = await this.sourceSize(t)
        t.files = [{ local: t.localPath, remote: t.remotePath, size, offset: 0, done: false }]
        t.size = size
      }
      this.setStatus(t, 'running')
      for (; t.fileIndex < t.files.length; t.fileIndex++) {
        if (t.cancelFlag) return this.setStatus(t, 'canceled')
        await this.transferFile(t, t.files[t.fileIndex])
      }
      t.transferred = t.size
      this.setStatus(t, 'done')
    } catch (e) {
      if (t.cancelFlag || t.status === 'canceled') {
        this.setStatus(t, 'canceled')
      } else if ((e as Error).message === 'INTERRUPTED') {
        this.setStatus(t, 'interrupted', 'Connection lost — resume to continue.')
      } else {
        this.setStatus(t, 'error', (e as Error).message)
      }
    } finally {
      t.destroyActive = null
      void this.pump()
    }
  }

  private async sourceSize(t: InternalTask): Promise<number> {
    if (t.direction === 'upload') {
      const st = await fs.stat(t.localPath)
      return st.size
    }
    const st = await this.ssh.sftpStat(t.profile, t.remotePath, t.jump)
    if (!st) throw new Error(`Remote file not found: ${t.remotePath}`)
    return st.size
  }

  /** Build the file manifest for a folder transfer and create target dirs. */
  private async scan(t: InternalTask): Promise<void> {
    const files: FileItem[] = []
    if (t.direction === 'upload') {
      const dirs = new Set<string>()
      const walk = async (localDir: string, remoteDir: string): Promise<void> => {
        dirs.add(remoteDir)
        const dirents = await fs.readdir(localDir, { withFileTypes: true })
        for (const d of dirents) {
          if (t.cancelFlag) return
          const lp = path.join(localDir, d.name)
          const rp = `${remoteDir.replace(/\/$/, '')}/${d.name}`
          if (d.isDirectory()) {
            await walk(lp, rp)
          } else if (d.isFile()) {
            const st = await fs.stat(lp)
            files.push({ local: lp, remote: rp, size: st.size, offset: 0, done: false })
          } else if (d.isSymbolicLink()) {
            // Follow file links only; skip directory links to avoid loops.
            try {
              const st = await fs.stat(lp)
              if (st.isFile()) files.push({ local: lp, remote: rp, size: st.size, offset: 0, done: false })
            } catch {
              /* broken link — skip */
            }
          }
        }
      }
      await walk(t.localPath, t.remotePath)
      for (const dir of dirs) {
        if (t.cancelFlag) return
        await this.ssh.sftpMakedirs(t.profile, dir, t.jump)
      }
    } else {
      const sftp = await this.ssh.getSftp(t.profile, t.jump)
      const localDirs = new Set<string>()
      const walk = async (remoteDir: string, localDir: string): Promise<void> => {
        localDirs.add(localDir)
        const list = await new Promise<import('ssh2').FileEntryWithStats[]>((resolve, reject) => {
          sftp.readdir(remoteDir, (err, l) => (err ? reject(err) : resolve(l)))
        })
        for (const e of list) {
          if (t.cancelFlag) return
          if (e.filename === '.' || e.filename === '..') continue
          const rp = `${remoteDir.replace(/\/$/, '')}/${e.filename}`
          const lp = path.join(localDir, e.filename)
          if (e.attrs.isDirectory()) {
            await walk(rp, lp)
          } else if (e.attrs.isFile() && !e.attrs.isSymbolicLink()) {
            files.push({ local: lp, remote: rp, size: e.attrs.size, offset: 0, done: false })
          }
        }
      }
      await walk(t.remotePath, t.localPath)
      for (const dir of localDirs) {
        if (t.cancelFlag) return
        await fs.mkdir(dir, { recursive: true })
      }
    }
    t.files = files
    t.size = files.reduce((n, f) => n + f.size, 0)
  }

  private async targetSize(t: InternalTask, item: FileItem): Promise<number | null> {
    if (t.direction === 'upload') {
      const st = await this.ssh.sftpStat(t.profile, item.remote, t.jump)
      return st && !st.isDirectory ? st.size : null
    }
    try {
      const st = await fs.stat(item.local)
      return st.isFile() ? st.size : null
    } catch {
      return null
    }
  }

  private applyRename(t: InternalTask, item: FileItem, newName: string): void {
    if (t.direction === 'upload') {
      const dir = item.remote.split('/').slice(0, -1).join('/')
      item.remote = `${dir}/${newName}`
    } else {
      item.local = path.join(path.dirname(item.local), newName)
    }
  }

  private async transferFile(t: InternalTask, item: FileItem): Promise<void> {
    if (item.done) return

    // Restarting after cancel/interrupt: trust the recorded offset when the
    // destination still matches it, otherwise restart this file cleanly.
    if (item.offset > 0) {
      const target = await this.targetSize(t, item)
      if (target === item.size) {
        item.done = true
        return
      }
      if (target !== item.offset) {
        t.transferred -= item.offset
        item.offset = 0
      }
    }

    // Conflict negotiation on first touch of a file.
    if (item.offset === 0) {
      for (;;) {
        const target = await this.targetSize(t, item)
        if (target === null) break
        if (target === item.size && item.size > 0) {
          // Same size already there — count it and move on.
          item.offset = item.size
          item.done = true
          t.transferred += item.size
          this.emitTask(t)
          return
        }
        this.setStatus(t, 'waiting-conflict')
        const conflict: TransferConflict = {
          taskId: t.id,
          direction: t.direction,
          name: item.remote.split('/').pop() || item.local,
          sourceSize: item.size,
          targetSize: target,
          canResume: target > 0 && target < item.size
        }
        this.emit(IPC.transferConflict, conflict)
        const res = await new Promise<{ action: ConflictAction; newName?: string }>((resolve) => {
          t.conflictWaiter = resolve
        })
        t.conflictWaiter = null
        if (t.cancelFlag) throw new Error('CANCELED')
        t.status = 'running'
        this.emitTask(t, true)
        if (res.action === 'skip') {
          item.done = true
          t.transferred += item.size - item.offset
          this.emitTask(t)
          return
        }
        if (res.action === 'overwrite') {
          item.offset = 0
          break
        }
        if (res.action === 'resume') {
          item.offset = target
          t.transferred += target
          break
        }
        if (res.action === 'rename' && res.newName) {
          this.applyRename(t, item, res.newName)
          continue
        }
        break
      }
    }

    await this.copy(t, item)
    item.done = true
  }

  /** Stream one file from its offset; throws 'INTERRUPTED' on connection loss. */
  private async copy(t: InternalTask, item: FileItem): Promise<void> {
    const offset = item.offset
    let rs: import('stream').Readable
    let ws: import('stream').Writable
    if (t.direction === 'upload') {
      rs = createReadStream(item.local, { start: offset, highWaterMark: 1024 * 1024 })
      const sftp = await this.ssh.getSftp(t.profile, t.jump)
      ws = sftp.createWriteStream(item.remote, offset > 0 ? { flags: 'r+', start: offset } : { flags: 'w' })
    } else {
      await fs.mkdir(path.dirname(item.local), { recursive: true })
      const sftp = await this.ssh.getSftp(t.profile, t.jump)
      rs = sftp.createReadStream(item.remote, { start: offset })
      ws = createWriteStream(item.local, offset > 0 ? { flags: 'r+', start: offset } : { flags: 'w' })
    }

    await new Promise<void>((resolve, reject) => {
      const toError = (e: Error): Error => {
        if (t.cancelFlag) return new Error('CANCELED')
        return /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|timed out|connection.*(closed|reset|lost)|no response/i.test(e.message)
          ? new Error('INTERRUPTED')
          : e
      }
      const fail = (e: Error): void => {
        t.destroyActive = null
        rs.destroy()
        ws.destroy()
        reject(toError(e))
      }
      t.destroyActive = () => fail(new Error('CANCELED'))
      rs.on('data', (chunk: Buffer) => {
        item.offset += chunk.length
        t.transferred += chunk.length
        this.emitTask(t)
      })
      rs.on('error', fail)
      ws.on('error', fail)
      ws.on('finish', () => {
        t.destroyActive = null
        resolve()
      })
      rs.pipe(ws)
    }).catch((e: Error) => {
      if (e.message === 'CANCELED' || t.cancelFlag) throw new Error('CANCELED')
      throw e
    })
  }
}
