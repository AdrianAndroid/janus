import { useEffect, useState, useCallback } from 'react'
import { Database, Play, RefreshCw, Table2, Loader2, AlertCircle, KeyRound, Sparkles } from 'lucide-react'
import { useStore } from '../store'
import type { Tab } from '../store'
import type { DbConnection, DbQueryResult } from '@shared/types'

export default function DbTab({ tab }: { tab: Tab }): JSX.Element {
  const { vault, setTabStatus } = useStore()
  const conn = (vault?.databases ?? []).find((d) => d.id === tab.serverId)
  const [sql, setSql] = useState(conn?.type === 'redis' ? 'INFO server' : 'select 1')
  const [result, setResult] = useState<DbQueryResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [tables, setTables] = useState<string[]>([])
  const [loadingTables, setLoadingTables] = useState(true)
  const [aiQ, setAiQ] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const aiCfg = vault?.settings.ai
  const aiOn = !!aiCfg && (aiCfg.provider === 'custom' || !!aiCfg.apiKey)

  async function askAi(): Promise<void> {
    if (!conn || !aiQ.trim()) return
    setAiBusy(true)
    setError(null)
    try {
      const system =
        conn.type === 'redis'
          ? "Convert the user's natural-language request into a SINGLE Redis command. Return ONLY the command; no explanation, markdown, or backticks."
          : `Convert the user's natural-language request into a SINGLE ${conn.type} query. Return ONLY the query; no explanation, markdown, or backticks. Available tables: ${tables.join(', ') || '(unknown)'}.`
      const reply = await window.janus.ai.chat([{ role: 'user', content: aiQ }], system)
      const out = reply.text.trim().replace(/^```\w*\n?/, '').replace(/\n?```$/, '').trim()
      setSql(out)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setAiBusy(false)
    }
  }

  const loadTables = useCallback(async () => {
    if (!conn) return
    setLoadingTables(true)
    try {
      const t = await window.janus.db.tables(conn)
      setTables(t)
      setTabStatus(tab.id, 'connected')
    } catch (e) {
      setError((e as Error).message)
      setTabStatus(tab.id, 'error')
    } finally {
      setLoadingTables(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id])

  useEffect(() => {
    loadTables()
    return () => {
      if (conn) window.janus.db.close(conn.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const run = useCallback(
    async (q?: string) => {
      if (!conn) return
      const query = q ?? sql
      if (!query.trim()) return
      setRunning(true)
      setError(null)
      try {
        setResult(await window.janus.db.query(conn, query))
        setTabStatus(tab.id, 'connected')
      } catch (e) {
        setError((e as Error).message)
        setResult(null)
      } finally {
        setRunning(false)
      }
    },
    [conn, sql, tab.id, setTabStatus]
  )

  function pickTable(t: string): void {
    let q: string
    if (conn?.type === 'redis') q = `TYPE ${t}`
    else if (conn?.type === 'mysql') q = `SELECT * FROM \`${t}\` LIMIT 100`
    else q = `SELECT * FROM "${t}" LIMIT 100`
    setSql(q)
    run(q)
  }

  if (!conn) return <div className="flex h-full items-center justify-center text-slate-500">Connection not found.</div>

  return (
    <div className="flex h-full bg-ink-900">
      {/* Tables / keys */}
      <div className="flex w-56 shrink-0 flex-col border-r border-ink-600">
        <div className="flex items-center justify-between border-b border-ink-600 px-3 py-2">
          <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
            {conn.type === 'redis' ? <KeyRound size={12} /> : <Table2 size={12} />}
            {conn.type === 'redis' ? 'Keys' : 'Tables'}
          </span>
          <button onClick={loadTables} className="rounded p-1 text-slate-400 hover:bg-ink-600" title="Refresh">
            <RefreshCw size={12} className={loadingTables ? 'animate-spin' : ''} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1">
          {tables.map((t) => (
            <button
              key={t}
              onClick={() => pickTable(t)}
              className="flex w-full items-center gap-2 truncate rounded px-2 py-1 text-left text-[13px] text-slate-300 hover:bg-ink-700"
            >
              {conn.type === 'redis' ? <KeyRound size={12} className="shrink-0 text-slate-600" /> : <Table2 size={12} className="shrink-0 text-slate-600" />}
              <span className="truncate">{t}</span>
            </button>
          ))}
          {!loadingTables && tables.length === 0 && <div className="px-2 py-6 text-center text-xs text-slate-600">Empty</div>}
        </div>
      </div>

      {/* Editor + results */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="border-b border-ink-600 p-3">
          <div className="mb-2 flex items-center gap-2 text-xs text-slate-500">
            <Database size={13} className="text-accent" /> {conn.name} · {conn.host}:{conn.port}
          </div>
          {aiOn && (
            <div className="mb-2 flex items-center gap-2">
              <Sparkles size={14} className="shrink-0 text-accent" />
              <input
                value={aiQ}
                onChange={(e) => setAiQ(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && askAi()}
                placeholder="Ask in plain English → generate query (e.g. top 10 customers by orders in the last 7 days)"
                className="field flex-1 py-1.5 text-xs"
              />
              <button onClick={askAi} disabled={aiBusy || !aiQ.trim()} className="btn-ghost shrink-0 border border-ink-500 py-1.5 text-xs">
                {aiBusy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Generate
              </button>
            </div>
          )}
          <textarea
            value={sql}
            onChange={(e) => setSql(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault()
                run()
              }
            }}
            spellCheck={false}
            className="field h-24 resize-none font-mono text-[13px] leading-relaxed"
            placeholder={conn.type === 'redis' ? 'Redis command (e.g. GET key)' : 'SQL query…  (⌘/Ctrl+Enter to run)'}
          />
          <div className="mt-2 flex items-center gap-3">
            <button onClick={() => run()} disabled={running} className="btn-primary">
              {running ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />} Run
            </button>
            <span className="text-xs text-slate-600">⌘/Ctrl + Enter</span>
            {result && (
              <span className="ml-auto text-xs text-slate-500">
                {result.rowCount} rows · {result.durationMs} ms
              </span>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {error && (
            <div className="m-3 flex items-start gap-2 rounded-md bg-bad/10 px-3 py-2 text-xs text-bad">
              <AlertCircle size={14} className="mt-0.5 shrink-0" /> <span className="whitespace-pre-wrap font-mono">{error}</span>
            </div>
          )}
          {result && !error && (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-ink-800 text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-slate-600">#</th>
                  {result.columns.map((c) => (
                    <th key={c} className="px-3 py-2 text-left font-medium">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="font-mono">
                {result.rows.map((row, i) => (
                  <tr key={i} className="border-b border-ink-700/50 hover:bg-ink-800">
                    <td className="px-3 py-1.5 text-slate-600">{i + 1}</td>
                    {result.columns.map((c) => {
                      const v = row[c]
                      return (
                        <td key={c} className="max-w-xs truncate px-3 py-1.5 text-slate-300" title={fmt(v)}>
                          {v === null || v === undefined ? <span className="text-slate-600">NULL</span> : fmt(v)}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {result && result.rows.length === 0 && !error && (
            <div className="py-10 text-center text-sm text-slate-500">Query ran — no result rows.</div>
          )}
        </div>
      </div>
    </div>
  )
}

function fmt(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}
