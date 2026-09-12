import { useState } from 'react'
import { Radio, Play, Loader2, CheckCircle2, XCircle, Square, CheckSquare } from 'lucide-react'
import { useStore } from '../store'

interface Result {
  status: 'running' | 'done' | 'error'
  stdout?: string
  stderr?: string
  code?: number
  ms?: number
  error?: string
}

export default function BroadcastPanel(): JSX.Element {
  const { vault, notify } = useStore()
  const servers = vault?.servers ?? []
  const groups = vault?.groups ?? []
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [command, setCommand] = useState('')
  const [results, setResults] = useState<Record<string, Result>>({})
  const [running, setRunning] = useState(false)

  const toggle = (id: string): void =>
    setSelected((s) => {
      const n = new Set(s)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })

  const allSelected = selected.size === servers.length && servers.length > 0
  const toggleAll = (): void => setSelected(allSelected ? new Set() : new Set(servers.map((s) => s.id)))
  const selectGroup = (gid: string | null): void =>
    setSelected((s) => {
      const n = new Set(s)
      servers.filter((x) => x.groupId === gid).forEach((x) => n.add(x.id))
      return n
    })

  async function run(): Promise<void> {
    if (!command.trim() || selected.size === 0) return
    setRunning(true)
    const ids = [...selected]
    setResults(Object.fromEntries(ids.map((id) => [id, { status: 'running' } as Result])))
    await Promise.all(
      ids.map(async (id) => {
        const t0 = Date.now()
        try {
          const r = await window.janus.ssh.exec(id, command)
          setResults((prev) => ({
            ...prev,
            [id]: { status: 'done', stdout: r.stdout, stderr: r.stderr, code: r.code, ms: Date.now() - t0 }
          }))
        } catch (e) {
          setResults((prev) => ({ ...prev, [id]: { status: 'error', error: (e as Error).message, ms: Date.now() - t0 } }))
        }
      })
    )
    setRunning(false)
    notify('Broadcast complete', `Ran "${command}" on ${ids.length} servers.`)
  }

  return (
    <div className="flex h-full bg-ink-900">
      {/* Server selector */}
      <div className="flex w-64 shrink-0 flex-col border-r border-ink-600">
        <div className="flex items-center justify-between border-b border-ink-600 px-3 py-2.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Target servers</span>
          <button onClick={toggleAll} className="text-xs text-accent hover:underline">
            {allSelected ? 'None' : 'All'}
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {groups.map((g) => (
            <div key={g.id} className="mb-1">
              <button
                onClick={() => selectGroup(g.id)}
                className="w-full px-1.5 py-1 text-left text-[11px] font-medium uppercase tracking-wide text-slate-500 hover:text-accent"
              >
                {g.name}
              </button>
              {servers
                .filter((s) => s.groupId === g.id)
                .map((s) => (
                  <ServerCheck key={s.id} name={s.name} host={s.host} checked={selected.has(s.id)} onToggle={() => toggle(s.id)} />
                ))}
            </div>
          ))}
          {servers
            .filter((s) => !s.groupId || !groups.some((g) => g.id === s.groupId))
            .map((s) => (
              <ServerCheck key={s.id} name={s.name} host={s.host} checked={selected.has(s.id)} onToggle={() => toggle(s.id)} />
            ))}
        </div>
        <div className="border-t border-ink-600 px-3 py-2 text-[11px] text-slate-500">{selected.size} selected</div>
      </div>

      {/* Command + results */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="border-b border-ink-600 p-4">
          <h1 className="mb-3 flex items-center gap-2 text-lg font-bold text-white">
            <Radio size={20} className="text-accent" /> Broadcast — run on multiple servers
          </h1>
          <div className="flex gap-2">
            <input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && run()}
              placeholder="e.g. uptime && df -h /"
              className="field flex-1 font-mono"
            />
            <button onClick={run} disabled={running || !command.trim() || selected.size === 0} className="btn-primary shrink-0">
              {running ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
              Run on {selected.size} servers
            </button>
          </div>
          <p className="mt-2 text-[11px] text-slate-600">
            ⚠️ The command runs on all selected servers at the same time. Be careful with destructive commands.
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {Object.keys(results).length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center text-slate-500">
              <Radio size={44} className="mb-3 opacity-40" />
              <p>Select servers on the left, type a command, and run it. Outputs appear here side by side.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 2xl:grid-cols-2">
              {[...selected].map((id) => {
                const srv = servers.find((s) => s.id === id)
                const r = results[id]
                if (!srv || !r) return null
                return <ResultCard key={id} name={srv.name} r={r} />
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ServerCheck({
  name,
  host,
  checked,
  onToggle
}: {
  name: string
  host: string
  checked: boolean
  onToggle: () => void
}): JSX.Element {
  return (
    <button onClick={onToggle} className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-sm hover:bg-ink-700">
      {checked ? <CheckSquare size={15} className="shrink-0 text-accent" /> : <Square size={15} className="shrink-0 text-slate-600" />}
      <div className="min-w-0 flex-1">
        <div className="truncate text-slate-200">{name}</div>
        <div className="truncate text-[10px] text-slate-500">{host}</div>
      </div>
    </button>
  )
}

function ResultCard({ name, r }: { name: string; r: Result }): JSX.Element {
  const ok = r.status === 'done' && (r.code === 0 || r.code === undefined)
  const out = (r.stdout || '') + (r.stderr ? `\n\x1b[stderr]\n${r.stderr}` : '')
  return (
    <div className="overflow-hidden rounded-lg border border-ink-600 bg-ink-800">
      <div className="flex items-center gap-2 border-b border-ink-600 px-3 py-2">
        {r.status === 'running' ? (
          <Loader2 size={14} className="animate-spin text-warn" />
        ) : ok ? (
          <CheckCircle2 size={14} className="text-good" />
        ) : (
          <XCircle size={14} className="text-bad" />
        )}
        <span className="flex-1 truncate text-sm font-medium text-slate-200">{name}</span>
        {r.status === 'done' && <span className="text-[11px] text-slate-500">exit {r.code} · {r.ms}ms</span>}
      </div>
      <pre className="max-h-60 overflow-auto bg-black/40 p-3 font-mono text-xs text-slate-300">
        {r.status === 'running' ? 'running…' : r.error ? `✖ ${r.error}` : out || '(no output)'}
      </pre>
    </div>
  )
}
