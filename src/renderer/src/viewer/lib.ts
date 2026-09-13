import { VIEWER_LIMITS } from '@shared/viewer'

export function mediaUrl(serverId: string | undefined, filePath: string): string {
  const params = new URLSearchParams({ path: filePath })
  if (serverId) params.set('server', serverId)
  return `janus-media://play?${params.toString()}`
}

export function fmtBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return '—'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KiB', 'MiB', 'GiB']
  let v = bytes
  let u = -1
  do {
    v /= 1024
    u += 1
  } while (v >= 1024 && u < units.length - 1)
  return `${v.toFixed(v >= 10 ? 1 : 2)} ${units[u]}`
}

export class ViewError extends Error {
  constructor(
    message: string,
    public code?: string
  ) {
    super(message)
    this.name = 'ViewError'
  }
}

export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_r, reject) => setTimeout(() => reject(new ViewError(`${what} timed out`, 'TIMEOUT')), ms))
  ])
}

function checkOk(res: Response): Response {
  if (!res.ok) throw new ViewError(`Read failed (HTTP ${res.status})`, 'IO')
  return res
}

/** Fetch the first n bytes (Range) for magic sniffing. */
export async function fetchHead(url: string, n = 16, signal?: AbortSignal): Promise<Uint8Array> {
  const res = checkOk(await fetch(url, { headers: { Range: `bytes=0-${n - 1}` }, signal }))
  return new Uint8Array(await res.arrayBuffer())
}

export interface FetchAllResult {
  bytes: Uint8Array
  totalSize: number
  truncated: boolean
}

/**
 * Fetch a whole file with a hard size cap. When the server reports a size
 * above maxBytes, only the first previewBytes are fetched (truncated=true).
 */
export async function fetchAll(
  url: string,
  maxBytes: number,
  previewBytes: number,
  signal?: AbortSignal
): Promise<FetchAllResult> {
  const head = await fetch(url, { headers: { Range: 'bytes=0-0' }, signal })
  await checkOk(head)
  const range = head.headers.get('content-range')
  let total = 0
  if (range) {
    const m = /\/(\d+)\s*$/.exec(range)
    if (m) total = parseInt(m[1], 10)
  }
  if (!total) {
    const len = head.headers.get('content-length')
    total = len ? parseInt(len, 10) : 0
  }
  if (total > maxBytes) {
    const res = checkOk(await fetch(url, { headers: { Range: `bytes=0-${previewBytes - 1}` }, signal }))
    return { bytes: new Uint8Array(await res.arrayBuffer()), totalSize: total, truncated: true }
  }
  const res = checkOk(await fetch(url, { signal }))
  const buf = new Uint8Array(await res.arrayBuffer())
  return { bytes: buf, totalSize: total || buf.length, truncated: false }
}

export { VIEWER_LIMITS }
