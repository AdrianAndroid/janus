import { useEffect, useState, useCallback } from 'react'
import {
  Terminal as TerminalIcon,
  FolderTree,
  Pencil,
  Server,
  Tag,
  Clock,
  Globe,
  User,
  KeyRound,
  Activity,
  Cpu,
  MemoryStick,
  HardDrive,
  RefreshCw,
  Loader2,
  AlertCircle,
  Box,
  ScrollText,
  Monitor,
  MonitorPlay,
  PieChart
} from 'lucide-react'
import { useStore } from '../store'
import { ratios, record, history } from '../lib/metricsHistory'
import Sparkline from './Sparkline'
import type { ServerMetrics } from '@shared/types'

function timeAgo(ts?: number): string {
  if (!ts) return 'never'
  const diff = Date.now() - ts
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export default function ServerDetail(): JSX.Element {
  const { vault, selectedServerId, openTerminal, openSftp, openDocker, openLogs, openVnc, openServerForm } = useStore()
  const server = vault?.servers.find((s) => s.id === selectedServerId)

  if (!server) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-center text-slate-500">
        <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-3xl bg-ink-700 text-accent">
          <Server size={40} />
        </div>
        <h2 className="text-lg font-semibold text-slate-300">Welcome to Janus</h2>
        <p className="mt-1 max-w-sm text-sm">
          Select a server on the left or double-click to connect. Use the{' '}
          <kbd className="rounded bg-ink-600 px-1.5 py-0.5 text-xs">+</kbd> button to add a new server.
        </p>
      </div>
    )
  }

  const auth =
    server.authMethod === 'password' ? 'Password' : server.authMethod === 'key' ? 'SSH Key' : 'SSH Agent'

  return (
    <div className="mx-auto max-w-2xl p-8">
      <div className="mb-6 flex items-start gap-4">
        <div
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-white"
          style={{ background: server.color || '#3a465c' }}
        >
          <Server size={28} />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-bold text-white">{server.name}</h1>
          <p className="text-slate-400">
            {server.username}@{server.host}:{server.port}
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            {server.tags.map((t) => (
              <span key={t} className="chip">
                <Tag size={10} /> {t}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="mb-6 flex flex-col gap-2">
        <div className="flex gap-2">
          <button onClick={() => openTerminal(server.id)} className="btn-primary">
            <TerminalIcon size={16} /> Open Terminal
          </button>
          <button onClick={() => openSftp(server.id)} className="btn-ghost border border-ink-500">
            <FolderTree size={16} /> Files
          </button>
          <button
            onClick={() =>
              window.janus.diskUsage
                .openWindow({ target: { kind: 'ssh', serverId: server.id } })
                .catch((e) => alert((e as Error).message))
            }
            className="btn-ghost border border-ink-500"
          >
            <PieChart size={16} /> Disk Usage
          </button>
          <button onClick={() => openDocker(server.id)} className="btn-ghost border border-ink-500">
            <Box size={16} /> Services
          </button>
        </div>
        <div className="flex gap-2">
          <button onClick={() => openLogs(server.id)} className="btn-ghost border border-ink-500">
            <ScrollText size={16} /> Logs
          </button>
          <button onClick={() => openVnc(server.id)} className="btn-ghost border border-ink-500">
            <Monitor size={16} /> VNC
          </button>
          <button
            onClick={() => window.janus.rdp.launch(server.id).catch((e) => alert((e as Error).message))}
            className="btn-ghost border border-ink-500"
            title="Windows remote desktop"
          >
            <MonitorPlay size={16} /> RDP
          </button>
          <button onClick={() => openServerForm(server)} className="btn-ghost border border-ink-500">
            <Pencil size={16} /> Edit
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <InfoCard icon={Globe} label="Host" value={`${server.host}:${server.port}`} />
        <InfoCard icon={User} label="User" value={server.username} />
        <InfoCard icon={KeyRound} label="Authentication" value={auth} />
        <InfoCard icon={Clock} label="Last connected" value={timeAgo(server.lastConnectedAt)} />
      </div>

      <MetricsCard serverId={server.id} />

      {server.notes && (
        <div className="mt-6">
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">Notes</h3>
          <div className="whitespace-pre-wrap rounded-lg border border-ink-600 bg-ink-800 p-4 text-sm text-slate-300">
            {server.notes}
          </div>
        </div>
      )}
    </div>
  )
}

function InfoCard({ icon: Icon, label, value }: { icon: typeof Globe; label: string; value: string }): JSX.Element {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-ink-600 bg-ink-800 px-4 py-3">
      <Icon size={18} className="text-accent" />
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
        <div className="truncate text-sm text-slate-200">{value}</div>
      </div>
    </div>
  )
}

// ---- Live health metrics (DevOps) ----

function fmtBytes(b?: number): string {
  if (!b || b < 0) return '—'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = b
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`
}

function fmtUptime(sec?: number): string {
  if (!sec) return '—'
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

/** 0..1 ratio → color + label tier. */
function tier(ratio: number): { color: string; bar: string } {
  if (ratio >= 0.9) return { color: 'text-bad', bar: 'bg-bad' }
  if (ratio >= 0.75) return { color: 'text-warn', bar: 'bg-warn' }
  return { color: 'text-good', bar: 'bg-good' }
}

function MetricsCard({ serverId }: { serverId: string }): JSX.Element {
  const [data, setData] = useState<ServerMetrics | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const m = await window.janus.ssh.metrics(serverId)
      setData(m)
      if (m.reachable) record(serverId, { t: Date.now(), ...ratios(m) })
    } catch (e) {
      setData({ reachable: false, error: (e as Error).message })
    } finally {
      setLoading(false)
    }
  }, [serverId])

  useEffect(() => {
    setData(null)
    load()
  }, [load])

  const memRatio = data?.memTotal ? (data.memUsed ?? 0) / data.memTotal : 0
  const diskRatio = data?.diskTotal ? (data.diskUsed ?? 0) / data.diskTotal : 0
  const loadRatio = data?.cpuCount && data.load ? data.load[0] / data.cpuCount : 0
  const worst = Math.max(memRatio, diskRatio, loadRatio)
  const health = data?.reachable ? tier(worst) : { color: 'text-slate-500', bar: 'bg-slate-600' }
  const healthLabel = !data?.reachable
    ? 'unreachable'
    : worst >= 0.9
      ? 'critical'
      : worst >= 0.75
        ? 'high load'
        : 'healthy'

  return (
    <div className="mt-6 rounded-xl border border-ink-600 bg-ink-800 p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-200">
          <Activity size={16} className="text-accent" /> System Status
          <span className={`flex items-center gap-1 text-xs font-medium ${health.color}`}>
            <span className={`h-2 w-2 rounded-full ${health.bar}`} /> {healthLabel}
          </span>
        </h3>
        <button onClick={load} disabled={loading} className="btn-ghost border border-ink-500 px-2 py-1 text-xs">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {loading && !data && (
        <div className="flex items-center justify-center gap-2 py-6 text-sm text-slate-500">
          <Loader2 size={16} className="animate-spin" /> Loading metrics…
        </div>
      )}

      {data && !data.reachable && (
        <div className="flex items-center gap-2 rounded-md bg-bad/10 px-3 py-2 text-xs text-bad">
          <AlertCircle size={14} /> {data.error || 'Could not reach the server.'}
        </div>
      )}

      {data && data.reachable && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="flex items-center gap-2 text-slate-400">
              <Server size={14} className="text-slate-500" /> {data.os || 'Linux'}
            </div>
            <div className="flex items-center gap-2 text-slate-400">
              <Clock size={14} className="text-slate-500" /> uptime {fmtUptime(data.uptimeSec)}
            </div>
          </div>

          <Gauge
            icon={MemoryStick}
            label="RAM"
            used={fmtBytes(data.memUsed)}
            total={fmtBytes(data.memTotal)}
            ratio={memRatio}
          />
          <Gauge
            icon={HardDrive}
            label="Disk ( / )"
            used={fmtBytes(data.diskUsed)}
            total={fmtBytes(data.diskTotal)}
            ratio={diskRatio}
          />

          <div className="flex items-center gap-2">
            <Cpu size={15} className="text-slate-500" />
            <span className="text-xs text-slate-400">Load (1·5·15m)</span>
            <span className={`font-mono text-sm ${tier(loadRatio).color}`}>
              {data.load ? data.load.map((l) => l.toFixed(2)).join('  ') : '—'}
            </span>
            <span className="text-xs text-slate-600">/ {data.cpuCount ?? '?'} cores</span>
          </div>

          <div className="grid grid-cols-3 gap-3 border-t border-ink-700 pt-3">
            <HistChart label="RAM" values={history(serverId).map((x) => x.mem)} color="#818cf8" />
            <HistChart label="Disk" values={history(serverId).map((x) => x.disk)} color="#fbbf24" />
            <HistChart label="Load" values={history(serverId).map((x) => x.cpu)} color="#34d399" />
          </div>
        </div>
      )}
    </div>
  )
}

function HistChart({ label, values, color }: { label: string; values: number[]; color: string }): JSX.Element {
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-600">{label} history</div>
      <div className="h-8 w-full">
        <Sparkline values={values} width={200} height={32} color={color} threshold={0.9} />
      </div>
    </div>
  )
}

function Gauge({
  icon: Icon,
  label,
  used,
  total,
  ratio
}: {
  icon: typeof MemoryStick
  label: string
  used: string
  total: string
  ratio: number
}): JSX.Element {
  const t = tier(ratio)
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="flex items-center gap-1.5 text-slate-400">
          <Icon size={14} className="text-slate-500" /> {label}
        </span>
        <span className="font-mono text-slate-400">
          {used} / {total} <span className={t.color}>({Math.round(ratio * 100)}%)</span>
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-ink-600">
        <div className={`h-full ${t.bar} transition-all`} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
      </div>
    </div>
  )
}
