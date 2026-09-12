import { useEffect, useState, useCallback } from 'react'
import {
  Folder,
  File,
  ArrowUp,
  RefreshCw,
  Download,
  Upload,
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
  Save
} from 'lucide-react'
import { useStore } from '../store'
import Modal from './Modal'
import type { Tab } from '../store'
import type { SftpEntry } from '@shared/types'

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

export default function SftpPanel({ tab }: { tab: Tab }): JSX.Element {
  const { setTabStatus } = useStore()
  const serverId = tab.serverId
  const [path, setPath] = useState('.')
  const [entries, setEntries] = useState<SftpEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [editing, setEditing] = useState<SftpEntry | null>(null)

  function copyPath(p: string): void {
    navigator.clipboard.writeText(p)
    setCopied(p)
    setTimeout(() => setCopied((c) => (c === p ? null : c)), 1200)
  }

  const load = useCallback(
    async (target: string) => {
      setLoading(true)
      setError(null)
      try {
        const { cwd, entries: list } = await window.janus.sftp.list(serverId, target)
        setEntries(list)
        setPath(cwd) // always the resolved absolute path
        setTabStatus(tab.id, 'connected')
      } catch (e) {
        setError((e as Error).message)
        setTabStatus(tab.id, 'error')
      } finally {
        setLoading(false)
      }
    },
    [serverId, tab.id, setTabStatus]
  )

  useEffect(() => {
    load('.')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function up(): void {
    if (path === '/') return
    const parent = path.replace(/\/+$/, '').split('/').slice(0, -1).join('/') || '/'
    load(parent)
  }

  async function action<T>(key: string, fn: () => Promise<T>): Promise<void> {
    setBusy(key)
    setError(null)
    try {
      await fn()
      await load(path)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const displayPath = path || '/'

  return (
    <div className="flex h-full flex-col bg-ink-900">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-1 border-b border-ink-600 bg-ink-800 px-3 py-2">
        <button onClick={() => load('.')} className="btn-ghost px-2 py-1.5" title="Home directory">
          <Home size={15} />
        </button>
        <button onClick={up} className="btn-ghost px-2 py-1.5" title="Parent directory">
          <ArrowUp size={15} />
        </button>
        <button onClick={() => load(path)} className="btn-ghost px-2 py-1.5" title="Refresh">
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
        </button>
        <button
          onClick={() => copyPath(path)}
          title="Copy current path"
          className="mx-2 flex flex-1 items-center gap-2 truncate rounded-md border border-ink-500 bg-ink-900 px-3 py-1.5 text-xs text-slate-300 hover:border-accent/60"
        >
          <Link2 size={13} className="shrink-0 text-slate-500" />
          <span className="flex-1 truncate text-left font-mono">{displayPath}</span>
          {copied === path ? <Check size={13} className="shrink-0 text-good" /> : <Copy size={13} className="shrink-0 text-slate-500" />}
        </button>
        <button
          onClick={() => action('upload', async () => { await window.janus.sftp.upload(serverId, path === '.' ? '.' : path) })}
          className="btn-ghost border border-ink-500"
          title="Upload file"
        >
          {busy === 'upload' ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />} Upload
        </button>
        <button
          onClick={() =>
            action('mkdir', async () => {
              const name = prompt('New folder name:')
              if (name) await window.janus.sftp.mkdir(serverId, `${path.replace(/\/$/, '')}/${name}`)
            })
          }
          className="btn-ghost border border-ink-500"
          title="New folder"
        >
          <FolderPlus size={15} />
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-bad/10 px-4 py-2 text-xs text-bad">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {/* File table */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-ink-800 text-[11px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Name</th>
              <th className="w-24 px-4 py-2 text-right font-medium">Size</th>
              <th className="w-44 px-4 py-2 text-left font-medium">Modified</th>
              <th className="w-28 px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.path} className="group border-b border-ink-700/50 hover:bg-ink-800">
                <td
                  className="cursor-pointer px-4 py-1.5"
                  onClick={() => e.type === 'directory' && load(e.path)}
                  onDoubleClick={() => (e.type === 'directory' ? load(e.path) : setEditing(e))}
                >
                  <div className="flex items-center gap-2">
                    {e.type === 'directory' ? (
                      <Folder size={15} className="shrink-0 text-accent" />
                    ) : (
                      <File size={15} className="shrink-0 text-slate-400" />
                    )}
                    <span className={e.type === 'directory' ? 'text-slate-100' : 'text-slate-300'}>{e.name}</span>
                  </div>
                </td>
                <td className="px-4 py-1.5 text-right font-mono text-xs text-slate-500">
                  {e.type === 'file' ? fmtSize(e.size) : '—'}
                </td>
                <td className="px-4 py-1.5 text-xs text-slate-500">{new Date(e.mtime).toLocaleString('en-US')}</td>
                <td className="px-4 py-1.5">
                  <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100">
                    <button
                      onClick={() => copyPath(e.path)}
                      className="rounded p-1 text-slate-400 hover:bg-ink-500 hover:text-white"
                      title="Copy path"
                    >
                      {copied === e.path ? <Check size={13} className="text-good" /> : <Copy size={13} />}
                    </button>
                    {e.type === 'file' && (
                      <>
                        <button
                          onClick={() => setEditing(e)}
                          className="rounded p-1 text-slate-400 hover:bg-ink-500 hover:text-white"
                          title="Edit"
                        >
                          <FileEdit size={13} />
                        </button>
                        <button
                          onClick={() => action(`dl-${e.path}`, async () => { await window.janus.sftp.download(serverId, e.path) })}
                          className="rounded p-1 text-slate-400 hover:bg-ink-500 hover:text-white"
                          title="Download"
                        >
                          <Download size={13} />
                        </button>
                      </>
                    )}
                    <button
                      onClick={() =>
                        action(`rn-${e.path}`, async () => {
                          const name = prompt('New name:', e.name)
                          if (name && name !== e.name) {
                            const dir = e.path.split('/').slice(0, -1).join('/')
                            await window.janus.sftp.rename(serverId, e.path, `${dir}/${name}`)
                          }
                        })
                      }
                      className="rounded p-1 text-slate-400 hover:bg-ink-500 hover:text-white"
                      title="Rename"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      onClick={() =>
                        confirm(`Delete "${e.name}"?`) &&
                        action(`rm-${e.path}`, async () => {
                          await window.janus.sftp.remove(serverId, e.path, e.type === 'directory')
                        })
                      }
                      className="rounded p-1 text-slate-400 hover:bg-bad hover:text-white"
                      title="Delete"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && entries.length === 0 && !error && (
          <div className="py-12 text-center text-sm text-slate-500">This folder is empty.</div>
        )}
        {loading && (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500">
            <Loader2 size={16} className="animate-spin" /> Loading…
          </div>
        )}
      </div>

      {editing && <FileEditor serverId={serverId} entry={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function FileEditor({ serverId, entry, onClose }: { serverId: string; entry: SftpEntry; onClose: () => void }): JSX.Element {
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const tooBig = entry.size > 2 * 1024 * 1024

  useEffect(() => {
    if (tooBig) {
      setErr('File is larger than 2MB — not supported by the editor. Use download instead.')
      setLoading(false)
      return
    }
    window.janus.sftp
      .readFile(serverId, entry.path)
      .then((c) => setContent(c))
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function save(): Promise<void> {
    setSaving(true)
    setErr(null)
    try {
      await window.janus.sftp.writeFile(serverId, entry.path, content)
      onClose()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={`Edit · ${entry.name}`}
      onClose={onClose}
      width={720}
      footer={
        <>
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={save} disabled={saving || loading || tooBig} className="btn-primary">
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Save
          </button>
        </>
      }
    >
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
          <Loader2 size={16} className="animate-spin" /> Loading file…
        </div>
      ) : (
        <>
          {err && <div className="mb-2 rounded-md bg-bad/10 px-3 py-2 text-xs text-bad">{err}</div>}
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            spellCheck={false}
            className="field h-[52vh] resize-none font-mono text-xs leading-relaxed"
            placeholder="(empty)"
          />
          <p className="mt-1.5 font-mono text-[10px] text-slate-600">{entry.path}</p>
        </>
      )}
    </Modal>
  )
}
