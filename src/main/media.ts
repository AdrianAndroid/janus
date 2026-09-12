import { app, BrowserWindow, protocol } from 'electron'
import { createReadStream, promises as fs, readFileSync, writeFileSync } from 'fs'
import { Readable } from 'stream'
import path from 'path'
import type { ServerProfile } from '@shared/types'
import type { SSHManager } from './ssh-manager'

// Video player: streams local or remote (SFTP) media into a separate
// BrowserWindow through the custom `janus-media://` protocol with HTTP Range
// support, so large remote files play without a full download.
// Note: playback depends on Chromium codecs — mp4/H.264/WebM work well,
// MKV/AVI/HEVC containers may not play.

export const MEDIA_SCHEME = 'janus-media'

/** Must run before app 'ready'. */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: MEDIA_SCHEME, privileges: { stream: true, supportFetchAPI: true, bypassCSP: true } }
  ])
}

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.wmv': 'video/x-ms-wmv',
  '.flv': 'video/x-flv',
  '.ts': 'video/mp2t',
  '.mpg': 'video/mpeg',
  '.mpeg': 'video/mpeg',
  '.3gp': 'video/3gpp',
  '.rmvb': 'application/vnd.rn-realmedia-vbr'
}

type FindFn = (serverId: string) => { profile: ServerProfile; jump: ServerProfile | null }

interface MediaSource {
  size: number
  stream: (start: number, end?: number) => Readable
}

/** Install the protocol handler. Call after app 'ready'. */
export function setupMediaProtocol(ssh: SSHManager, find: FindFn): void {
  protocol.handle(MEDIA_SCHEME, async (req) => {
    try {
      const url = new URL(req.url)
      const filePath = url.searchParams.get('path') || ''
      const serverId = url.searchParams.get('server') || ''
      if (!filePath) return new Response('Missing path', { status: 400 })

      let src: MediaSource
      if (serverId) {
        const { profile, jump } = find(serverId)
        const st = await ssh.sftpStat(profile, filePath, jump)
        if (!st || st.isDirectory) return new Response('Not found', { status: 404 })
        const sftp = await ssh.getSftp(profile, jump)
        src = {
          size: st.size,
          stream: (start, end) =>
            sftp.createReadStream(filePath, end === undefined ? { start } : { start, end }) as unknown as Readable
        }
      } else {
        const st = await fs.stat(filePath)
        src = {
          size: st.size,
          stream: (start, end) => createReadStream(filePath, end === undefined ? { start } : { start, end })
        }
      }

      const mime = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream'
      const headers: Record<string, string> = {
        'Accept-Ranges': 'bytes',
        'Content-Type': mime
      }

      // Parse "bytes=start-end" (end inclusive, either side optional).
      const range = req.headers.get('range')
      if (range) {
        const m = /bytes=(\d*)-(\d*)/.exec(range)
        let start = m?.[1] ? parseInt(m[1], 10) : 0
        let end = m?.[2] ? parseInt(m[2], 10) : src.size - 1
        if (!m?.[1] && m?.[2]) {
          // Suffix range: last N bytes
          start = Math.max(0, src.size - parseInt(m[2], 10))
        }
        end = Math.min(end, src.size - 1)
        if (start > end || start >= src.size) {
          return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${src.size}` } })
        }
        headers['Content-Range'] = `bytes ${start}-${end}/${src.size}`
        headers['Content-Length'] = String(end - start + 1)
        return new Response(Readable.toWeb(src.stream(start, end)) as ReadableStream, { status: 206, headers })
      }

      headers['Content-Length'] = String(src.size)
      return new Response(Readable.toWeb(src.stream(0)) as ReadableStream, { status: 200, headers })
    } catch (e) {
      return new Response((e as Error).message, { status: 500 })
    }
  })
}

/** Open a standalone dark video-player window pointing at a media URL. */
export function openMediaPlayer(title: string, mediaUrl: string, progressKey: string): void {
  const win = new BrowserWindow({
    width: 960,
    height: 600,
    minWidth: 480,
    minHeight: 320,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    title
  })
  const safeTitle = title.replace(/</g, '&lt;')
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${safeTitle}</title>
<style>html,body{margin:0;height:100%;background:#000}video{display:block;width:100%;height:100%;outline:none}</style>
</head><body><video src="${mediaUrl}" controls autoplay></video></body></html>`
  void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)

  // --- Playback progress memory (main-process JSON store; data: URL pages
  // have no reliable localStorage) ---
  const resumeAt = getProgress(progressKey)
  win.webContents.on('dom-ready', () => {
    if (resumeAt > 3 && !win.isDestroyed()) {
      void win.webContents.executeJavaScript(
        `(() => { const v = document.querySelector('video'); if (!v) return;` +
          `const t = ${JSON.stringify(resumeAt)};` +
          `if (v.readyState >= 1) { v.currentTime = t; }` +
          `else { v.addEventListener('loadedmetadata', () => { v.currentTime = t }, { once: true }); } })()`
      )
    }
  })
  const capture = async (): Promise<void> => {
    if (win.isDestroyed()) return
    try {
      const t = await win.webContents.executeJavaScript('document.querySelector("video")?.currentTime ?? 0')
      if (typeof t === 'number' && t > 0) saveProgress(progressKey, t)
    } catch {
      /* page gone */
    }
  }
  const timer = setInterval(() => void capture(), 5000)
  win.on('close', () => {
    clearInterval(timer)
    void capture()
  })
  win.on('closed', () => clearInterval(timer))
}

export function mediaUrl(serverId: string | undefined, filePath: string): string {
  const params = new URLSearchParams({ path: filePath })
  if (serverId) params.set('server', serverId)
  return `${MEDIA_SCHEME}://play?${params.toString()}`
}

/** Stable key for progress persistence: server-scoped for remote files. */
export function mediaProgressKey(serverId: string | undefined, filePath: string): string {
  return serverId ? `${serverId}:${filePath}` : filePath
}

// --- Progress store (userData/media-progress.json) ---

function progressFile(): string {
  return path.join(app.getPath('userData'), 'media-progress.json')
}

function readProgressMap(): Record<string, number> {
  try {
    return JSON.parse(readFileSync(progressFile(), 'utf8')) as Record<string, number>
  } catch {
    return {}
  }
}

function getProgress(key: string): number {
  const t = readProgressMap()[key]
  return typeof t === 'number' && Number.isFinite(t) ? t : 0
}

function saveProgress(key: string, seconds: number): void {
  try {
    const map = readProgressMap()
    map[key] = Math.round(seconds * 10) / 10
    writeFileSync(progressFile(), JSON.stringify(map))
  } catch {
    /* ignore quota/fs errors */
  }
}
