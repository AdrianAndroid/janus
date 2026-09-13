// Video player — shared contracts (playlist, progress, IPC payloads).

export const VIDEO_EXT = [
  '.mp4',
  '.m4v',
  '.webm',
  '.ogv',
  '.mov',
  '.mkv',
  '.avi',
  '.wmv',
  '.flv',
  '.ts',
  '.mpg',
  '.mpeg',
  '.3gp',
  '.rmvb'
] as const

export function isVideoFile(name: string): boolean {
  const i = name.lastIndexOf('.')
  return i > 0 && (VIDEO_EXT as readonly string[]).includes(name.slice(i).toLowerCase())
}

/** Natural episode ordering: E1 < E2 < E10, 第1集 < 第2集 < 第10集. */
export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}

export interface PlayerItem {
  name: string
  path: string
  /** Progress-store key (server-scoped for remote files). */
  key: string
}

export interface ProgressEntry {
  /** Resume position in seconds. */
  t: number
  /** Duration in seconds, when known. */
  d?: number
  /** Watched to the end (or >=95%). */
  done?: boolean
  /** Last update, epoch ms. */
  at: number
}

export interface PlayerContext {
  /** Window title base (clicked file's directory or server name). */
  title: string
  serverId?: string
  items: PlayerItem[]
  /** Index of the clicked file inside items. */
  index: number
  progress: Record<string, ProgressEntry>
  /** mediaProgressKey-format keys of favorited videos (marks playlist rows). */
  favoriteKeys?: string[]
}

/** Stable key for progress/favorite identity: server-scoped for remote files. */
export function mediaProgressKey(serverId: string | undefined, filePath: string): string {
  return serverId ? `${serverId}:${filePath}` : filePath
}

export interface SaveProgressReq {
  key: string
  t: number
  d?: number
  done?: boolean
}
