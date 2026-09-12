import { ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import type { ServerProfile, IpcResult } from '@shared/types'
import type { DirectoryQuery, DiskTarget } from '@shared/disk-usage'
import { DiskError } from '@shared/disk-usage'
import { IPC } from '@shared/ipc'
import type { SSHManager } from '../ssh-manager'
import type { TransferManager } from '../transfer-manager'
import { DiskUsageManager } from './manager'
import { DiskWindowManager } from './window-manager'

/**
 * Registers all disk:* channels. Two trust boundaries:
 *  - the MAIN window may only call disk:open-window
 *  - analysis windows call the rest, and only for scans/plans they own
 * Every handler verifies its sender.
 */

export interface DiskIpcDeps {
  getWindow: () => BrowserWindow | null
  ssh: SSHManager
  transfers: TransferManager
  isUnlocked: () => boolean
  findServer: (id: string) => ServerProfile
  jumpFor: (p: ServerProfile) => ServerProfile | null
  getTheme: () => string | undefined
  resolveDefaultPath: (target: DiskTarget) => Promise<string>
}

export interface DiskRuntime {
  manager: DiskUsageManager
  windows: DiskWindowManager
  shutdown: () => Promise<void>
  closeAllWindows: () => void
}

function wrap<T>(fn: () => Promise<T> | T): Promise<IpcResult<T>> {
  return Promise.resolve()
    .then(fn)
    .then((data) => ({ ok: true, data }) as IpcResult<T>)
    .catch((err) => {
      const e = err as Error & { code?: string }
      return { ok: false, error: e.message, code: e.code } as IpcResult<T>
    })
}

export function registerDiskIpc(deps: DiskIpcDeps): DiskRuntime {
  const windows = new DiskWindowManager({
    getMainWindow: deps.getWindow,
    findServer: deps.findServer,
    getTheme: deps.getTheme,
    resolveDefaultPath: deps.resolveDefaultPath,
    onWindowClosed: (ownerId) => void manager.cancelOwner(ownerId)
  })
  const manager = new DiskUsageManager({
    ssh: deps.ssh,
    transfers: deps.transfers,
    isUnlocked: deps.isUnlocked,
    findServer: deps.findServer,
    jumpFor: deps.jumpFor,
    sendToOwner: (ownerId, channel, payload) => windows.sendToOwner(ownerId, channel, payload),
    sendToMain: (channel, payload) => deps.getWindow()?.webContents.send(channel, payload)
  })

  const fromMain = (sender: Electron.WebContents): boolean => sender.id === deps.getWindow()?.webContents.id

  const requireOwner = (sender: Electron.WebContents): number => {
    const rec = windows.byOwner(sender.id)
    if (!rec) throw new DiskError('INVALID_OWNER', 'Sender is not a registered analysis window')
    if (!deps.isUnlocked()) throw new DiskError('VAULT_LOCKED', 'Vault is locked')
    return sender.id
  }

  const handle = <T>(channel: string, fn: (ownerId: number, ...args: unknown[]) => Promise<T> | T): void => {
    ipcMain.handle(channel, (e, ...args) => wrap(() => fn(requireOwner(e.sender), ...args)))
  }

  // Main window only: open/focus an analysis window.
  ipcMain.handle(IPC.diskOpenWindow, (e, ...args) =>
    wrap(async () => {
      if (!fromMain(e.sender)) throw new DiskError('INVALID_OWNER', 'Only the main window can open Disk Usage')
      if (!deps.isUnlocked()) throw new DiskError('VAULT_LOCKED', 'Vault is locked')
      const req = (args[0] ?? {}) as { target?: DiskTarget; initialPath?: string }
      if (!req.target || (req.target.kind !== 'local' && req.target.kind !== 'ssh')) {
        throw new DiskError('INVALID_TARGET', 'Missing or invalid target')
      }
      if (req.target.kind === 'ssh') deps.findServer(req.target.serverId) // validates
      await windows.openWindow(req.target, req.initialPath)
      return true
    })
  )

  handle(IPC.diskContext, (ownerId) => windows.contextFor(ownerId))
  handle(IPC.diskBrowse, async (ownerId, ...a) => {
    const ctx = windows.contextFor(ownerId)!
    const p = (a[0] ?? {}) as { path?: string }
    if (ctx.target.kind === 'local') {
      const { localList, localHome } = await import('../local-fs')
      const target = p.path?.trim() || (await localHome())
      const { cwd, entries } = await localList(target)
      const parent = cwd === '/' ? null : cwd.replace(/\/+$/, '').split('/').slice(0, -1).join('/') || '/'
      return {
        cwd,
        parent,
        dirs: entries.filter((x) => x.type === 'directory').map((x) => ({ name: x.name, path: x.path }))
      }
    }
    const profile = deps.findServer(ctx.target.serverId)
    const { cwd, entries } = await deps.ssh.sftpList(profile, p.path?.trim() || '.', deps.jumpFor(profile))
    const parent = cwd === '/' ? null : cwd.replace(/\/+$/, '').split('/').slice(0, -1).join('/') || '/'
    return {
      cwd,
      parent,
      dirs: entries.filter((x) => x.type === 'directory').map((x) => ({ name: x.name, path: x.path }))
    }
  })
  handle(IPC.diskStart, (ownerId, ...a) => {
    const ctx = windows.contextFor(ownerId)!
    const p = (a[0] ?? {}) as { rootPath?: string }
    return manager.start(ownerId, ctx.target, String(p.rootPath ?? ''))
  })
  handle(IPC.diskCancel, (ownerId, ...a) => manager.cancel(String((a[0] as { scanId?: string })?.scanId ?? ''), ownerId))
  handle(IPC.diskSnapshot, (ownerId, ...a) => manager.snapshotFor((a[0] as { scanId?: string })?.scanId, ownerId))
  handle(IPC.diskDirectory, (ownerId, ...a) => manager.directory(ownerId, a[0] as DirectoryQuery))
  handle(IPC.diskWarnings, (ownerId, ...a) => {
    const p = (a[0] ?? {}) as { scanId?: string; offset?: number; limit?: number }
    return manager.warnings(ownerId, String(p.scanId ?? ''), Number(p.offset) || 0, Number(p.limit) || 100)
  })
  handle(IPC.diskPrepareDelete, (ownerId, ...a) => {
    const p = (a[0] ?? {}) as { scanId?: string; revision?: number; nodeIds?: string[] }
    return manager.prepareDelete(ownerId, String(p.scanId ?? ''), Number(p.revision ?? -1), p.nodeIds ?? [])
  })
  handle(IPC.diskExecuteDelete, (ownerId, ...a) => manager.executeDelete(ownerId, String((a[0] as { planId?: string })?.planId ?? '')))
  handle(IPC.diskCancelDelete, (ownerId, ...a) => {
    manager.cancelDelete(ownerId, String((a[0] as { operationId?: string })?.operationId ?? ''))
    return true
  })
  handle(IPC.diskDeleteSnapshot, (ownerId, ...a) =>
    manager.deleteSnapshot(ownerId, String((a[0] as { operationId?: string })?.operationId ?? ''))
  )
  handle(IPC.diskOpenInFiles, async (ownerId, ...a) => {
    const p = (a[0] ?? {}) as { scanId?: string; nodeId?: string }
    await manager.openInFiles(ownerId, String(p.scanId ?? ''), String(p.nodeId ?? ''))
    const win = deps.getWindow()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
    return true
  })

  return {
    manager,
    windows,
    shutdown: () => manager.shutdown(),
    closeAllWindows: () => windows.closeAll()
  }
}
