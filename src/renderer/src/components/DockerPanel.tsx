import { useEffect, useState, useCallback } from 'react'
import { Box, Cog, Activity, RefreshCw, Play, Square, RotateCw, Loader2, AlertCircle, Trash2 } from 'lucide-react'
import { useStore } from '../store'
import type { Tab } from '../store'

type View = 'docker' | 'services' | 'procs'

export default function DockerPanel({ tab }: { tab: Tab }): JSX.Element {
  const { setTabStatus } = useStore()
  const sid = tab.serverId
  const [view, setView] = useState<View>('docker')
  const [rows, setRows] = useState<string[][]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const queries: Record<View, string> = {
    docker: `docker ps -a --no-trunc --format '{{.ID}}|{{.Names}}|{{.Image}}|{{.State}}|{{.Status}}' 2>&1 || echo "__NODOCKER__"`,
    services: `systemctl list-units --type=service --all --no-pager --plain --no-legend 2>/dev/null | awk '{print $1"|"$3"|"$4}' | head -n 200 || echo "__NOSYSTEMD__"`,
    procs: `ps -eo pid,pcpu,pmem,comm --sort=-pcpu 2>/dev/null | head -n 26`
  }

  const load = useCallback(
    async (v: View) => {
      setLoading(true)
      setError(null)
      try {
        const { stdout } = await window.janus.ssh.exec(sid, queries[v])
        setTabStatus(tab.id, 'connected')
        if (stdout.includes('__NODOCKER__')) {
          setRows([])
          setError('Docker not found on this server.')
          return
        }
        if (stdout.includes('__NOSYSTEMD__')) {
          setRows([])
          setError('systemd not found on this server.')
          return
        }
        const lines = stdout.trim().split('\n').filter(Boolean)
        if (v === 'procs') {
          setRows(lines.slice(1).map((l) => l.trim().split(/\s+/).slice(0, 4)))
        } else {
          setRows(lines.map((l) => l.split('|')))
        }
      } catch (e) {
        setError((e as Error).message)
        setTabStatus(tab.id, 'error')
      } finally {
        setLoading(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sid, tab.id]
  )

  useEffect(() => {
    load(view)
  }, [view, load])

  async function act(key: string, cmd: string): Promise<void> {
    setBusy(key)
    try {
      const { stderr, code } = await window.janus.ssh.exec(sid, cmd)
      if (code !== 0 && stderr) alert(stderr)
      await load(view)
    } catch (e) {
      alert((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const tabs: { id: View; label: string; icon: typeof Box }[] = [
    { id: 'docker', label: 'Containers', icon: Box },
    { id: 'services', label: 'Services', icon: Cog },
    { id: 'procs', label: 'Processes', icon: Activity }
  ]

  return (
    <div className="flex h-full flex-col bg-ink-900">
      <div className="flex items-center gap-1 border-b border-ink-600 bg-ink-800 px-3 py-2">
        {tabs.map((t) => {
          const Icon = t.icon
          return (
            <button
              key={t.id}
              onClick={() => setView(t.id)}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm ${
                view === t.id ? 'bg-accent/15 text-accent' : 'text-slate-400 hover:bg-ink-700'
              }`}
            >
              <Icon size={15} /> {t.label}
            </button>
          )
        })}
        <button onClick={() => load(view)} className="btn-ghost ml-auto px-2 py-1.5" title="Refresh">
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-warn/10 px-4 py-2 text-xs text-warn">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {loading && rows.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500">
            <Loader2 size={16} className="animate-spin" /> Loading…
          </div>
        ) : view === 'docker' ? (
          <DockerTable rows={rows} busy={busy} act={act} />
        ) : view === 'services' ? (
          <ServiceTable rows={rows} busy={busy} act={act} />
        ) : (
          <ProcTable rows={rows} busy={busy} act={act} />
        )}
      </div>
    </div>
  )
}

const stateColor = (s: string): string =>
  /run|active|listen/i.test(s) ? 'text-good' : /exit|dead|fail|stop/i.test(s) ? 'text-bad' : 'text-slate-400'

function ActionBtn({
  icon: Icon,
  busy,
  onClick,
  title,
  danger
}: {
  icon: typeof Play
  busy: boolean
  onClick: () => void
  title: string
  danger?: boolean
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      title={title}
      className={`rounded p-1.5 hover:bg-ink-600 ${danger ? 'text-bad' : 'text-slate-400 hover:text-white'}`}
    >
      {busy ? <Loader2 size={13} className="animate-spin" /> : <Icon size={13} />}
    </button>
  )
}

function DockerTable({ rows, busy, act }: { rows: string[][]; busy: string | null; act: (k: string, c: string) => void }): JSX.Element {
  if (!rows.length) return <Empty text="No containers." />
  return (
    <table className="w-full text-sm">
      <Thead cols={['Name', 'Image', 'Status', '']} />
      <tbody>
        {rows.map(([id, name, image, state, status]) => (
          <tr key={id} className="border-b border-ink-700/50 hover:bg-ink-800">
            <td className="px-3 py-1.5 font-medium text-slate-200">{name}</td>
            <td className="px-3 py-1.5 text-xs text-slate-500">{image}</td>
            <td className={`px-3 py-1.5 text-xs ${stateColor(state)}`}>{status}</td>
            <td className="px-3 py-1.5">
              <div className="flex justify-end gap-1">
                <ActionBtn icon={Play} busy={busy === `s${id}`} onClick={() => act(`s${id}`, `docker start ${id}`)} title="Start" />
                <ActionBtn icon={Square} busy={busy === `t${id}`} onClick={() => act(`t${id}`, `docker stop ${id}`)} title="Stop" />
                <ActionBtn icon={RotateCw} busy={busy === `r${id}`} onClick={() => act(`r${id}`, `docker restart ${id}`)} title="Restart" />
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function ServiceTable({ rows, busy, act }: { rows: string[][]; busy: string | null; act: (k: string, c: string) => void }): JSX.Element {
  if (!rows.length) return <Empty text="No services." />
  return (
    <table className="w-full text-sm">
      <Thead cols={['Service', 'Status', '']} />
      <tbody>
        {rows.map(([unit, active, sub]) => (
          <tr key={unit} className="border-b border-ink-700/50 hover:bg-ink-800">
            <td className="px-3 py-1.5 font-mono text-xs text-slate-200">{unit}</td>
            <td className={`px-3 py-1.5 text-xs ${stateColor(active + sub)}`}>
              {active} · {sub}
            </td>
            <td className="px-3 py-1.5">
              <div className="flex justify-end gap-1">
                <ActionBtn icon={Play} busy={busy === `s${unit}`} onClick={() => act(`s${unit}`, `systemctl start ${unit}`)} title="Start" />
                <ActionBtn icon={Square} busy={busy === `t${unit}`} onClick={() => act(`t${unit}`, `systemctl stop ${unit}`)} title="Stop" />
                <ActionBtn icon={RotateCw} busy={busy === `r${unit}`} onClick={() => act(`r${unit}`, `systemctl restart ${unit}`)} title="Restart" />
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function ProcTable({ rows, busy, act }: { rows: string[][]; busy: string | null; act: (k: string, c: string) => void }): JSX.Element {
  if (!rows.length) return <Empty text="No process info." />
  return (
    <table className="w-full text-sm">
      <Thead cols={['PID', 'CPU%', 'MEM%', 'Command', '']} />
      <tbody>
        {rows.map(([pid, cpu, mem, comm]) => (
          <tr key={pid} className="border-b border-ink-700/50 hover:bg-ink-800">
            <td className="px-3 py-1.5 font-mono text-xs text-slate-400">{pid}</td>
            <td className="px-3 py-1.5 text-xs text-slate-300">{cpu}</td>
            <td className="px-3 py-1.5 text-xs text-slate-300">{mem}</td>
            <td className="px-3 py-1.5 font-mono text-xs text-slate-200">{comm}</td>
            <td className="px-3 py-1.5">
              <div className="flex justify-end">
                <ActionBtn
                  icon={Trash2}
                  danger
                  busy={busy === `k${pid}`}
                  onClick={() => confirm(`Kill PID ${pid}?`) && act(`k${pid}`, `kill ${pid}`)}
                  title="Kill"
                />
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Thead({ cols }: { cols: string[] }): JSX.Element {
  return (
    <thead className="text-[11px] uppercase tracking-wide text-slate-500">
      <tr>
        {cols.map((c, i) => (
          <th key={i} className={`px-3 py-2 font-medium ${i === cols.length - 1 ? 'text-right' : 'text-left'}`}>
            {c}
          </th>
        ))}
      </tr>
    </thead>
  )
}

function Empty({ text }: { text: string }): JSX.Element {
  return <div className="py-12 text-center text-sm text-slate-500">{text}</div>
}
