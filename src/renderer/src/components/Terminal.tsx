import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { SearchAddon } from '@xterm/addon-search'
import { Search, X, ChevronUp, ChevronDown, RotateCw } from 'lucide-react'
import { useStore } from '../store'
import type { SessionStatus } from '@shared/types'

const THEME = {
  background: '#0a0b0d',
  foreground: '#e4e7ec',
  cursor: '#818cf8',
  cursorAccent: '#0a0b0d',
  selectionBackground: '#2c3340',
  black: '#0b0e14',
  red: '#fb5d6b',
  green: '#34d399',
  yellow: '#fbbf24',
  blue: '#6366f1',
  magenta: '#a78bfa',
  cyan: '#22d3ee',
  white: '#cbd5e1',
  brightBlack: '#475569',
  brightRed: '#fb7185',
  brightGreen: '#4ade80',
  brightYellow: '#fbbf24',
  brightBlue: '#818cf8',
  brightMagenta: '#c4b5fd',
  brightCyan: '#67e8f9',
  brightWhite: '#f1f5f9'
}

export default function TerminalView({
  sessionId,
  serverId,
  onStatus
}: {
  sessionId: string
  serverId: string
  onStatus?: (s: SessionStatus) => void
}): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const searchRef = useRef<SearchAddon | null>(null)
  const { vault } = useStore()
  const settings = vault?.settings
  const [showSearch, setShowSearch] = useState(false)
  const [query, setQuery] = useState('')
  const [dead, setDead] = useState(false)
  const [reconnectNonce, setReconnectNonce] = useState(0)
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!hostRef.current) return
    const term = new Terminal({
      fontFamily: settings?.fontFamily || 'JetBrains Mono, monospace',
      fontSize: settings?.fontSize || 13,
      cursorStyle: settings?.cursorStyle || 'bar',
      cursorBlink: settings?.cursorBlink ?? true,
      scrollback: settings?.scrollback || 10000,
      allowProposedApi: true,
      theme: THEME
    })
    const fit = new FitAddon()
    const search = new SearchAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    term.loadAddon(search)
    term.open(hostRef.current)
    fit.fit()
    termRef.current = term
    fitRef.current = fit
    searchRef.current = search

    // Intercept Cmd/Ctrl+F to open the in-terminal search box.
    term.attachCustomKeyEventHandler((e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f' && e.type === 'keydown') {
        setShowSearch(true)
        setTimeout(() => searchInputRef.current?.focus(), 10)
        return false
      }
      return true
    })

    const server = vault?.servers.find((s) => s.id === serverId)
    const target = server ? `${server.username}@${server.host}:${server.port}` : serverId

    // Immediate feedback so the connecting phase never looks frozen.
    const dim = (s: string): void => term.writeln(`\x1b[38;5;245m${s}\x1b[0m`)
    dim(`╭─ Janus · ${server?.name ?? ''}`)
    dim(`│  Connecting to ${target}…`)
    if (server?.jumpHostId) dim('│  via jump host')
    dim('│  Verifying SSH key/password…')
    const t0 = Date.now()

    const autoReconnect = vault?.settings.autoReconnect ?? true
    let disposed = false
    let attempts = 0
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined

    const doConnect = (): void => {
      window.janus.ssh
        .connect(sessionId, serverId, term.cols, term.rows)
        .catch((e) => term.writeln(`╰─ \x1b[31m✖ ${(e as Error).message}\x1b[0m`))
    }

    const keyDisposable = term.onData((d) => window.janus.ssh.data(sessionId, d))
    const offData = window.janus.ssh.onData(sessionId, (data) => term.write(data))
    const offStatus = window.janus.ssh.onStatus(sessionId, (p) => {
      onStatus?.(p.status as SessionStatus)
      if (p.status === 'connected') {
        attempts = 0
        setDead(false)
        dim(`╰─ \x1b[32m● connected\x1b[38;5;245m (${Date.now() - t0} ms)\x1b[0m\r\n`)
      }
      if (p.status === 'error' && p.message) {
        term.writeln(`╰─ \x1b[31m✖ Connection error: ${p.message}\x1b[0m`)
        setDead(true)
      }
      if (p.status === 'disconnected' && !disposed) {
        if (autoReconnect && attempts < 5) {
          attempts++
          const delay = Math.min(2000 * attempts, 10000)
          term.writeln(`\r\n\x1b[33m⚠ Connection lost. Reconnecting in ${delay / 1000}s… (attempt ${attempts}/5)\x1b[0m`)
          reconnectTimer = setTimeout(doConnect, delay)
        } else {
          setDead(true)
          term.writeln(
            `\r\n\x1b[33m⚠ Connection closed.\x1b[0m${autoReconnect ? ' \x1b[38;5;245m(reconnect limit reached)\x1b[0m' : ''}`
          )
        }
      }
    })

    // After the machine wakes from sleep the TCP socket is dead — refresh it.
    const offResume = window.janus.power.onResume(() => {
      if (disposed) return
      attempts = 0
      clearTimeout(reconnectTimer)
      dim('\r\n↻ Woke from sleep, reconnecting…')
      window.janus.ssh.disconnect(sessionId)
      reconnectTimer = setTimeout(doConnect, 500)
    })
    // Don't burn reconnect attempts while suspended.
    const offSuspend = window.janus.power.onSuspend(() => clearTimeout(reconnectTimer))

    doConnect()

    const resize = (): void => {
      try {
        fit.fit()
        window.janus.ssh.resize(sessionId, term.cols, term.rows)
      } catch {
        /* noop */
      }
    }
    const ro = new ResizeObserver(resize)
    ro.observe(hostRef.current)

    return () => {
      disposed = true
      clearTimeout(reconnectTimer)
      ro.disconnect()
      keyDisposable.dispose()
      offData()
      offStatus()
      offResume()
      offSuspend()
      window.janus.ssh.disconnect(sessionId)
      term.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, reconnectNonce])

  useEffect(() => {
    const t = setTimeout(() => fitRef.current?.fit(), 30)
    return () => clearTimeout(t)
  })

  const SEARCH_OPTS = { decorations: { matchOverviewRuler: '#6366f1', activeMatchColorOverviewRuler: '#818cf8' } }

  return (
    <div className="relative h-full w-full bg-ink-900">
      {showSearch && (
        <div className="absolute right-4 top-3 z-10 flex items-center gap-1 rounded-lg border border-ink-500 bg-ink-800 p-1 shadow-lg">
          <Search size={14} className="ml-1.5 text-slate-500" />
          <input
            ref={searchInputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              searchRef.current?.findNext(e.target.value, SEARCH_OPTS)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') searchRef.current?.findNext(query, SEARCH_OPTS)
              if (e.key === 'Escape') {
                setShowSearch(false)
                termRef.current?.focus()
              }
            }}
            placeholder="Search terminal…"
            className="w-44 bg-transparent px-1 py-1 text-sm text-slate-100 outline-none placeholder:text-slate-600"
          />
          <button onClick={() => searchRef.current?.findPrevious(query, SEARCH_OPTS)} className="rounded p-1 text-slate-400 hover:bg-ink-600">
            <ChevronUp size={14} />
          </button>
          <button onClick={() => searchRef.current?.findNext(query, SEARCH_OPTS)} className="rounded p-1 text-slate-400 hover:bg-ink-600">
            <ChevronDown size={14} />
          </button>
          <button onClick={() => { setShowSearch(false); termRef.current?.focus() }} className="rounded p-1 text-slate-400 hover:bg-ink-600">
            <X size={14} />
          </button>
        </div>
      )}
      {dead && (
        <div className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2">
          <button
            onClick={() => {
              setDead(false)
              setReconnectNonce((n) => n + 1)
            }}
            className="btn-primary shadow-lg"
          >
            <RotateCw size={15} /> Reconnect
          </button>
        </div>
      )}
      <div ref={hostRef} className="xterm-host h-full w-full" />
    </div>
  )
}
