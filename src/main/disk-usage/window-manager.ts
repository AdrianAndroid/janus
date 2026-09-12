import { BrowserWindow } from 'electron'
import os from 'os'
import path from 'path'
import type { ServerProfile } from '@shared/types'
import type { DiskContext, DiskTarget } from '@shared/disk-usage'
import { IPC } from '@shared/ipc'

/**
 * Owns the independent Disk Usage windows. One window per device; reopening
 * restores and focuses. Windows are bound to their target at creation —
 * renderers can never switch device.
 */

export interface WindowManagerDeps {
  getMainWindow: () => BrowserWindow | null
  findServer: (id: string) => ServerProfile
  getTheme: () => string | undefined
  resolveDefaultPath: (target: DiskTarget) => Promise<string>
  onWindowClosed: (ownerId: number) => void
}

interface WinRecord {
  key: string
  win: BrowserWindow
  target: DiskTarget
  context: DiskContext
}

function keyFor(target: DiskTarget): string {
  return target.kind === 'local' ? 'local' : `ssh:${target.serverId}`
}

export class DiskWindowManager {
  private wins = new Map<string, WinRecord>()

  constructor(private deps: WindowManagerDeps) {}

  byOwner(senderId: number): WinRecord | undefined {
    for (const r of this.wins.values()) if (r.win.webContents.id === senderId) return r
    return undefined
  }

  sendToOwner(senderId: number, channel: string, payload: unknown): void {
    const r = this.byOwner(senderId)
    if (r && !r.win.isDestroyed()) r.win.webContents.send(channel, payload)
  }

  async openWindow(target: DiskTarget, initialPath?: string): Promise<void> {
    const key = keyFor(target)
    const existing = this.wins.get(key)
    if (existing && !existing.win.isDestroyed()) {
      if (existing.win.isMinimized()) existing.win.restore()
      existing.win.show()
      existing.win.focus()
      if (initialPath) {
        existing.win.webContents.send(IPC.diskEvent, {
          version: 1,
          scanId: '',
          seq: 0,
          revision: 0,
          type: 'path-request',
          payload: { requestedPath: initialPath }
        })
      }
      return
    }

    const context = await this.buildContext(target, initialPath)
    const win = new BrowserWindow({
      width: 1280,
      height: 800,
      minWidth: 960,
      minHeight: 640,
      backgroundColor: '#0a0b0d',
      autoHideMenuBar: true,
      title: context.title,
      webPreferences: {
        preload: path.join(__dirname, '../preload/disk-usage.js'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false
      }
    })
    const rec: WinRecord = { key, win, target, context }
    this.wins.set(key, rec)

    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (e) => e.preventDefault())
    win.on('closed', () => {
      this.wins.delete(key)
      this.deps.onWindowClosed(rec.win.webContents.id)
    })

    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl) {
      void win.loadURL(`${devUrl}/disk-usage.html`)
    } else {
      void win.loadFile(path.join(__dirname, '../renderer/disk-usage.html'))
    }
  }

  private async buildContext(target: DiskTarget, initialPath?: string): Promise<DiskContext> {
    const theme = this.deps.getTheme()
    if (target.kind === 'local') {
      return {
        target,
        title: 'Disk Usage · This Mac',
        subtitle: os.hostname(),
        initialPath: initialPath ?? (await this.deps.resolveDefaultPath(target)),
        theme
      }
    }
    const server = this.deps.findServer(target.serverId)
    return {
      target,
      title: `Disk Usage · ${server.name}`,
      subtitle: `${server.username}@${server.host}:${server.port || 22}`,
      initialPath: initialPath ?? (await this.deps.resolveDefaultPath(target)),
      theme
    }
  }

  contextFor(senderId: number): DiskContext | null {
    return this.byOwner(senderId)?.context ?? null
  }

  closeAll(): void {
    for (const r of this.wins.values()) {
      if (!r.win.isDestroyed()) r.win.destroy()
    }
    this.wins.clear()
  }
}
