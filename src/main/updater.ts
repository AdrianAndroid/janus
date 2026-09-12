import { app, BrowserWindow } from 'electron'
import pkg from 'electron-updater'
import type { UpdateStatus } from '@shared/types'
import { IPC } from '@shared/ipc'

// electron-updater is CommonJS; pull autoUpdater off the default export.
const { autoUpdater } = pkg

/**
 * Wires electron-updater to GitHub Releases and forwards progress to the
 * renderer over a single status channel. Auto-download is OFF — we let the
 * user decide, then install on quit.
 */
export function setupAutoUpdater(getWindow: () => BrowserWindow | null): void {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  const send = (status: UpdateStatus): void => {
    getWindow()?.webContents.send(IPC.updateOnStatus, status)
  }

  autoUpdater.on('checking-for-update', () => send({ phase: 'checking' }))
  autoUpdater.on('update-available', (info) =>
    send({ phase: 'available', version: info.version, releaseNotes: stringifyNotes(info.releaseNotes) })
  )
  autoUpdater.on('update-not-available', (info) => send({ phase: 'not-available', version: info.version }))
  autoUpdater.on('download-progress', (p) => send({ phase: 'downloading', percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', (info) => send({ phase: 'downloaded', version: info.version }))
  autoUpdater.on('error', (err) => {
    const msg = err?.message || String(err)
    // A dev/unconfigured build has no app-update.yml — don't alarm the user.
    if (msg.includes('app-update.yml') || msg.includes('ENOENT') || msg.includes('No published versions')) {
      send({ phase: 'not-available' })
      return
    }
    // Unsigned macOS build: Squirrel.Mac can't validate the signature. In-app
    // install is impossible without code signing → guide to manual download.
    if (msg.includes('code signature') || msg.includes('did not pass validation') || msg.includes('Could not get code signature')) {
      send({
        phase: 'error',
        error: 'macOS auto-update requires code signing. Install the new version from the download page.',
        manualOnly: true
      })
      return
    }
    send({ phase: 'error', error: msg })
  })

  // Quietly check on startup (only meaningful in a packaged, published build).
  if (app.isPackaged) {
    setTimeout(() => autoUpdater.checkForUpdates().catch(() => undefined), 4000)
  }
}

function stringifyNotes(notes: unknown): string | undefined {
  if (!notes) return undefined
  if (typeof notes === 'string') return notes
  if (Array.isArray(notes)) return notes.map((n) => (typeof n === 'string' ? n : n?.note ?? '')).join('\n')
  return undefined
}

export const updater = {
  check: () => autoUpdater.checkForUpdates(),
  download: () => autoUpdater.downloadUpdate(),
  install: () => autoUpdater.quitAndInstall(),
  version: () => app.getVersion()
}
