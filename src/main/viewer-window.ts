import { app, BrowserWindow } from 'electron'
import path from 'path'
import { readFileSync, writeFileSync } from 'fs'
import type { ViewerContextPayload, ViewerKind, ViewerProgressReq } from '@shared/viewer'

// Standalone document viewer windows (PDF/Office/text/image). Bytes always
// come from the janus-media:// protocol in the renderer — the main process
// only owns the window, its context, and the PDF page-progress store.

interface ViewerRecord {
  win: BrowserWindow
  context: ViewerContextPayload
}

function progressFile(): string {
  return path.join(app.getPath('userData'), 'viewer-progress.json')
}

function readViewerProgress(): Record<string, { page: number; at: number }> {
  try {
    return JSON.parse(readFileSync(progressFile(), 'utf8')) as Record<string, { page: number; at: number }>
  } catch {
    return {}
  }
}

function saveViewerProgress(key: string, page: number): void {
  try {
    const map = readViewerProgress()
    map[key] = { page, at: Date.now() }
    writeFileSync(progressFile(), JSON.stringify(map))
  } catch {
    /* ignore */
  }
}

export class ViewerWindowManager {
  private wins = new Map<number, ViewerRecord>()

  openViewer(serverId: string | undefined, filePath: string, kind: ViewerKind, serverName?: string): void {
    const name = filePath.split(/[\\/]/).pop() || filePath
    const context: ViewerContextPayload = {
      title: serverName ? `${name} · ${serverName}` : name,
      serverId,
      path: filePath,
      kind
    }
    const win = new BrowserWindow({
      width: 1100,
      height: 760,
      minWidth: 560,
      minHeight: 400,
      backgroundColor: '#0a0b0d',
      autoHideMenuBar: true,
      title: context.title,
      webPreferences: {
        preload: path.join(__dirname, '../preload/viewer.js'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false
      }
    })
    this.wins.set(win.webContents.id, { win, context })
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (e) => e.preventDefault())
    win.webContents.on('render-process-gone', (_e, details) => {
      // A crashed viewer never takes the app down — just close its window.
      console.error(`[viewer] render process gone (${details.reason}): ${filePath}`)
      if (!win.isDestroyed()) win.destroy()
    })
    win.on('closed', () => this.wins.delete(win.webContents.id))
    win.once('ready-to-show', () => {
      win.show()
      win.focus()
    })
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl) {
      void win.loadURL(`${devUrl}/viewer.html`)
    } else {
      void win.loadFile(path.join(__dirname, '../renderer/viewer.html'))
    }
  }

  contextFor(senderId: number): (ViewerContextPayload & { progress?: { page: number } }) | null {
    const rec = this.wins.get(senderId)
    if (!rec) return null
    const key = rec.context.serverId ? `${rec.context.serverId}:${rec.context.path}` : rec.context.path
    const progress = readViewerProgress()[key]
    return { ...rec.context, progress }
  }

  saveProgress(senderId: number, req: ViewerProgressReq): void {
    if (!this.wins.has(senderId)) return
    saveViewerProgress(req.key, req.page)
  }

  closeAll(): void {
    for (const rec of this.wins.values()) {
      if (!rec.win.isDestroyed()) rec.win.destroy()
    }
    this.wins.clear()
  }
}
