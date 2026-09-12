import { app, shell, BrowserWindow, Rectangle } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync } from 'fs'
import { registerIpc } from './ipc'
import { registerMediaScheme } from './media'
import type { DiskRuntime } from './disk-usage/ipc'

// Custom streaming protocol for the media player — must register before ready.
registerMediaScheme()

let diskRuntime: DiskRuntime | null = null

let mainWindow: BrowserWindow | null = null

// --- Window bounds memory ------------------------------------------------
const boundsFile = (): string => join(app.getPath('userData'), 'window-state.json')

function loadBounds(): Partial<Rectangle> | null {
  try {
    return JSON.parse(readFileSync(boundsFile(), 'utf8'))
  } catch {
    return null
  }
}

function saveBounds(): void {
  if (!mainWindow || mainWindow.isMinimized()) return
  try {
    writeFileSync(boundsFile(), JSON.stringify(mainWindow.getBounds()), 'utf8')
  } catch {
    /* ignore */
  }
}

function createWindow(): void {
  const saved = loadBounds()
  mainWindow = new BrowserWindow({
    width: saved?.width ?? 1280,
    height: saved?.height ?? 820,
    x: saved?.x,
    y: saved?.y,
    minWidth: 920,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#0a0b0d',
    title: 'Janus',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  // Remember size/position.
  mainWindow.on('resize', saveBounds)
  mainWindow.on('move', saveBounds)
  mainWindow.on('close', () => {
    saveBounds()
    // No orphaned management windows: close analysis windows with the main one.
    diskRuntime?.closeAllWindows()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // electron-vite injects ELECTRON_RENDERER_URL in dev.
  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  diskRuntime = registerIpc(() => mainWindow)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
