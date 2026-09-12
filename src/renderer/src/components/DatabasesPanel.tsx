import { useState } from 'react'
import { v4 as uuid } from 'uuid'
import { Database, Plus, Play, Zap, Pencil, Trash2, Loader2, Check, AlertCircle } from 'lucide-react'
import { useStore } from '../store'
import Modal from './Modal'
import type { DbConnection, DbType } from '@shared/types'

const TYPE_META: Record<DbType, { label: string; port: number; color: string }> = {
  postgres: { label: 'PostgreSQL', port: 5432, color: '#38bdf8' },
  mysql: { label: 'MySQL', port: 3306, color: '#f59e0b' },
  redis: { label: 'Redis', port: 6379, color: '#ef4444' }
}

export default function DatabasesPanel(): JSX.Element {
  const { vault, deleteDatabase, openDb } = useStore()
  const dbs = vault?.databases ?? []
  const [editing, setEditing] = useState<DbConnection | null>(null)
  const [creating, setCreating] = useState(false)
  const [testing, setTesting] = useState<string | null>(null)
  const [testMsg, setTestMsg] = useState<{ id: string; ok: boolean; text: string } | null>(null)

  async function test(d: DbConnection): Promise<void> {
    setTesting(d.id)
    setTestMsg(null)
    try {
      await window.janus.db.test(d)
      setTestMsg({ id: d.id, ok: true, text: 'Connection successful' })
    } catch (e) {
      setTestMsg({ id: d.id, ok: false, text: (e as Error).message })
    } finally {
      setTesting(null)
    }
  }

  return (
    <div className="flex h-full flex-col bg-ink-900">
      <div className="flex items-center justify-between border-b border-ink-600 px-6 py-4">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-bold text-white">
            <Database size={20} className="text-accent" /> Databases
          </h1>
          <p className="text-sm text-slate-500">Postgres, MySQL, Redis — connect securely over an SSH tunnel.</p>
        </div>
        <button onClick={() => setCreating(true)} className="btn-primary">
          <Plus size={16} /> New Connection
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {dbs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center text-slate-500">
            <Database size={48} className="mb-3 opacity-40" />
            <p>No database connections yet.</p>
            <button onClick={() => setCreating(true)} className="mt-2 text-accent hover:underline">
              Add your first connection →
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {dbs.map((d) => {
              const meta = TYPE_META[d.type]
              return (
                <div key={d.id} className="group rounded-xl border border-ink-600 bg-ink-800 p-4">
                  <div className="mb-3 flex items-start gap-3">
                    <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: meta.color }} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold text-slate-100">{d.name}</div>
                      <div className="truncate text-xs text-slate-500">
                        {meta.label} · {d.host}:{d.port}
                        {d.database ? ` / ${d.database}` : ''}
                        {d.sshServerId ? ' · 🔒 tunnel' : ''}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-1 opacity-0 group-hover:opacity-100">
                      <button onClick={() => test(d)} className="rounded p-1.5 text-slate-400 hover:bg-ink-600" title="Test">
                        {testing === d.id ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
                      </button>
                      <button onClick={() => setEditing(d)} className="rounded p-1.5 text-slate-400 hover:bg-ink-600" title="Edit">
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => confirm(`Delete "${d.name}"?`) && deleteDatabase(d.id)}
                        className="rounded p-1.5 text-slate-400 hover:bg-bad hover:text-white"
                        title="Delete"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                  <button onClick={() => openDb(d.id)} className="btn-ghost w-full border border-ink-500 text-sm">
                    <Play size={14} /> Connect & run queries
                  </button>
                  {testMsg?.id === d.id && (
                    <div className={`mt-2 flex items-center gap-1.5 text-xs ${testMsg.ok ? 'text-good' : 'text-bad'}`}>
                      {testMsg.ok ? <Check size={13} /> : <AlertCircle size={13} />} {testMsg.text}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {(creating || editing) && <DbForm conn={editing} onClose={() => { setCreating(false); setEditing(null) }} />}
    </div>
  )
}

function DbForm({ conn, onClose }: { conn: DbConnection | null; onClose: () => void }): JSX.Element {
  const { vault, upsertDatabase } = useStore()
  const servers = vault?.servers ?? []
  const [form, setForm] = useState<DbConnection>(
    () =>
      conn ?? {
        id: uuid(),
        name: '',
        type: 'postgres',
        host: '127.0.0.1',
        port: 5432,
        username: 'postgres',
        password: '',
        database: '',
        sshServerId: null,
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
  )

  function set<K extends keyof DbConnection>(k: K, v: DbConnection[K]): void {
    setForm((f) => ({ ...f, [k]: v }))
  }
  function setType(t: DbType): void {
    setForm((f) => ({ ...f, type: t, port: TYPE_META[t].port }))
  }

  async function save(): Promise<void> {
    if (!form.name.trim() || !form.host.trim()) return
    await upsertDatabase({ ...form, updatedAt: Date.now() })
    onClose()
  }

  return (
    <Modal
      title={conn ? 'Edit Connection' : 'New Database Connection'}
      onClose={onClose}
      width={560}
      footer={
        <>
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={save} disabled={!form.name.trim() || !form.host.trim()} className="btn-primary">Save</button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="label">Name *</label>
            <input autoFocus value={form.name} onChange={(e) => set('name', e.target.value)} className="field" placeholder="Production DB" />
          </div>
          <div>
            <label className="label">Type</label>
            <select value={form.type} onChange={(e) => setType(e.target.value as DbType)} className="field">
              <option value="postgres">PostgreSQL</option>
              <option value="mysql">MySQL</option>
              <option value="redis">Redis</option>
            </select>
          </div>
          <div>
            <label className="label">SSH tunnel (optional)</label>
            <select value={form.sshServerId ?? ''} onChange={(e) => set('sshServerId', e.target.value || null)} className="field">
              <option value="">— Direct —</option>
              {servers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Host</label>
            <input value={form.host} onChange={(e) => set('host', e.target.value)} className="field" placeholder="127.0.0.1" />
          </div>
          <div>
            <label className="label">Port</label>
            <input type="number" value={form.port} onChange={(e) => set('port', Number(e.target.value))} className="field" />
          </div>
          {form.type !== 'redis' && (
            <div>
              <label className="label">Username</label>
              <input value={form.username} onChange={(e) => set('username', e.target.value)} className="field" />
            </div>
          )}
          <div>
            <label className="label">Password</label>
            <input type="password" value={form.password} onChange={(e) => set('password', e.target.value)} className="field" placeholder="••••••" />
          </div>
          <div className={form.type === 'redis' ? '' : 'col-span-2'}>
            <label className="label">{form.type === 'redis' ? 'DB index' : 'Database name'}</label>
            <input value={form.database} onChange={(e) => set('database', e.target.value)} className="field" placeholder={form.type === 'redis' ? '0' : 'mydb'} />
          </div>
        </div>
        {form.sshServerId && (
          <p className="text-[11px] text-slate-500">
            The connection is tunneled over the selected server's SSH — host is the address as seen from that server (e.g. 127.0.0.1).
          </p>
        )}
      </div>
    </Modal>
  )
}
