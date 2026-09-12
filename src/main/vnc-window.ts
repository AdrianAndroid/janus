import { BrowserWindow } from 'electron'
import path from 'path'
import { randomUUID } from 'crypto'
import type { ServerProfile } from '@shared/types'
import type { SSHManager } from './ssh-manager'

// Standalone VNC popout windows. Reuses the SSH-tunneled WS bridge from
// SSHManager.startVnc; the window's renderer runs noVNC against it. Closing
// the window tears down its bridge session.

export interface VncContext {
  title: string
  wsPort: number
  password: string
}

interface PopoutRecord {
  win: BrowserWindow
  sessionId: string
  context: VncContext
}

export class VncWindowManager {
  private wins = new Map<number, PopoutRecord>()

  constructor(
    private ssh: SSHManager,
    private jumpFor: (p: ServerProfile) => ServerProfile | null
  ) {}

  async openPopout(profile: ServerProfile): Promise<void> {
    const sessionId = `vnc-popout-${randomUUID()}`
    const wsPort = await this.ssh.startVnc(sessionId, profile, this.jumpFor(profile))
    const context: VncContext = {
      title: `VNC · ${profile.name}`,
      wsPort,
      password: profile.vncPassword || ''
    }
    const win = new BrowserWindow({
      width: 1280,
      height: 820,
      minWidth: 640,
      minHeight: 400,
      backgroundColor: '#0a0b0d',
      autoHideMenuBar: true,
      title: context.title,
      webPreferences: {
        preload: path.join(__dirname, '../preload/vnc.js'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false
      }
    })
    const rec: PopoutRecord = { win, sessionId, context }
    this.wins.set(win.webContents.id, rec)
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (e) => e.preventDefault())
    win.on('closed', () => {
      this.wins.delete(win.webContents.id)
      this.ssh.stopVnc(sessionId)
    })
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl) {
      void win.loadURL(`${devUrl}/vnc.html`)
    } else {
      void win.loadFile(path.join(__dirname, '../renderer/vnc.html'))
    }
    // Make sure the popout is actually seen (new windows can open behind the
    // main window or in another Space on macOS).
    win.once('ready-to-show', () => {
      win.show()
      win.focus()
    })
  }

  contextFor(senderId: number): VncContext | null {
    return this.wins.get(senderId)?.context ?? null
  }

  closeAll(): void {
    for (const rec of this.wins.values()) {
      if (!rec.win.isDestroyed()) rec.win.destroy()
    }
    this.wins.clear()
  }
}
