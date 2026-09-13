import { app, BrowserWindow, protocol } from 'electron'
import { createReadStream, promises as fs, readFileSync, writeFileSync } from 'fs'
import { Readable } from 'stream'
import path from 'path'
import type { ServerProfile } from '@shared/types'
import type { PlayerContext, PlayerItem, ProgressEntry, SaveProgressReq } from '@shared/media'
import { isVideoFile, naturalCompare } from '@shared/media'
import type { SSHManager } from './ssh-manager'
import { localList } from './local-fs'

// Video player: streams local or remote (SFTP) media through the custom
// `janus-media://` protocol with HTTP Range support, and plays it in a
// standalone bundled player window with a same-directory playlist, autoplay
// and per-episode progress memory.
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

/** Wrap a node stream as a web stream that is destroyed on client abort. */
function webStream(node: Readable): ReadableStream {
  const web = Readable.toWeb(node) as ReadableStream
  // When the browser cancels (seek, episode switch, closed window), kill the
  // underlying fs/sftp stream instead of leaking it.
  const origCancel = web.cancel.bind(web)
  web.cancel = (reason?: unknown): Promise<void> => {
    node.destroy()
    return origCancel(reason)
  }
  return web
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
        return new Response(webStream(src.stream(start, end)), { status: 206, headers })
      }

      headers['Content-Length'] = String(src.size)
      return new Response(webStream(src.stream(0)), { status: 200, headers })
    } catch (e) {
      return new Response((e as Error).message, { status: 500 })
    }
  })
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

// --- Progress store v2 (userData/media-progress.json) ---
// Format: { key: {t, d?, done?, at} }. Legacy v1 ({key: seconds}) migrates on read.

function progressFile(): string {
  return path.join(app.getPath('userData'), 'media-progress.json')
}

function readProgressMap(): Record<string, ProgressEntry> {
  try {
    const raw = JSON.parse(readFileSync(progressFile(), 'utf8')) as Record<string, unknown>
    const out: Record<string, ProgressEntry> = {}
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === 'number' && Number.isFinite(v)) {
        out[k] = { t: v, at: 0 }
      } else if (v && typeof v === 'object' && typeof (v as ProgressEntry).t === 'number') {
        out[k] = v as ProgressEntry
      }
    }
    return out
  } catch {
    return {}
  }
}

export function saveProgressEntry(req: SaveProgressReq): void {
  try {
    const map = readProgressMap()
    const prev = map[req.key]
    map[req.key] = {
      t: Math.round(req.t * 10) / 10,
      d: req.d ?? prev?.d,
      done: req.done ?? prev?.done,
      at: Date.now()
    }
    writeFileSync(progressFile(), JSON.stringify(map))
  } catch {
    /* ignore quota/fs errors */
  }
}

// --- Playlist ---

function parentDirOf(p: string): string {
  const trimmed = p.replace(/[\\/]+$/, '')
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return idx > 0 ? trimmed.slice(0, idx) : trimmed.startsWith('/') ? '/' : '.'
}

/** List video files in the clicked file's directory, natural-sorted. Falls back to the single file. */
export async function buildPlaylist(
  ssh: SSHManager,
  serverId: string | undefined,
  filePath: string,
  find: FindFn
): Promise<PlayerItem[]> {
  const dir = parentDirOf(filePath)
  try {
    const entries = serverId
      ? (await ssh.sftpList(find(serverId).profile, dir, find(serverId).jump)).entries
      : (await localList(dir)).entries
    const videos = entries
      .filter((e) => e.type === 'file' && isVideoFile(e.name))
      .map((e) => ({ name: e.name, path: e.path, key: mediaProgressKey(serverId, e.path) }))
    videos.sort((a, b) => naturalCompare(a.name, b.name))
    if (videos.length > 0) return videos
  } catch {
    /* listing failed (permissions etc.) — fall back to single item */
  }
  const name = filePath.split(/[\\/]/).pop() || filePath
  return [{ name, path: filePath, key: mediaProgressKey(serverId, filePath) }]
}

// --- Player windows ---

interface PlayerRecord {
  win: BrowserWindow
  context: PlayerContext
}

export class PlayerWindowManager {
  private wins = new Map<number, PlayerRecord>()

  constructor(
    private ssh: SSHManager,
    private find: FindFn
  ) {}

  async openPlayer(serverId: string | undefined, filePath: string, title?: string): Promise<void> {
    const items = await buildPlaylist(this.ssh, serverId, filePath, this.find)
    const key = mediaProgressKey(serverId, filePath)
    let index = items.findIndex((it) => it.key === key)
    if (index < 0) index = 0
    const context: PlayerContext = {
      title: title || items[index].name,
      serverId,
      items,
      index,
      progress: readProgressMap()
    }

    const win = new BrowserWindow({
      width: 1280,
      height: 800,
      minWidth: 720,
      minHeight: 480,
      backgroundColor: '#000000',
      autoHideMenuBar: true,
      title: context.title,
      webPreferences: {
        preload: path.join(__dirname, '../preload/player.js'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false
      }
    })
    this.wins.set(win.webContents.id, { win, context })
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (e) => e.preventDefault())
    win.on('closed', () => this.wins.delete(win.webContents.id))
    win.once('ready-to-show', () => {
      win.show()
      win.focus()
    })
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl) {
      void win.loadURL(`${devUrl}/player.html`)
    } else {
      void win.loadFile(path.join(__dirname, '../renderer/player.html'))
    }
  }

  contextFor(senderId: number): PlayerContext | null {
    return this.wins.get(senderId)?.context ?? null
  }

  saveProgress(senderId: number, req: SaveProgressReq): void {
    if (!this.wins.has(senderId)) return
    saveProgressEntry(req)
    const rec = this.wins.get(senderId)!
    const prev = rec.context.progress[req.key]
    rec.context.progress[req.key] = {
      t: Math.round(req.t * 10) / 10,
      d: req.d ?? prev?.d,
      done: req.done ?? prev?.done,
      at: Date.now()
    }
  }

  closeAll(): void {
    for (const rec of this.wins.values()) {
      if (!rec.win.isDestroyed()) rec.win.destroy()
    }
    this.wins.clear()
  }
}
