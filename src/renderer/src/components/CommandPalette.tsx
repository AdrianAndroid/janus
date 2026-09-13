import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Search,
  Terminal as TerminalIcon,
  FolderTree,
  Plus,
  FolderPlus,
  Code2,
  Network,
  Settings,
  Lock,
  CornerDownLeft,
  Star
} from 'lucide-react'
import { useStore } from '../store'

interface Cmd {
  id: string
  label: string
  hint?: string
  icon: typeof Search
  keywords: string
  run: () => void
}

export default function CommandPalette(): JSX.Element | null {
  const s = useStore()
  const { paletteOpen, setPalette } = s
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const commands = useMemo<Cmd[]>(() => {
    const servers = s.vault?.servers ?? []
    const list: Cmd[] = []

    servers.forEach((srv) => {
      list.push({
        id: `term-${srv.id}`,
        label: srv.name,
        hint: `${srv.username}@${srv.host} · Terminal`,
        icon: TerminalIcon,
        keywords: `${srv.name} ${srv.host} ${srv.username} ${srv.tags.join(' ')} terminal connect`,
        run: () => s.openTerminal(srv.id)
      })
      list.push({
        id: `sftp-${srv.id}`,
        label: `${srv.name} — Files`,
        hint: `${srv.username}@${srv.host} · File transfer`,
        icon: FolderTree,
        keywords: `${srv.name} ${srv.host} sftp file files transfer upload download`,
        run: () => s.openSftp(srv.id)
      })
    })

    list.push(
      { id: 'new-server', label: 'Add new server', icon: Plus, keywords: 'new server add', run: () => s.openServerForm() },
      { id: 'new-group', label: 'Create new group', icon: FolderPlus, keywords: 'new group folder', run: () => s.openGroupForm() },
      { id: 'go-snippets', label: 'Snippet library', icon: Code2, keywords: 'snippet command', run: () => s.setSidePanel('snippets') },
      { id: 'go-tunnels', label: 'Port forwarding / tunnels', icon: Network, keywords: 'tunnel port forward socks', run: () => s.setSidePanel('tunnels') },
      { id: 'go-settings', label: 'Settings', icon: Settings, keywords: 'settings theme font', run: () => s.setSidePanel('settings') },
      { id: 'go-favorites', label: 'Open Favorites', icon: Star, keywords: 'favorites star bookmark folders recent', run: () => s.openFavorites() },
      { id: 'lock', label: 'Lock vault', icon: Lock, keywords: 'lock quit', run: () => s.lock() }
    )
    return list
  }, [s])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return commands.slice(0, 50)
    return commands
      .filter((c) => `${c.label} ${c.keywords}`.toLowerCase().includes(q))
      .slice(0, 50)
  }, [commands, query])

  useEffect(() => {
    if (paletteOpen) {
      setQuery('')
      setActive(0)
      setTimeout(() => inputRef.current?.focus(), 20)
    }
  }, [paletteOpen])

  useEffect(() => setActive(0), [query])

  if (!paletteOpen) return null

  function choose(cmd?: Cmd): void {
    if (!cmd) return
    cmd.run()
    setPalette(false)
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/40 pt-[12vh] backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && setPalette(false)}
    >
      <div className="w-[560px] overflow-hidden rounded-xl border border-ink-500 bg-ink-800 shadow-[0_24px_64px_-12px_rgba(0,0,0,0.7)]">
        <div className="flex items-center gap-3 border-b border-ink-600 px-4">
          <Search size={17} className="text-slate-500" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setActive((a) => Math.min(a + 1, filtered.length - 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setActive((a) => Math.max(a - 1, 0))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                choose(filtered[active])
              } else if (e.key === 'Escape') {
                setPalette(false)
              }
            }}
            placeholder="Search servers or run a command…"
            className="flex-1 bg-transparent py-3.5 text-[15px] text-slate-100 outline-none placeholder:text-slate-600"
          />
          <kbd className="rounded border border-ink-500 bg-ink-700 px-1.5 py-0.5 text-[10px] text-slate-500">ESC</kbd>
        </div>

        <div className="max-h-[52vh] overflow-y-auto p-2">
          {filtered.length === 0 && <div className="px-3 py-8 text-center text-sm text-slate-600">No results.</div>}
          {filtered.map((c, i) => {
            const Icon = c.icon
            return (
              <button
                key={c.id}
                onMouseMove={() => setActive(i)}
                onClick={() => choose(c)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left ${
                  i === active ? 'bg-accent/15 text-white' : 'text-slate-300'
                }`}
              >
                <Icon size={16} className={i === active ? 'text-accent' : 'text-slate-500'} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{c.label}</div>
                  {c.hint && <div className="truncate text-xs text-slate-600">{c.hint}</div>}
                </div>
                {i === active && <CornerDownLeft size={14} className="text-slate-500" />}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
