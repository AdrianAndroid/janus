import { useMemo, useState } from 'react'
import { AlertTriangle, ArrowLeft, Clock, Copy, FolderOpen, HardDrive, Loader2, Monitor, Server as ServerIcon, Star, Trash2 } from 'lucide-react'
import { useStore } from '../store'
import FilesPanel from './FilesPanel'
import Modal from './Modal'
import type { Tab } from '../store'
import type { DiskTarget } from '@shared/disk-usage'
import type { FavoriteFolder, RecentFolder } from '../lib/favorites'
import { favoriteDisplayName, folderViewTabId } from '../lib/favorites'

function timeAgo(ts: number): string {
  const m = Math.floor((Date.now() - ts) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

interface FolderView {
  target: DiskTarget
  path: string
  name: string
  tabId: string
}

interface StaleEntry {
  kind: 'favorite' | 'recent'
  target: DiskTarget
  path: string
  name: string
  favoriteId?: string
}

export default function FavoritesPanel(): JSX.Element {
  const { vault, favorites, recentFolders, removeFavorite, removeRecent, clearRecentFolders, selectedServerId } = useStore()
  const [view, setView] = useState<FolderView | null>(null)
  const [stale, setStale] = useState<StaleEntry | null>(null)
  const [checking, setChecking] = useState(false)
  const [checkError, setCheckError] = useState<string | null>(null)

  const serverName = (target: DiskTarget): string | null => {
    if (target.kind === 'local') return null
    return vault?.servers.find((s) => s.id === target.serverId)?.name ?? null
  }
  const serverMissing = (target: DiskTarget): boolean => target.kind === 'ssh' && !serverName(target)

  const sortedFavorites = useMemo(() => [...favorites].sort((a, b) => b.addedAt - a.addedAt), [favorites])

  /** Validate the path still exists before opening; offer removal when stale. */
  async function openFolder(target: DiskTarget, path: string, name: string, favoriteId?: string): Promise<void> {
    if (serverMissing(target)) return
    setChecking(true)
    setCheckError(null)
    try {
      const exists =
        target.kind === 'local'
          ? (await window.janus.localFs.stat(path)) !== null
          : (await window.janus.sftp.stat(target.serverId, path)) !== null
      if (!exists) {
        setStale({ kind: favoriteId ? 'favorite' : 'recent', target, path, name, favoriteId })
        return
      }
      setView({
        target,
        path,
        name,
        tabId: favoriteId
          ? folderViewTabId({ kind: 'favorite', id: favoriteId })
          : folderViewTabId({ kind: 'recent', target, path })
      })
    } catch (e) {
      // Connection/permission failure is NOT a stale path — never offer removal.
      setCheckError((e as Error).message)
    } finally {
      setChecking(false)
    }
  }

  function removeStale(): void {
    if (!stale) return
    if (stale.kind === 'favorite' && stale.favoriteId) removeFavorite(stale.favoriteId)
    else removeRecent(stale.target, stale.path)
    setStale(null)
  }

  if (view) {
    const serverId = view.target.kind === 'ssh' ? view.target.serverId : (selectedServerId ?? '')
    const singleSide = view.target.kind === 'local' ? 'local' : 'remote'
    const pseudoTab: Tab = { id: view.tabId, kind: 'sftp', serverId, title: view.name, status: 'connecting' }
    const canDual = !!serverId
    return (
      <div className="flex h-full flex-col bg-ink-900">
        <div className="flex shrink-0 items-center gap-2 border-b border-ink-600 bg-ink-800 px-3 py-1.5">
          <button onClick={() => setView(null)} className="btn-ghost flex items-center gap-1 px-2 py-1 text-xs">
            <ArrowLeft size={13} /> Favorites
          </button>
          <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate font-mono text-xs text-slate-400" title={view.path}>
            {view.target.kind === 'local' ? <HardDrive size={12} className="shrink-0 text-accent" /> : <ServerIcon size={12} className="shrink-0 text-accent" />}
            {view.path}
          </span>
          {!canDual && <span className="shrink-0 text-[10px] text-slate-600">Dual pane needs a selected server</span>}
        </div>
        <div className="min-h-0 flex-1">
          <FilesPanel
            tab={pseudoTab}
            initialLeftPath={view.target.kind === 'local' ? view.path : undefined}
            initialRightPath={view.target.kind === 'ssh' ? view.path : undefined}
            singleSide={singleSide}
            allowDual={canDual}
            enableCrossWindowNav={false}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto bg-ink-900 p-6">
      <div className="mx-auto max-w-3xl">
        {checking && (
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-ink-600 bg-ink-800 px-3 py-2 text-xs text-slate-400">
            <Loader2 size={13} className="animate-spin text-accent" /> Checking path…
          </div>
        )}
        {checkError && (
          <div className="mb-3 rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-xs text-bad">
            Could not verify the path: {checkError}
          </div>
        )}
        {/* Favorites */}
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-white">
          <Star size={15} className="text-warn" /> Favorite folders
        </div>
        {sortedFavorites.length === 0 ? (
          <div className="mb-6 rounded-lg border border-ink-600 bg-ink-800 px-4 py-6 text-center text-xs text-slate-500">
            No favorites yet. In Files, hover a folder and click the star to add it here.
          </div>
        ) : (
          <div className="mb-6 overflow-hidden rounded-lg border border-ink-600">
            {sortedFavorites.map((f: FavoriteFolder) => (
              <FavRow key={f.id} f={f} deviceName={serverName(f.target)} missing={serverMissing(f.target)} onOpen={() => openFolder(f.target, f.path, favoriteDisplayName(f), f.id)} onRemove={() => removeFavorite(f.id)} />
            ))}
          </div>
        )}

        {/* Recents */}
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-white">
          <Clock size={15} className="text-accent" /> Recent folders
          <span className="text-xs font-normal text-slate-500">({recentFolders.length}/50)</span>
          {recentFolders.length > 0 && (
            <button onClick={clearRecentFolders} className="ml-auto flex items-center gap-1 text-[11px] font-normal text-slate-500 hover:text-bad">
              <Trash2 size={11} /> Clear all
            </button>
          )}
        </div>
        {recentFolders.length === 0 ? (
          <div className="rounded-lg border border-ink-600 bg-ink-800 px-4 py-6 text-center text-xs text-slate-500">
            Folders you open in Files will appear here (up to 50).
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-ink-600">
            {recentFolders.map((r: RecentFolder, i) => (
              <RecentRow key={`${r.target.kind}-${i}`} r={r} deviceName={serverName(r.target)} missing={serverMissing(r.target)} onOpen={() => openFolder(r.target, r.path, favoriteDisplayName({ name: '', path: r.path }))} />
            ))}
          </div>
        )}
      </div>

      {/* Stale path confirmation (secondary modal) */}
      {stale && (
        <Modal
          title="Path no longer exists"
          onClose={() => setStale(null)}
          width={440}
          footer={
            <>
              <button onClick={() => setStale(null)} className="btn-ghost">Keep</button>
              <button onClick={removeStale} className="btn-primary bg-bad hover:bg-bad/90">
                <Trash2 size={14} /> {stale.kind === 'favorite' ? 'Remove favorite' : 'Remove from recents'}
              </button>
            </>
          }
        >
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-warn" />
            <div className="min-w-0 text-sm text-slate-300">
              <p className="font-medium text-white">{stale.name}</p>
              <p className="mt-1 break-all font-mono text-xs text-slate-400">{stale.path}</p>
              <p className="mt-2 text-xs text-slate-500">
                This folder could not be found{stale.target.kind === 'ssh' ? ' on the server' : ' on this Mac'}. Remove it
                from {stale.kind === 'favorite' ? 'your favorites' : 'recent folders'}?
              </p>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

function DeviceTag({ target, deviceName, missing }: { target: DiskTarget; deviceName: string | null; missing: boolean }): JSX.Element {
  if (target.kind === 'local') {
    return (
      <span className="flex shrink-0 items-center gap-1 rounded bg-ink-600 px-1.5 py-0.5 text-[10px] text-slate-400">
        <Monitor size={10} /> This Mac
      </span>
    )
  }
  return (
    <span className={`flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ${missing ? 'bg-bad/15 text-bad' : 'bg-ink-600 text-slate-400'}`}>
      <ServerIcon size={10} /> {missing ? 'server missing' : deviceName}
    </span>
  )
}

function FavRow({ f, deviceName, missing, onOpen, onRemove }: { f: FavoriteFolder; deviceName: string | null; missing: boolean; onOpen: () => void; onRemove: () => void }): JSX.Element {
  return (
    <div className="group flex items-center gap-2 border-b border-ink-700/50 bg-ink-800 px-3 py-2 last:border-0 hover:bg-ink-700">
      <Star size={14} className="shrink-0 text-warn" fill="currentColor" />
      <span className="shrink-0 text-xs font-medium text-slate-200">{favoriteDisplayName(f)}</span>
      <DeviceTag target={f.target} deviceName={deviceName} missing={missing} />
      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-slate-500" title={f.path}>{f.path}</span>
      <button
        onClick={() => navigator.clipboard.writeText(f.path)}
        className="rounded p-1 text-slate-500 opacity-0 hover:bg-ink-500 hover:text-white group-hover:opacity-100"
        title="Copy path"
      >
        <Copy size={12} />
      </button>
      <button
        onClick={onOpen}
        disabled={missing}
        className="flex items-center gap-1 rounded border border-ink-500 px-2 py-0.5 text-[11px] text-slate-300 hover:border-accent/60 hover:text-accent disabled:opacity-40"
      >
        <FolderOpen size={11} /> Open
      </button>
      <button onClick={onRemove} className="rounded p-1 text-slate-500 hover:bg-bad hover:text-white" title="Remove favorite">
        <Trash2 size={12} />
      </button>
    </div>
  )
}

function RecentRow({ r, deviceName, missing, onOpen }: { r: RecentFolder; deviceName: string | null; missing: boolean; onOpen: () => void }): JSX.Element {
  return (
    <button
      onClick={onOpen}
      disabled={missing}
      className="flex w-full items-center gap-2 border-b border-ink-700/50 bg-ink-800 px-3 py-1.5 text-left last:border-0 hover:bg-ink-700 disabled:opacity-50"
    >
      <FolderOpen size={13} className="shrink-0 text-accent" />
      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-slate-300" title={r.path}>{r.path}</span>
      <DeviceTag target={r.target} deviceName={deviceName} missing={missing} />
      <span className="w-16 shrink-0 text-right text-[10px] text-slate-600">{timeAgo(r.openedAt)}</span>
    </button>
  )
}
