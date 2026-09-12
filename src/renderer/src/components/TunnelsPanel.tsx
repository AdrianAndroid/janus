import { useEffect, useState } from 'react'
import { v4 as uuid } from 'uuid'
import { Network, Plus, Play, Square, Pencil, Trash2, ArrowRight, Loader2 } from 'lucide-react'
import { useStore } from '../store'
import Modal from './Modal'
import type { TunnelRule, TunnelType } from '@shared/types'

type Status = 'connected' | 'connecting' | 'disconnected' | 'error'

export default function TunnelsPanel(): JSX.Element {
  const { vault, deleteTunnel } = useStore()
  const tunnels = vault?.tunnels ?? []
  const servers = vault?.servers ?? []
  const [editing, setEditing] = useState<TunnelRule | null>(null)
  const [creating, setCreating] = useState(false)
  const [status, setStatus] = useState<Record<string, Status>>({})
  const [pending, setPending] = useState<string | null>(null)

  useEffect(() => {
    const offs = tunnels.map((t) =>
      window.janus.tunnel.onStatus(t.id, (p) => setStatus((s) => ({ ...s, [t.id]: p.status as Status })))
    )
    return () => offs.forEach((off) => off())
  }, [tunnels])

  async function toggle(t: TunnelRule): Promise<void> {
    setPending(t.id)
    try {
      if (status[t.id] === 'connected') {
        await window.janus.tunnel.stop(t.id)
        setStatus((s) => ({ ...s, [t.id]: 'disconnected' }))
      } else {
        setStatus((s) => ({ ...s, [t.id]: 'connecting' }))
        await window.janus.tunnel.start(t)
        setStatus((s) => ({ ...s, [t.id]: 'connected' }))
      }
    } catch (e) {
      setStatus((s) => ({ ...s, [t.id]: 'error' }))
      alert((e as Error).message)
    } finally {
      setPending(null)
    }
  }

  function describe(t: TunnelRule): JSX.Element {
    if (t.type === 'local')
      return (
        <span className="flex items-center gap-1.5 font-mono text-xs text-slate-400">
          localhost:{t.localPort} <ArrowRight size={12} /> {t.remoteHost}:{t.remotePort}
        </span>
      )
    if (t.type === 'remote')
      return (
        <span className="flex items-center gap-1.5 font-mono text-xs text-slate-400">
          remote:{t.remotePort} <ArrowRight size={12} /> {t.localHost}:{t.localPort}
        </span>
      )
    return <span className="font-mono text-xs text-slate-400">SOCKS5 proxy · localhost:{t.localPort}</span>
  }

  return (
    <div className="flex h-full flex-col bg-ink-900">
      <div className="flex items-center justify-between border-b border-ink-600 px-6 py-4">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-bold text-white">
            <Network size={20} className="text-accent" /> Port Forwarding
          </h1>
          <p className="text-sm text-slate-500">Local, remote, and dynamic (SOCKS) SSH tunnels.</p>
        </div>
        <button onClick={() => setCreating(true)} className="btn-primary" disabled={servers.length === 0}>
          <Plus size={16} /> New Tunnel
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {tunnels.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center text-slate-500">
            <Network size={48} className="mb-3 opacity-40" />
            <p>{servers.length === 0 ? 'Add a server first.' : 'No tunnels yet.'}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {tunnels.map((t) => {
              const st = status[t.id] ?? 'disconnected'
              const server = servers.find((s) => s.id === t.serverId)
              const active = st === 'connected'
              return (
                <div key={t.id} className="flex items-center gap-4 rounded-xl border border-ink-600 bg-ink-800 px-4 py-3">
                  <span
                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                      active ? 'bg-good' : st === 'connecting' ? 'bg-warn animate-pulse' : st === 'error' ? 'bg-bad' : 'bg-slate-600'
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-100">{t.name}</span>
                      <span className="chip uppercase">{t.type}</span>
                    </div>
                    {describe(t)}
                    <div className="text-[11px] text-slate-500">via {server?.name ?? 'unknown server'}</div>
                  </div>
                  <button
                    onClick={() => toggle(t)}
                    disabled={pending === t.id}
                    className={active ? 'btn-danger' : 'btn-primary'}
                  >
                    {pending === t.id ? <Loader2 size={14} className="animate-spin" /> : active ? <Square size={14} /> : <Play size={14} />}
                    {active ? 'Stop' : 'Start'}
                  </button>
                  <button onClick={() => setEditing(t)} className="rounded p-2 text-slate-400 hover:bg-ink-600" title="Edit">
                    <Pencil size={15} />
                  </button>
                  <button
                    onClick={() => confirm(`Delete "${t.name}"?`) && deleteTunnel(t.id)}
                    className="rounded p-2 text-slate-400 hover:bg-bad hover:text-white"
                    title="Delete"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {(creating || editing) && <TunnelForm rule={editing} onClose={() => { setCreating(false); setEditing(null) }} />}
    </div>
  )
}

function TunnelForm({ rule, onClose }: { rule: TunnelRule | null; onClose: () => void }): JSX.Element {
  const { vault, upsertTunnel } = useStore()
  const servers = vault?.servers ?? []
  const [form, setForm] = useState<TunnelRule>(
    () =>
      rule ?? {
        id: uuid(),
        serverId: servers[0]?.id ?? '',
        name: '',
        type: 'local',
        localHost: '127.0.0.1',
        localPort: 8080,
        remoteHost: '127.0.0.1',
        remotePort: 80
      }
  )

  function set<K extends keyof TunnelRule>(k: K, v: TunnelRule[K]): void {
    setForm((f) => ({ ...f, [k]: v }))
  }

  async function save(): Promise<void> {
    if (!form.name.trim() || !form.serverId) return
    await upsertTunnel(form)
    onClose()
  }

  return (
    <Modal
      title={rule ? 'Edit Tunnel' : 'New Tunnel'}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={save} disabled={!form.name.trim() || !form.serverId} className="btn-primary">Save</button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Name *</label>
            <input autoFocus value={form.name} onChange={(e) => set('name', e.target.value)} className="field" placeholder="DB tunnel" />
          </div>
          <div>
            <label className="label">Server *</label>
            <select value={form.serverId} onChange={(e) => set('serverId', e.target.value)} className="field">
              {servers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="label">Tunnel type</label>
          <select value={form.type} onChange={(e) => set('type', e.target.value as TunnelType)} className="field">
            <option value="local">Local (local port → remote target)</option>
            <option value="remote">Remote (remote port → local target)</option>
            <option value="dynamic">Dynamic (SOCKS5 proxy)</option>
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Local host</label>
            <input value={form.localHost} onChange={(e) => set('localHost', e.target.value)} className="field" />
          </div>
          <div>
            <label className="label">Local port</label>
            <input type="number" value={form.localPort} onChange={(e) => set('localPort', Number(e.target.value))} className="field" />
          </div>
        </div>

        {form.type !== 'dynamic' && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Remote host</label>
              <input value={form.remoteHost} onChange={(e) => set('remoteHost', e.target.value)} className="field" />
            </div>
            <div>
              <label className="label">Remote port</label>
              <input type="number" value={form.remotePort} onChange={(e) => set('remotePort', Number(e.target.value))} className="field" />
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
