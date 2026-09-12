import { useMemo, useState } from 'react'
import {
  Server,
  Code2,
  Network,
  Settings,
  Search,
  Plus,
  FolderPlus,
  ChevronRight,
  ChevronDown,
  Folder,
  Tag,
  Terminal as TerminalIcon,
  FolderTree,
  Copy,
  Pencil,
  Trash2,
  LayoutDashboard,
  Radio,
  Box,
  ScrollText,
  Monitor,
  MonitorPlay,
  Database,
  Sparkles
} from 'lucide-react'
import { useStore } from '../store'
import type { ServerProfile, Group } from '@shared/types'

interface DragItem {
  kind: 'server' | 'group'
  id: string
}
function readDrag(e: React.DragEvent): DragItem | null {
  try {
    const raw = e.dataTransfer.getData('application/janus')
    return raw ? (JSON.parse(raw) as DragItem) : null
  } catch {
    return null
  }
}

const railItems = [
  { key: 'dashboard', icon: LayoutDashboard, label: 'Fleet Dashboard' },
  { key: 'servers', icon: Server, label: 'Servers' },
  { key: 'broadcast', icon: Radio, label: 'Broadcast' },
  { key: 'databases', icon: Database, label: 'Databases' },
  { key: 'copilot', icon: Sparkles, label: 'AI Copilot' },
  { key: 'snippets', icon: Code2, label: 'Snippets' },
  { key: 'tunnels', icon: Network, label: 'Tunnels' },
  { key: 'settings', icon: Settings, label: 'Settings' }
] as const

export default function Sidebar(): JSX.Element {
  const {
    vault,
    sidePanel,
    setSidePanel,
    search,
    setSearch,
    activeTagFilter,
    setTagFilter,
    openServerForm,
    openGroupForm,
    moveServerToGroup,
    moveGroupToParent,
    copilotOpen,
    toggleCopilot
  } = useStore()

  const servers = vault?.servers ?? []
  const groups = vault?.groups ?? []

  const allTags = useMemo(() => {
    const set = new Set<string>()
    servers.forEach((s) => s.tags.forEach((t) => set.add(t)))
    return [...set].sort()
  }, [servers])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return servers.filter((s) => {
      const matchQ =
        !q ||
        s.name.toLowerCase().includes(q) ||
        s.host.toLowerCase().includes(q) ||
        s.username.toLowerCase().includes(q) ||
        s.tags.some((t) => t.toLowerCase().includes(q))
      const matchTag = !activeTagFilter || s.tags.includes(activeTagFilter)
      return matchQ && matchTag
    })
  }, [servers, search, activeTagFilter])

  return (
    <div className="flex min-h-0 shrink-0 border-r border-ink-600">
      {/* Icon rail */}
      <div className="flex w-14 flex-col items-center gap-1 border-r border-ink-600 bg-ink-800 py-3">
        {railItems.map((item) => {
          const Icon = item.icon
          const isCopilot = item.key === 'copilot'
          const active = isCopilot ? copilotOpen : sidePanel === item.key
          return (
            <button
              key={item.key}
              onClick={() => {
                if (item.key === 'copilot') toggleCopilot()
                else setSidePanel(item.key)
              }}
              title={item.label}
              className={`flex h-10 w-10 items-center justify-center rounded-lg transition-colors ${
                active ? 'bg-accent/20 text-accent' : 'text-slate-400 hover:bg-ink-600 hover:text-white'
              }`}
            >
              <Icon size={19} />
            </button>
          )
        })}
      </div>

      {/* Server tree (only on servers panel) */}
      {sidePanel === 'servers' && (
        <div className="flex w-72 flex-col bg-ink-900">
          <div className="flex items-center gap-1 border-b border-ink-600 px-3 py-2.5">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search servers…"
                className="field py-1.5 pl-8 text-xs"
              />
            </div>
            <button onClick={() => openGroupForm()} title="New group" className="btn-ghost px-2 py-1.5">
              <FolderPlus size={16} />
            </button>
            <button onClick={() => openServerForm()} title="New server" className="btn-primary px-2 py-1.5">
              <Plus size={16} />
            </button>
          </div>

          {allTags.length > 0 && (
            <div className="flex flex-wrap gap-1 border-b border-ink-600 px-3 py-2">
              {allTags.map((t) => (
                <button
                  key={t}
                  onClick={() => setTagFilter(activeTagFilter === t ? null : t)}
                  className={`chip ${activeTagFilter === t ? 'border-accent bg-accent/20 text-accent' : ''}`}
                >
                  <Tag size={10} /> {t}
                </button>
              ))}
            </div>
          )}

          <div
            className="min-h-0 flex-1 overflow-y-auto py-1"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              const item = readDrag(e)
              if (item?.kind === 'server') moveServerToGroup(item.id, null)
              else if (item?.kind === 'group') moveGroupToParent(item.id, null)
            }}
          >
            <ServerTree servers={filtered} groups={groups} flat={!!search || !!activeTagFilter} />
            {servers.length === 0 && (
              <div className="px-4 py-10 text-center text-xs text-slate-500">
                No servers yet.
                <br />
                <button onClick={() => openServerForm()} className="mt-2 text-accent hover:underline">
                  Add your first server →
                </button>
              </div>
            )}
          </div>

          <div className="border-t border-ink-600 px-3 py-2 text-[11px] text-slate-500">
            {servers.length} servers · {groups.length} groups
          </div>
        </div>
      )}
    </div>
  )
}

