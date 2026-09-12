import { useState } from 'react'
import { v4 as uuid } from 'uuid'
import { Code2, Plus, Pencil, Trash2, Play, Copy, Check, Terminal, Loader2, X } from 'lucide-react'
import { useStore } from '../store'
import Modal from './Modal'
import type { Snippet } from '@shared/types'

export default function SnippetsPanel(): JSX.Element {
  const { vault, deleteSnippet } = useStore()
  const snippets = vault?.snippets ?? []
  const [editing, setEditing] = useState<Snippet | null>(null)
  const [creating, setCreating] = useState(false)
  const [runOn, setRunOn] = useState<Snippet | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  function copy(s: Snippet): void {
    navigator.clipboard.writeText(s.command)
    setCopied(s.id)
    setTimeout(() => setCopied(null), 1200)
  }

  return (
    <div className="flex h-full flex-col bg-ink-900">
      <div className="flex items-center justify-between border-b border-ink-600 px-6 py-4">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-bold text-white">
            <Code2 size={20} className="text-accent" /> Snippet Library
          </h1>
          <p className="text-sm text-slate-500">Save frequently used commands and run them on a server with one click.</p>
        </div>
        <button onClick={() => setCreating(true)} className="btn-primary">
          <Plus size={16} /> New Snippet
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {snippets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center text-slate-500">
            <Code2 size={48} className="mb-3 opacity-40" />
            <p>No snippets yet.</p>
            <button onClick={() => setCreating(true)} className="mt-2 text-accent hover:underline">
              Create your first snippet →
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {snippets.map((s) => (
              <div key={s.id} className="group rounded-xl border border-ink-600 bg-ink-800 p-4 transition-colors hover:border-ink-500">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate font-semibold text-slate-100">{s.name}</h3>
                    {s.description && <p className="truncate text-xs text-slate-500">{s.description}</p>}
                  </div>
                  <div className="flex shrink-0 gap-1 opacity-0 group-hover:opacity-100">
                    <button onClick={() => setRunOn(s)} className="rounded p-1.5 text-good hover:bg-ink-600" title="Run">
                      <Play size={14} />
                    </button>
                    <button onClick={() => copy(s)} className="rounded p-1.5 text-slate-400 hover:bg-ink-600" title="Copy">
                      {copied === s.id ? <Check size={14} className="text-good" /> : <Copy size={14} />}
                    </button>
                    <button onClick={() => setEditing(s)} className="rounded p-1.5 text-slate-400 hover:bg-ink-600" title="Edit">
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => confirm(`Delete "${s.name}"?`) && deleteSnippet(s.id)}
                      className="rounded p-1.5 text-slate-400 hover:bg-bad hover:text-white"
                      title="Delete"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                <pre className="overflow-x-auto rounded-lg bg-ink-900 p-3 font-mono text-xs text-good">{s.command}</pre>
                {s.tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {s.tags.map((t) => (
                      <span key={t} className="chip">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {(creating || editing) && (
        <SnippetForm snippet={editing} onClose={() => { setCreating(false); setEditing(null) }} />
      )}
      {runOn && <RunModal snippet={runOn} onClose={() => setRunOn(null)} />}
    </div>
  )
}

function SnippetForm({ snippet, onClose }: { snippet: Snippet | null; onClose: () => void }): JSX.Element {
  const { upsertSnippet } = useStore()
  const [form, setForm] = useState<Snippet>(
    () =>
      snippet ?? {
        id: uuid(),
        name: '',
        command: '',
        description: '',
        tags: [],
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
  )
  const [tagInput, setTagInput] = useState('')

  async function save(): Promise<void> {
    if (!form.name.trim() || !form.command.trim()) return
    await upsertSnippet({ ...form, updatedAt: Date.now() })
    onClose()
  }

  return (
    <Modal
      title={snippet ? 'Edit Snippet' : 'New Snippet'}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={save} disabled={!form.name.trim() || !form.command.trim()} className="btn-primary">Save</button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="label">Name *</label>
          <input autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="field" placeholder="Disk usage" />
        </div>
        <div>
          <label className="label">Description</label>
          <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="field" placeholder="Optional description" />
        </div>
        <div>
          <label className="label">Command *</label>
          <textarea value={form.command} onChange={(e) => setForm({ ...form, command: e.target.value })} className="field h-28 font-mono text-xs" placeholder="df -h" />
        </div>
        <div>
          <label className="label">Tags</label>
          <div className="mb-2 flex flex-wrap gap-1">
            {form.tags.map((t) => (
              <span key={t} className="chip">
                {t}
                <button onClick={() => setForm({ ...form, tags: form.tags.filter((x) => x !== t) })} className="hover:text-bad"><X size={11} /></button>
              </span>
            ))}
          </div>
          <input
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                const t = tagInput.trim()
                if (t && !form.tags.includes(t)) setForm({ ...form, tags: [...form.tags, t] })
                setTagInput('')
              }
            }}
            className="field"
            placeholder="Add a tag and press Enter"
          />
        </div>
      </div>
    </Modal>
  )
}

function RunModal({ snippet, onClose }: { snippet: Snippet; onClose: () => void }): JSX.Element {
  const { vault } = useStore()
  const servers = vault?.servers ?? []
  const [serverId, setServerId] = useState(servers[0]?.id ?? '')
  const [output, setOutput] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(): Promise<void> {
    if (!serverId) return
    setRunning(true)
    setError(null)
    setOutput(null)
    try {
      const res = await window.janus.ssh.exec(serverId, snippet.command)
      setOutput((res.stdout || '') + (res.stderr ? `\n[stderr]\n${res.stderr}` : ''))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setRunning(false)
    }
  }

  return (
    <Modal
      title={`Run: ${snippet.name}`}
      onClose={onClose}
      width={620}
      footer={
        <>
          <button onClick={onClose} className="btn-ghost">Close</button>
          <button onClick={run} disabled={!serverId || running} className="btn-primary">
            {running ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />} Run
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="label">Run on which server?</label>
          <select value={serverId} onChange={(e) => setServerId(e.target.value)} className="field">
            {servers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.host})
              </option>
            ))}
          </select>
        </div>
        <pre className="overflow-x-auto rounded-lg bg-ink-900 p-3 font-mono text-xs text-good">{snippet.command}</pre>
        {error && <div className="rounded-md bg-bad/10 px-3 py-2 text-xs text-bad">{error}</div>}
        {output !== null && (
          <div>
            <label className="label flex items-center gap-1"><Terminal size={12} /> Output</label>
            <pre className="max-h-72 overflow-auto rounded-lg border border-ink-600 bg-black p-3 font-mono text-xs text-slate-200">
              {output || '(no output)'}
            </pre>
          </div>
        )}
      </div>
    </Modal>
  )
}
