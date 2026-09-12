import { useEffect, useState, useCallback, useRef } from 'react'
import {
  Folder,
  File,
  ArrowUp,
  RefreshCw,
  FolderPlus,
  Trash2,
  Pencil,
  Home,
  Link2,
  AlertCircle,
  Loader2,
  Copy,
  Check,
  FileEdit,
  Upload,
  Download,
  Play,
  PieChart
} from 'lucide-react'
import type { SftpEntry } from '@shared/types'

export function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

export function joinPath(dir: string, name: string): string {
  return `${dir.replace(/[\\/]+$/, '')}/${name}`
}

function parentPath(p: string): string {
  const trimmed = p.replace(/[\\/]+$/, '')
  const idx = trimmed.lastIndexOf('/')
  if (idx <= 0) return p.startsWith('/') ? '/' : trimmed
  return trimmed.slice(0, idx)
}

const VIDEO_EXT = ['.mp4', '.m4v', '.webm', '.ogv', '.mov', '.mkv', '.avi', '.wmv', '.flv', '.ts', '.mpg', '.mpeg', '.3gp', '.rmvb']

function isVideo(name: string): boolean {
  const i = name.lastIndexOf('.')
  return i > 0 && VIDEO_EXT.includes(name.slice(i).toLowerCase())
}

interface Props {
  kind: 'local' | 'remote'
  serverId: string
  selected: SftpEntry | null
  onSelect: (e: SftpEntry | null) => void
  onPathChange: (p: string) => void
  onTransferEntry: (e: SftpEntry) => void
  onEditFile?: (e: SftpEntry) => void
  refreshToken: number
  onStatus?: (ok: boolean) => void
  /** Show the Size column (and measure folder sizes) — vertical layout only. */
  showSizes: boolean
  /** One-shot navigation request to a directory (optionally selecting an entry). */
  nav?: { path: string; selectName?: string; token: number } | null
}

