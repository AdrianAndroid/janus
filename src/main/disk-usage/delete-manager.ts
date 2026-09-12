import { promises as fs } from 'fs'
import { shell } from 'electron'
import type { ClientChannel } from 'ssh2'
import type { ServerProfile } from '@shared/types'
import type { DeleteItemResult, DeletePlan } from '@shared/disk-usage'
import { DiskError } from '@shared/disk-usage'
import type { SSHManager } from '../ssh-manager'
import { NdjsonParser } from './protocol'
import { openHelperChannel, writeCancel, writeEnvelope } from './remote-adapter'
import { assertDeletable, assertInsideRoot } from './path-guards'

/**
 * Executes confirmed delete plans. Local: Move to Trash via shell.trashItem
 * (no silent fallback to permanent delete). Remote: permanent delete through
 * the packaged Python helper (dir_fd + O_NOFOLLOW walk, mount boundary).
 * Failures keep their real reasons; one item's failure never aborts others.
 */

export interface DeleteRunCallbacks {
  onProgress: (done: number, total: number, currentItem: string) => void
  isCanceled: () => boolean
}

async function verifyLocalIdentity(
  target: DeletePlan['targets'][number]
): Promise<{ ok: boolean; message?: string; missing?: boolean }> {
  try {
    const st = await fs.lstat(target.path)
    if (target.expect.dev && String(st.dev) !== target.expect.dev) return { ok: false, message: 'PATH_CHANGED' }
    if (target.expect.ino && String(st.ino) !== target.expect.ino) return { ok: false, message: 'PATH_CHANGED' }
    const kind = st.isSymbolicLink() ? 'symlink' : st.isDirectory() ? 'directory' : st.isFile() ? 'file' : 'other'
    if (kind !== target.expect.kind) return { ok: false, message: 'PATH_CHANGED' }
    if (kind === 'file' && target.expect.size !== null && st.size !== target.expect.size) {
      return { ok: false, message: 'PATH_CHANGED' }
    }
    return { ok: true }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { ok: false, missing: true }
    return { ok: false, message: (e as Error).message }
  }
}

export async function executeLocalTrash(plan: DeletePlan, rootPath: string, cb: DeleteRunCallbacks): Promise<DeleteItemResult[]> {
  const results: DeleteItemResult[] = []
  const total = plan.targets.length
  let done = 0
  for (const target of plan.targets) {
    if (cb.isCanceled()) {
      results.push({ path: target.path, status: 'skipped', message: 'Canceled' })
      cb.onProgress(++done, total, target.path)
      continue
    }
    cb.onProgress(done, total, target.path)
    try {
      assertDeletable(target.path)
      assertInsideRoot(rootPath, target.path, false)
      const check = await verifyLocalIdentity(target)
      if (check.missing) {
        results.push({ path: target.path, status: 'not-found' })
      } else if (!check.ok) {
        results.push({ path: target.path, status: 'failed', message: check.message })
      } else {
        await shell.trashItem(target.path)
        results.push({ path: target.path, status: 'succeeded' })
      }
    } catch (e) {
      const code = e instanceof DiskError ? e.code : 'TRASH_FAILED'
      results.push({ path: target.path, status: 'failed', message: `${code}: ${(e as Error).message}` })
    }
    cb.onProgress(++done, total, target.path)
  }
  return results
}

export async function executeRemoteDelete(
  ssh: SSHManager,
  profile: ServerProfile,
  jump: ServerProfile | null,
  plan: DeletePlan,
  rootPath: string,
  cb: DeleteRunCallbacks
): Promise<DeleteItemResult[]> {
  for (const target of plan.targets) {
    assertDeletable(target.path)
    assertInsideRoot(rootPath, target.path, true)
  }

  let handle: { stream: ClientChannel; close: () => void }
  try {
    handle = await openHelperChannel(ssh, profile, jump)
  } catch (e) {
    throw new DiskError('CONNECTION_LOST', (e as Error).message)
  }
  const { stream, close } = handle

  return new Promise<DeleteItemResult[]>((resolve) => {
    const results: DeleteItemResult[] = []
    const total = plan.targets.length
    let settled = false
    const stderr: Buffer[] = []

    const finish = (final: DeleteItemResult[]): void => {
      if (settled) return
      settled = true
      close()
      resolve(final)
    }

    const cancelWatcher = setInterval(() => {
      if (cb.isCanceled()) writeCancel(stream)
    }, 500)

    const parser = new NdjsonParser(
      (msg) => {
        if (msg.type === 'delete-item') {
          results.push({
            path: String(msg.path ?? ''),
            status: msg.status as DeleteItemResult['status'],
            message: msg.message as string | undefined
          })
          cb.onProgress(results.length, total, String(msg.path ?? ''))
        } else if (msg.type === 'terminal') {
          clearInterval(cancelWatcher)
          const reported = (msg.results as DeleteItemResult[] | undefined) ?? results
          finish(reported)
        }
      },
      (err) => {
        clearInterval(cancelWatcher)
        // Protocol broke mid-operation: the item in flight is UNKNOWN.
        if (results.length < total) {
          results.push({ path: plan.targets[results.length]?.path ?? '', status: 'unknown', message: err.message })
        }
        finish(results)
      }
    )

    stream.on('data', (chunk: Buffer) => parser.push(chunk))
    stream.stderr.on('data', (chunk: Buffer) => {
      stderr.push(chunk)
      const size = stderr.reduce((n, b) => n + b.length, 0)
      while (size > 64 * 1024 && stderr.length > 1) stderr.shift()
    })
    stream.on('close', (code?: number) => {
      clearInterval(cancelWatcher)
      parser.end()
      if (!settled) {
        if (results.length < total) {
          results.push({
            path: plan.targets[results.length]?.path ?? '',
            status: 'unknown',
            message: `CONNECTION_LOST: channel closed (code ${String(code)})`
          })
        }
        finish(results)
      }
    })
    stream.on('error', () => {
      clearInterval(cancelWatcher)
      if (results.length < total) {
        results.push({ path: plan.targets[results.length]?.path ?? '', status: 'unknown', message: 'CONNECTION_LOST' })
      }
      finish(results)
    })

    writeEnvelope(stream, {
      version: 1,
      action: 'delete',
      rootPath,
      items: plan.targets.map((t) => ({ path: t.path, expect: t.expect }))
    }).catch((e) => {
      clearInterval(cancelWatcher)
      finish([{ path: '', status: 'failed', message: (e as Error).message }])
    })
  })
}
