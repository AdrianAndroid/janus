import { useEffect, useRef, useState } from 'react'
import { ScrollText, Play, Square, Trash2, ArrowDownToLine } from 'lucide-react'
import { useStore } from '../store'
import type { Tab } from '../store'

const PRESETS = [
  { label: 'syslog', cmd: 'tail -n 200 -F /var/log/syslog' },
  { label: 'nginx access', cmd: 'tail -n 200 -F /var/log/nginx/access.log' },
  { label: 'nginx error', cmd: 'tail -n 200 -F /var/log/nginx/error.log' },
  { label: 'auth', cmd: 'tail -n 200 -F /var/log/auth.log' },
  { label: 'journalctl -f', cmd: 'journalctl -f -n 200 --no-pager' }
]

export default function LogsPanel({ tab }: { tab: Tab }): JSX.Element {
  const { setTabStatus } = useStore()
  const sid = tab.serverId
  const [cmd, setCmd] = useState(PRESETS[0].cmd)
  const [running, setRunning] = useState(false)
  const [lines, setLines] = useState<string[]>([])
  const [filter, setFilter] = useState('')
  const [autoScroll, setAutoScroll] = useState(true)
  const bufRef = useRef<string[]>([])
  const tailRef = useRef('')
  const bottomRef = useRef<HTMLDivElement>(null)

  // Throttled flush of incoming chunks into state.
  useEffect(() => {
    const t = setInterval(() => {
      if (bufRef.current.length) {
        setLines((prev) => {
          const next = [...prev, ...bufRef.current]
          bufRef.current = []
          return next.length > 3000 ? next.slice(next.length - 3000) : next
        })
      }
    }, 250)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [lines, autoScroll])

  function start(): void {
    setLines([])
    bufRef.current = []
    tailRef.current = ''
    const streamId = tab.id
    const off = window.janus.stream.onData(streamId, (chunk) => {
      const text = tailRef.current + chunk
      const parts = text.split('\n')
      tailRef.current = parts.pop() ?? ''
      bufRef.current.push(...parts)
    })
    const offS = window.janus.stream.onStatus(streamId, (p) => {
      if (p.status === 'open') {
        setRunning(true)
        setTabStatus(tab.id, 'connected')
      }
      if (p.status === 'closed') setRunning(false)
      if (p.status === 'error') {
        setRunning(false)
        setTabStatus(tab.id, 'error')
        bufRef.current.push(`✖ ${p.message || 'stream error'}`)
      }
    })
    cleanupRef.current = () => {
      off()
      offS()
    }
    window.janus.stream.start(streamId, sid, cmd).catch((e) => bufRef.current.push(`✖ ${(e as Error).message}`))
  }

  function stop(): void {
    window.janus.stream.stop(tab.id)
    cleanupRef.current?.()
    setRunning(false)
  }

  const cleanupRef = useRef<() => void>()
  useEffect(() => {
    return () => {
      window.janus.stream.stop(tab.id)
      cleanupRef.current?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const shown = filter ? lines.filter((l) => l.toLowerCase().includes(filter.toLowerCase())) : lines
  const lineColor = (l: string): string =>
    /error|fail|fatal|panic|✖/i.test(l) ? 'text-bad' : /warn/i.test(l) ? 'text-warn' : 'text-slate-300'

  return (
    <div className="flex h-full flex-col bg-ink-900">
      <div className="flex flex-wrap items-center gap-2 border-b border-ink-600 bg-ink-800 px-3 py-2">
        <ScrollText size={16} className="text-accent" />
        <select
          onChange={(e) => setCmd(e.target.value)}
          className="field w-36 py-1.5 text-xs"
          disabled={running}
          value={PRESETS.find((p) => p.cmd === cmd)?.cmd ?? ''}
        >
          {PRESETS.map((p) => (
            <option key={p.label} value={p.cmd}>
              {p.label}
            </option>
          ))}
          <option value="">custom…</option>
        </select>
        <input
          value={cmd}
          onChange={(e) => setCmd(e.target.value)}
          disabled={running}
          className="field flex-1 py-1.5 font-mono text-xs"
          placeholder="tail -F /path/to/log"
        />
        {running ? (
          <button onClick={stop} className="btn-danger px-3 py-1.5 text-xs">
            <Square size={13} /> Stop
          </button>
        ) : (
          <button onClick={start} className="btn-primary px-3 py-1.5 text-xs">
            <Play size={13} /> Start
          </button>
        )}
      </div>

      <div className="flex items-center gap-2 border-b border-ink-600 px-3 py-1.5">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="filter (live)…"
          className="field flex-1 py-1 text-xs"
        />
        <label className="flex shrink-0 items-center gap-1 text-[11px] text-slate-400">
          <ArrowDownToLine size={12} /> auto-scroll
          <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} className="h-3.5 w-3.5 accent-accent" />
        </label>
        <button onClick={() => setLines([])} className="btn-ghost px-2 py-1 text-xs" title="Clear">
          <Trash2 size={13} />
        </button>
        <span className="shrink-0 text-[11px] text-slate-600">{shown.length} lines</span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-black/40 p-3 font-mono text-xs leading-relaxed">
        {shown.length === 0 ? (
          <div className="py-10 text-center text-slate-600">{running ? 'waiting for stream…' : 'Press Start.'}</div>
        ) : (
          shown.map((l, i) => (
            <div key={i} className={`whitespace-pre-wrap ${lineColor(l)}`}>
              {l || ' '}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