function ServerTree({
  servers,
  groups,
  flat
}: {
  servers: ServerProfile[]
  groups: Group[]
  flat: boolean
}): JSX.Element {
  // When searching/filtering, show a flat list.
  if (flat) {
    return (
      <div className="px-1.5">
        {servers.map((s) => (
          <ServerRow key={s.id} server={s} depth={0} />
        ))}
      </div>
    )
  }

  const rootGroups = groups.filter((g) => g.parentId === null).sort((a, b) => a.order - b.order)
  const rootServers = servers.filter((s) => s.groupId === null)

  return (
    <div className="px-1.5">
      {rootGroups.map((g) => (
        <GroupNode key={g.id} group={g} groups={groups} servers={servers} depth={0} />
      ))}
      {rootServers.map((s) => (
        <ServerRow key={s.id} server={s} depth={0} />
      ))}
    </div>
  )
}

function GroupNode({
  group,
  groups,
  servers,
  depth
}: {
  group: Group
  groups: Group[]
  servers: ServerProfile[]
  depth: number
}): JSX.Element {
  const { toggleGroup, openGroupForm, deleteGroup, openServerForm, moveServerToGroup, moveGroupToParent } = useStore()
  const [over, setOver] = useState(false)
  const children = groups.filter((g) => g.parentId === group.id).sort((a, b) => a.order - b.order)
  const childServers = servers.filter((s) => s.groupId === group.id)
  const count = childServers.length

  function handleDrop(e: React.DragEvent): void {
    e.preventDefault()
    e.stopPropagation()
    setOver(false)
    const item = readDrag(e)
    if (!item) return
    if (item.kind === 'server') moveServerToGroup(item.id, group.id)
    else if (item.kind === 'group') moveGroupToParent(item.id, group.id)
  }

  return (
    <div>
      <div
        draggable
        onDragStart={(e) => {
          e.stopPropagation()
          e.dataTransfer.setData('application/janus', JSON.stringify({ kind: 'group', id: group.id }))
          e.dataTransfer.effectAllowed = 'move'
        }}
        onDragOver={(e) => {
          e.preventDefault()
          e.stopPropagation()
          if (!over) setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={handleDrop}
        className={`group flex cursor-pointer items-center gap-1 rounded px-1.5 py-1 text-sm hover:bg-ink-700 ${
          over ? 'bg-accent/20 ring-1 ring-accent' : ''
        }`}
        style={{ paddingLeft: depth * 12 + 6 }}
        onClick={() => toggleGroup(group.id)}
      >
        {group.collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        <Folder size={14} style={{ color: group.color || '#7aa2ff' }} />
        <span className="flex-1 truncate text-slate-200">{group.name}</span>
        <span className="text-[10px] text-slate-500">{count}</span>
        <div className="hidden items-center gap-0.5 group-hover:flex" onClick={(e) => e.stopPropagation()}>
          <button onClick={() => openServerForm({ groupId: group.id } as never)} className="rounded p-0.5 hover:bg-ink-500" title="Add server to this group">
            <Plus size={12} />
          </button>
          <button onClick={() => openGroupForm(group)} className="rounded p-0.5 hover:bg-ink-500" title="Edit">
            <Pencil size={12} />
          </button>
          <button onClick={() => confirm(`Delete group "${group.name}"?`) && deleteGroup(group.id)} className="rounded p-0.5 hover:bg-bad" title="Delete">
            <Trash2 size={12} />
          </button>
        </div>
      </div>
      {!group.collapsed && (
        <div>
          {children.map((g) => (
            <GroupNode key={g.id} group={g} groups={groups} servers={servers} depth={depth + 1} />
          ))}
          {childServers.map((s) => (
            <ServerRow key={s.id} server={s} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  )
}

function ServerRow({ server, depth }: { server: ServerProfile; depth: number }): JSX.Element {
  const { selectedServerId, selectServer, openTerminal, openSftp, openDocker, openLogs, openVnc, openServerForm, deleteServer, duplicateServer, moveServerToGroup } =
    useStore()
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null)
  const selected = selectedServerId === server.id

  // Open the context menu at the cursor, clamped so it never spills off-screen.
  function openMenu(e: React.MouseEvent): void {
    e.preventDefault()
    const MENU_W = 184
    const MENU_H = 312
    const x = Math.max(8, Math.min(e.clientX, window.innerWidth - MENU_W - 8))
    const y = Math.max(8, Math.min(e.clientY, window.innerHeight - MENU_H - 8))
    setMenuPos({ x, y })
  }
  const closeMenu = (): void => setMenuPos(null)

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/janus', JSON.stringify({ kind: 'server', id: server.id }))
        e.dataTransfer.effectAllowed = 'move'
      }}
      onDragOver={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      onDrop={(e) => {
        e.preventDefault()
        e.stopPropagation()
        const item = readDrag(e)
        if (item?.kind === 'server' && item.id !== server.id) moveServerToGroup(item.id, server.groupId)
      }}
      className={`group relative flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm ${
        selected ? 'bg-accent/15 text-white' : 'text-slate-300 hover:bg-ink-700'
      }`}
      style={{ paddingLeft: depth * 12 + 8 }}
      onClick={() => selectServer(server.id)}
      onDoubleClick={() => openTerminal(server.id)}
      onContextMenu={openMenu}
    >
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: server.color || '#3a465c' }} />
      <div className="min-w-0 flex-1">
        <div className="truncate">{server.name}</div>
        <div className="truncate text-[10px] text-slate-500">
          {server.username}@{server.host}
        </div>
      </div>
      <div className="hidden items-center gap-0.5 group-hover:flex" onClick={(e) => e.stopPropagation()}>
        <button onClick={() => openTerminal(server.id)} className="rounded p-1 text-accent hover:bg-ink-500" title="Connect (terminal)">
          <TerminalIcon size={13} />
        </button>
        <button onClick={() => openSftp(server.id)} className="rounded p-1 hover:bg-ink-500" title="SFTP">
          <FolderTree size={13} />
        </button>
        <button onClick={() => openServerForm(server)} className="rounded p-1 hover:bg-ink-500" title="Edit">
          <Pencil size={13} />
        </button>
      </div>

      {menuPos && (
        <>
          <div className="fixed inset-0 z-40" onClick={closeMenu} onContextMenu={(e) => { e.preventDefault(); closeMenu() }} />
          <div
            className="fixed z-50 w-44 rounded-lg border border-ink-500 bg-ink-700 py-1 text-xs shadow-2xl"
            style={{ left: menuPos.x, top: menuPos.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <MenuItem icon={TerminalIcon} label="Open terminal" onClick={() => { openTerminal(server.id); closeMenu() }} />
            <MenuItem icon={FolderTree} label="Open SFTP" onClick={() => { openSftp(server.id); closeMenu() }} />
            <MenuItem icon={Box} label="Services / Docker" onClick={() => { openDocker(server.id); closeMenu() }} />
            <MenuItem icon={ScrollText} label="Logs (live)" onClick={() => { openLogs(server.id); closeMenu() }} />
            <MenuItem icon={Monitor} label="Remote desktop (VNC)" onClick={() => { openVnc(server.id); closeMenu() }} />
            <MenuItem icon={MonitorPlay} label="Connect via RDP (Windows)" onClick={() => { window.janus.rdp.launch(server.id).catch((e) => alert((e as Error).message)); closeMenu() }} />
            <MenuItem icon={Pencil} label="Edit" onClick={() => { openServerForm(server); closeMenu() }} />
            <MenuItem icon={Copy} label="Duplicate" onClick={() => { duplicateServer(server.id); closeMenu() }} />
            <div className="my-1 border-t border-ink-500" />
            <MenuItem icon={Trash2} label="Delete" danger onClick={() => { if (confirm(`Delete "${server.name}"?`)) deleteServer(server.id); closeMenu() }} />
          </div>
        </>
      )}
    </div>
  )
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  danger
}: {
  icon: typeof Copy
  label: string
  onClick: () => void
  danger?: boolean
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-ink-500 ${danger ? 'text-bad' : 'text-slate-200'}`}
    >
      <Icon size={13} /> {label}
    </button>
  )
}
