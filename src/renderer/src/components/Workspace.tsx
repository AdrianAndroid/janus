import { useState } from 'react'
import { Terminal as TerminalIcon, FolderTree, Box, ScrollText, Database, X, XCircle, ListX, Star } from 'lucide-react'
import { useStore } from '../store'
import SplitTerminal from './SplitTerminal'
import FilesPanel from './FilesPanel'
import DockerPanel from './DockerPanel'
import LogsPanel from './LogsPanel'
import DbTab from './DbTab'
import SnippetsPanel from './SnippetsPanel'
import TunnelsPanel from './TunnelsPanel'
import SettingsPanel from './SettingsPanel'
import FleetDashboard from './FleetDashboard'
import BroadcastPanel from './BroadcastPanel'
import DatabasesPanel from './DatabasesPanel'
import FavoritesPanel from './FavoritesPanel'
import ServerDetail from './ServerDetail'
import type { Tab } from '../store'

const TAB_ICON = { terminal: TerminalIcon, sftp: FolderTree, docker: Box, logs: ScrollText, db: Database, favorites: Star } as const

function statusColor(status: Tab['status']): string {
  switch (status) {
    case 'connected':
      return 'bg-good'
    case 'connecting':
      return 'bg-warn animate-pulse'
    case 'error':
      return 'bg-bad'
    default:
      return 'bg-slate-600'
  }
}

export default function Workspace(): JSX.Element {
  const { tabs, activeTabId, setActiveTab, closeTab, closeOtherTabs, closeAllTabs, reorderTab, sidePanel, miniMode, openFavorites } =
    useStore()
  const [menu, setMenu] = useState<{ x: number; y: number; tabId: string } | null>(null)

  // Non-server panels take over the whole workspace (not in mini mode).
  if (!miniMode) {
    if (sidePanel === 'dashboard') return <FleetDashboard />
    if (sidePanel === 'broadcast') return <BroadcastPanel />
    if (sidePanel === 'databases') return <DatabasesPanel />
    if (sidePanel === 'snippets') return <SnippetsPanel />
    if (sidePanel === 'tunnels') return <TunnelsPanel />
    if (sidePanel === 'settings') return <SettingsPanel />
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-ink-900">
      {/* Tab bar (hidden in mini mode; always rendered so Favorites stays reachable) */}
      {!miniMode && (
        <div className="flex h-10 shrink-0 items-stretch overflow-x-auto border-b border-ink-600 bg-ink-800">
          {tabs.map((tab) => {
            const active = tab.id === activeTabId
            const Icon = TAB_ICON[tab.kind]
            return (
              <div
                key={tab.id}
                draggable
                onDragStart={(e) => e.dataTransfer.setData('application/janus-tab', tab.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  const from = e.dataTransfer.getData('application/janus-tab')
                  if (from) reorderTab(from, tab.id)
                }}
                onClick={() => setActiveTab(tab.id)}
                onAuxClick={(e) => {
                  if (e.button === 1) {
                    e.preventDefault()
                    closeTab(tab.id)
                  }
                }}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setMenu({ x: Math.min(e.clientX, window.innerWidth - 190), y: e.clientY, tabId: tab.id })
                }}
                className={`group flex max-w-[220px] shrink-0 cursor-pointer items-center gap-2 border-r border-ink-600 px-3 text-sm ${
                  active ? 'bg-ink-900 text-white' : 'text-slate-400 hover:bg-ink-700'
                }`}
              >
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusColor(tab.status)}`} />
                <Icon size={13} className="shrink-0" />
                <span className="truncate">{tab.title}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    closeTab(tab.id)
                  }}
                  className="shrink-0 rounded p-0.5 text-slate-500 opacity-0 hover:bg-ink-500 hover:text-white group-hover:opacity-100"
                >
                  <X size={13} />
                </button>
              </div>
            )
          })}
          {/* Favorites entry — always visible at the end of the tab bar */}
          <button
            onClick={openFavorites}
            className="ml-auto flex shrink-0 items-center gap-1.5 border-l border-ink-600 px-3 text-xs text-slate-400 hover:bg-ink-700 hover:text-warn"
            title="Open favorites"
          >
            <Star size={13} />
          </button>
        </div>
      )}

      {menu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null) }} />
          <div className="fixed z-50 w-48 rounded-lg border border-ink-500 bg-ink-700 py-1 text-xs shadow-2xl" style={{ left: menu.x, top: menu.y }}>
            <button onClick={() => { closeTab(menu.tabId); setMenu(null) }} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-slate-200 hover:bg-ink-500">
              <X size={13} /> Close
            </button>
            <button onClick={() => { closeOtherTabs(menu.tabId); setMenu(null) }} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-slate-200 hover:bg-ink-500">
              <XCircle size={13} /> Close others
            </button>
            <div className="my-1 border-t border-ink-500" />
            <button onClick={() => { closeAllTabs(); setMenu(null) }} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-bad hover:bg-ink-500">
              <ListX size={13} /> Close all
            </button>
          </div>
        </>
      )}

      {/* Content */}
      <div className="relative min-h-0 flex-1">
        {tabs.length === 0 ? (
          <ServerDetail />
        ) : (
          tabs.map((tab) => (
            <div key={tab.id} className="absolute inset-0" style={{ display: tab.id === activeTabId ? 'block' : 'none' }}>
              {tab.kind === 'terminal' ? (
                <SplitTerminal tab={tab} />
              ) : tab.kind === 'sftp' ? (
                <FilesPanel tab={tab} />
              ) : tab.kind === 'docker' ? (
                <DockerPanel tab={tab} />
              ) : tab.kind === 'logs' ? (
                <LogsPanel tab={tab} />
              ) : tab.kind === 'favorites' ? (
                <FavoritesPanel />
              ) : (
                <DbTab tab={tab} />
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