/** One side of the dual-pane file manager (local disk or remote SFTP). */
export default function FilePane({
  kind,
  serverId,
  selected,
  onSelect,
  onPathChange,
  onTransferEntry,
  onEditFile,
  refreshToken,
  onStatus,
  showSizes,
  nav
}: Props): JSX.Element {
  const isLocal = kind === 'local'
  const [path, setPath] = useState('')
  const [entries, setEntries] = useState<SftpEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [dirSizes, setDirSizes] = useState<Map<string, number | null>>(new Map())
  const sizeGen = useRef(0)

  function copyPath(p: string): void {
    navigator.clipboard.writeText(p)
    setCopied(p)
    setTimeout(() => setCopied((c) => (c === p ? null : c)), 1200)
  }

  const load = useCallback(
    async (target?: string): Promise<SftpEntry[] | null> => {
      setLoading(true)
      setError(null)
      try {
        let dir = target ?? path
        if (!dir) dir = isLocal ? await window.janus.localFs.home() : '.'
        const { cwd, entries: list } = isLocal
          ? await window.janus.localFs.list(dir)
          : await window.janus.sftp.list(serverId, dir)
        setEntries(list)
        setPath(cwd)
        onPathChange(cwd)
        onStatus?.(true)
        return list
      } catch (e) {
        setError((e as Error).message)
        onStatus?.(false)
        return null
      } finally {
        setLoading(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isLocal, serverId, path, onPathChange, onStatus]
  )

  // One-shot navigation request (e.g. "Open in Files" from Disk Usage).
  const navToken = nav?.token
  useEffect(() => {
    if (!nav || navToken === undefined) return
    void (async () => {
      const list = await load(nav.path)
      if (nav.selectName && list) {
        const found = list.find((e) => e.name === nav.selectName)
        if (found) onSelect(found)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navToken])

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken])

  // Measure folder disk usage asynchronously (never blocks the listing).
  const dirsKey = entries
    .filter((e) => e.type === 'directory')
    .map((e) => e.path)
    .join('')
  useEffect(() => {
    const gen = ++sizeGen.current
    setDirSizes(new Map())
    if (!showSizes) return
    const dirs = entries.filter((e) => e.type === 'directory')
    if (dirs.length === 0) return
    let cancelled = false
    const worker = async (queue: SftpEntry[]): Promise<void> => {
      for (;;) {
        const d = queue.shift()
        if (!d || cancelled) return
        let size: number | null = null
        try {
          size = isLocal ? await window.janus.localFs.dirSize(d.path) : await window.janus.sftp.dirSize(serverId, d.path)
        } catch {
          size = null
        }
        if (cancelled || sizeGen.current !== gen) return
        setDirSizes((m) => new Map(m).set(d.path, size))
      }
    }
    const queue = [...dirs]
    void Promise.all(Array.from({ length: Math.min(3, dirs.length) }, () => worker(queue)))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirsKey, isLocal, serverId, showSizes])

  async function action<T>(key: string, fn: () => Promise<T>, reload = true): Promise<void> {
    setBusy(key)
    setError(null)
    try {
      await fn()
      if (reload) await load(path)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function goHome(): Promise<void> {
    if (isLocal) await load(await window.janus.localFs.home())
    else await load('.')
  }

  async function mkdir(): Promise<void> {
    const name = prompt('New folder name:')
    if (!name) return
    await action('mkdir', async () => {
      if (isLocal) await window.janus.localFs.mkdir(joinPath(path, name))
      else await window.janus.sftp.mkdir(serverId, joinPath(path, name))
    })
  }

  async function rename(e: SftpEntry): Promise<void> {
    const name = prompt('New name:', e.name)
    if (!name || name === e.name) return
    await action(`rn-${e.path}`, async () => {
      const to = joinPath(parentPath(e.path), name)
      if (isLocal) await window.janus.localFs.rename(e.path, to)
      else await window.janus.sftp.rename(serverId, e.path, to)
      if (selected?.path === e.path) onSelect(null)
    })
  }

  async function remove(e: SftpEntry): Promise<void> {
    const isDir = e.type === 'directory'
    const msg = isDir ? `Delete folder "${e.name}" and ALL its contents?` : `Delete "${e.name}"?`
    if (!confirm(msg)) return
    await action(`rm-${e.path}`, async () => {
      if (isLocal) await window.janus.localFs.remove(e.path)
      else if (isDir) await window.janus.sftp.removeRecursive(serverId, e.path)
      else await window.janus.sftp.remove(serverId, e.path, false)
      if (selected?.path === e.path) onSelect(null)
    })
  }

  function open(e: SftpEntry): void {
    if (e.type === 'directory') {
      onSelect(null)
      void load(e.path)
    } else if (e.type === 'file' && !isLocal) {
      onEditFile?.(e)
    }
  }

  function play(e: SftpEntry): void {
    void window.janus.media
      .open({ title: e.name, path: e.path, serverId: isLocal ? undefined : serverId })
      .catch((err) => setError((err as Error).message))
  }

  function analyze(e: SftpEntry): void {
    void window.janus.diskUsage
      .openWindow({
        target: isLocal ? { kind: 'local' } : { kind: 'ssh', serverId },
        initialPath: e.path
      })
      .catch((err) => setError((err as Error).message))
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-1 border-b border-ink-600 bg-ink-800 px-2 py-2">
        <span className="mr-1 shrink-0 rounded bg-ink-600 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
          {isLocal ? 'Local' : 'Remote'}
        </span>
        <button onClick={goHome} className="btn-ghost px-1.5 py-1.5" title="Home directory">
          <Home size={14} />
        </button>
        <button onClick={() => load(parentPath(path || '/'))} className="btn-ghost px-1.5 py-1.5" title="Parent directory">
          <ArrowUp size={14} />
        </button>
        <button onClick={() => load(path)} className="btn-ghost px-1.5 py-1.5" title="Refresh">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
        <button
          onClick={() => copyPath(path)}
          title="Copy current path"
          className="mx-1 flex min-w-0 flex-1 items-center gap-1.5 truncate rounded-md border border-ink-500 bg-ink-900 px-2 py-1 text-[11px] text-slate-300 hover:border-accent/60"
        >
          <Link2 size={12} className="shrink-0 text-slate-500" />
          <span className="flex-1 truncate text-left font-mono">{path || '…'}</span>
          {copied === path ? (
            <Check size={12} className="shrink-0 text-good" />
          ) : (
            <Copy size={12} className="shrink-0 text-slate-500" />
          )}
        </button>
        <button onClick={mkdir} className="btn-ghost border border-ink-500 px-2 py-1" title="New folder">
          {busy === 'mkdir' ? <Loader2 size={14} className="animate-spin" /> : <FolderPlus size={14} />}
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-bad/10 px-3 py-1.5 text-xs text-bad">
          <AlertCircle size={13} /> <span className="truncate">{error}</span>
        </div>
      )}

      {/* File table */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-ink-800 text-[10px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-1.5 text-left font-medium">Name</th>
              {showSizes && <th className="w-20 px-2 py-1.5 text-right font-medium">Size</th>}
              <th className="w-28 px-2 py-1.5"></th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => {
              const isSel = selected?.path === e.path
              return (
                <tr
                  key={e.path}
                  onClick={() => onSelect(isSel ? null : e)}
                  onDoubleClick={() => open(e)}
                  className={`group cursor-pointer border-b border-ink-700/50 ${
                    isSel ? 'bg-accent/15' : 'hover:bg-ink-800'
                  }`}
                >
                  <td className="px-3 py-1.5">
                    <div className="flex items-center gap-2">
                      {e.type === 'directory' ? (
                        <Folder size={14} className="shrink-0 text-accent" />
                      ) : (
                        <File size={14} className="shrink-0 text-slate-400" />
                      )}
                      <span className={`truncate ${e.type === 'directory' ? 'text-slate-100' : 'text-slate-300'}`}>
                        {e.name}
                      </span>
                    </div>
                  </td>
                  {showSizes && (
                    <td className="px-2 py-1.5 text-right font-mono text-[11px] text-slate-500">
                      {e.type === 'file' ? (
                        fmtSize(e.size)
                      ) : e.type === 'directory' ? (
                        dirSizes.has(e.path) ? (
                          dirSizes.get(e.path) === null ? (
                            '—'
                          ) : (
                            fmtSize(dirSizes.get(e.path)!)
                          )
                        ) : (
                          <Loader2 size={11} className="ml-auto animate-spin text-slate-600" />
                        )
                      ) : (
                        '—'
                      )}
                    </td>
                  )}
                  <td className="px-2 py-1.5">
                    <div className="flex justify-end gap-0.5 opacity-0 group-hover:opacity-100">
                      {e.type === 'file' && isVideo(e.name) && (
                        <button
                          onClick={(ev) => {
                            ev.stopPropagation()
                            play(e)
                          }}
                          className="rounded p-1 text-slate-400 hover:bg-ink-500 hover:text-white"
                          title="Play video"
                        >
                          <Play size={12} />
                        </button>
                      )}
                      <button
                        onClick={(ev) => {
                          ev.stopPropagation()
                          onTransferEntry(e)
                        }}
                        className="rounded p-1 text-slate-400 hover:bg-ink-500 hover:text-white"
                        title={isLocal ? 'Upload to remote' : 'Download to local'}
                      >
                        {isLocal ? <Upload size={12} /> : <Download size={12} />}
                      </button>
                      <button
                        onClick={(ev) => {
                          ev.stopPropagation()
                          copyPath(e.path)
                        }}
                        className="rounded p-1 text-slate-400 hover:bg-ink-500 hover:text-white"
                        title="Copy path"
                      >
                        {copied === e.path ? <Check size={12} className="text-good" /> : <Copy size={12} />}
                      </button>
                      {!isLocal && e.type === 'file' && onEditFile && (
                        <button
                          onClick={(ev) => {
                            ev.stopPropagation()
                            onEditFile(e)
                          }}
                          className="rounded p-1 text-slate-400 hover:bg-ink-500 hover:text-white"
                          title="Edit"
                        >
                          <FileEdit size={12} />
                        </button>
                      )}
                      {e.type === 'directory' && (
                        <button
                          onClick={(ev) => {
                            ev.stopPropagation()
                            analyze(e)
                          }}
                          className="rounded p-1 text-slate-400 hover:bg-ink-500 hover:text-white"
                          title="Analyze Disk Usage"
                        >
                          <PieChart size={12} />
                        </button>
                      )}
                      <button
                        onClick={(ev) => {
                          ev.stopPropagation()
                          void rename(e)
                        }}
                        className="rounded p-1 text-slate-400 hover:bg-ink-500 hover:text-white"
                        title="Rename"
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        onClick={(ev) => {
                          ev.stopPropagation()
                          void remove(e)
                        }}
                        className="rounded p-1 text-slate-400 hover:bg-bad hover:text-white"
                        title="Delete"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {!loading && entries.length === 0 && !error && (
          <div className="py-10 text-center text-xs text-slate-500">This folder is empty.</div>
        )}
        {loading && (
          <div className="flex items-center justify-center gap-2 py-10 text-xs text-slate-500">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </div>
        )}
      </div>
    </div>
  )
}
