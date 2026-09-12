import { useEffect, useRef, useState, useCallback } from 'react'
import { LayoutDashboard, RefreshCw, Terminal as TerminalIcon, Server, Cpu, Loader2 } from 'lucide-react'
import { useStore } from '../store'
import { fmtBytes, fmtUptime, tier } from '../lib/metrics'
import { ratios, record, checkAlerts, history } from '../lib/metricsHistory'
import Sparkline from './Sparkline'
import type { ServerMetrics } from '@shared/types'

type MetricMap = Record<string, ServerMetrics | 'loading' | undefined>

export default function FleetDashboard(): JSX.Element {
  const { vault, openTerminal, selectServer, setSidePanel, notify } = useStore()
  const servers = vault?.servers ?? []
  const [metrics, setMetrics] = useState<MetricMap>({})
  const [refreshing, setRefreshing] = useState(false)
  const [auto, setAuto] = useState(true)
  const timer = useRef<ReturnType<typeof setInterval>>()
  const prevReach = useRef<Record<string, boolean>>({})

  const refreshAll = useCallback(async () => {
    if (servers.length === 0) return
    setRefreshing(true)
    setMetrics((m) => {
      const next = { ...m }
      servers.forEach((s) => {
        if (!next[s.id]) next[s.id] = 'loading'
      })
      return next
    })
    await Promise.all(
      servers.map(async (s) => {
        try {
          const r = await window.janus.ssh.metrics(s.id)
          setMetrics((m) => ({ ...m, [s.id]: r }))
          // Notify on a fresh transition to unreachable.
          if (prevReach.current[s.id] === true && !r.reachable) {
            notify('Server offline', `${s.name} (${s.host}) is not responding.`)
          }
          prevReach.current[s.id] = r.reachable
          if (r.reachable) {
            const rt = ratios(r)
            record(s.id, { t: Date.now(), ...rt })
            checkAlerts(s.id, s.name, rt, notify)
          }
        } catch (e) {
          setMetrics((m) => ({ ...m, [s.id]: { reachable: false, error: (e as Error).message } }))
          prevReach.current[s.id] = false
        }
      })
    )
    setRefreshing(false)
  }, [servers])

  useEffect(() => {
    refreshAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    clearInterval(timer.current)
    if (auto && servers.length) timer.current = setInterval(refreshAll, 20000)
    return () => clearInterval(timer.current)
  }, [auto, refreshAll, servers.length])

  const online = servers.filter((s) => {
    const m = metrics[s.id]
    return m && m !== 'loading' && m.reachable
  }).length

  return (
    <div className="flex h-full flex-col bg-ink-900">
      <div className="flex items-center justify-between border-b border-ink-600 px-6 py-4">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-bold text-white">
            <LayoutDashboard size={20} className="text-accent" /> Fleet Dashboard
          </h1>
          <p className="text-sm text-slate-500">
            {servers.length} servers · <span className="text-good">{online} online</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-400">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} className="h-4 w-4 accent-accent" />
            Auto-refresh (20s)
          </label>
          <button onClick={refreshAll} disabled={refreshing} className="btn-ghost border border-ink-500">
            <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {servers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center text-slate-500">
            <Server size={48} className="mb-3 opacity-40" />
            <p>No servers yet. Add a server to see it on the fleet dashboard.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {servers.map((s) => (
              <Card
                key={s.id}
                name={s.name}
                host={`${s.username}@${s.host}`}
                color={s.color}
                m={metrics[s.id]}
                hist={history(s.id).map((x) => x.mem)}
                onOpen={() => openTerminal(s.id)}
                onSelect={() => {
                  selectServer(s.id)
                  setSidePanel('servers')
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function Card({
  name,
  host,
  color,
  m,
  hist,
  onOpen,
  onSelect
}: {
  name: string
  host: string
  color?: string
  m: ServerMetrics | 'loading' | undefined
  hist: number[]
  onOpen: () => void
  onSelect: () => void
}): JSX.Element {
  const loading = m === 'loading' || m === undefined
  const data = loading ? null : (m as ServerMetrics)
  const reachable = !!data?.reachable

  const memR = data?.memTotal ? (data.memUsed ?? 0) / data.memTotal : 0
  const diskR = data?.diskTotal ? (data.diskUsed ?? 0) / data.diskTotal : 0
  const loadR = data?.cpuCount && data.load ? data.load[0] / data.cpuCount : 0
  const worst = Math.max(memR, diskR, loadR)
  const dot = loading ? 'bg-slate-600 animate-pulse' : reachable ? tier(worst).bar : 'bg-bad'

  return (
    <div className="group rounded-xl border border-ink-600 bg-ink-800 p-4 transition-colors hover:border-ink-500">
      <div className="mb-3 flex items-center gap-2">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${dot}`} />
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color || '#3a4048' }} />
        <button onClick={onSelect} className="min-w-0 flex-1 text-left">
          <div className="truncate font-semibold text-slate-100">{name}</div>
          <div className="truncate text-[11px] text-slate-500">{host}</div>
        </button>
        <button onClick={onOpen} className="rounded p-1.5 text-accent opacity-0 hover:bg-ink-600 group-hover:opacity-100" title="Terminal">
          <TerminalIcon size={15} />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-3 text-xs text-slate-500">
          <Loader2 size={14} className="animate-spin" /> Measuring…
        </div>
      ) : !reachable ? (
        <div className="truncate py-2 text-xs text-bad" title={data?.error}>
          ✖ Unreachable
        </div>
      ) : (
        <div className="space-y-2">
          <MiniBar label="RAM" ratio={memR} detail={`${fmtBytes(data?.memUsed)} / ${fmtBytes(data?.memTotal)}`} />
          <MiniBar label="Disk" ratio={diskR} detail={`${fmtBytes(data?.diskUsed)} / ${fmtBytes(data?.diskTotal)}`} />
          <div className="flex items-center justify-between pt-0.5 text-[11px] text-slate-500">
            <span className="flex items-center gap-1">
              <Cpu size={11} /> load {data?.load ? data.load[0].toFixed(2) : '—'}
              <span className="text-slate-600">/{data?.cpuCount ?? '?'}</span>
            </span>
            <span>uptime {fmtUptime(data?.uptimeSec)}</span>
          </div>
          <div className="mt-1 border-t border-ink-700 pt-2">
            <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-600">RAM history</div>
            <div className="h-[30px] w-full">
              <Sparkline values={hist} width={280} height={30} color={color || '#818cf8'} threshold={0.9} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function MiniBar({ label, ratio, detail }: { label: string; ratio: number; detail: string }): JSX.Element {
  const t = tier(ratio)
  return (
    <div>
      <div className="mb-0.5 flex items-center justify-between text-[11px]">
        <span className="text-slate-400">{label}</span>
        <span className="font-mono text-slate-500">
          {detail} <span className={t.color}>{Math.round(ratio * 100)}%</span>
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-600">
        <div className={`h-full ${t.bar}`} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
      </div>
    </div>
  )
}
