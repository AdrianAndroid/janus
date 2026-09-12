import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, Copy, ExternalLink, Loader2, Trash2 } from 'lucide-react'
import { useDiskStore } from './store'
import DiskToolbar from './DiskToolbar'
import DiskTreemap from './DiskTreemap'
import DiskDirectoryList from './DiskDirectoryList'
import DiskDeleteDialog from './DiskDeleteDialog'
import DiskWarnings from './DiskWarnings'
import BrowseDialog from './BrowseDialog'
import type { DiskNode } from '@shared/disk-usage'

export function fmtBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return '—'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KiB', 'MiB', 'GiB', 'TiB']
  let v = bytes
  let u = -1
  do {
    v /= 1024
    u += 1
  } while (v >= 1024 && u < units.length - 1)
  return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[u]}`
}

export function fullPath(rootPath: string, node: DiskNode): string {
  if (!node.relativePath) return rootPath
  return `${rootPath.replace(/\/+$/, '')}/${node.relativePath}`
}

export default function DiskUsageApp(): JSX.Element {
  const s = useDiskStore()
  const [split, setSplit] = useState(() => {
    const saved = Number(localStorage.getItem('diskUsage.split'))
    return saved >= 25 && saved <= 75 ? saved : 60
  })
  const dragRef = useRef(false)
  const unsubRef = useRef<(() => void) | null>(null)

  const scanning = !!s.snapshot && ['starting', 'scanning', 'canceling'].includes(s.snapshot.state)
  const scanId = s.snapshot?.scanId

  const loadDirectory = useCallback(
    async (nodeId: string, offset = 0) => {
      const st = useDiskStore.getState()
      if (!st.snapshot) return
      st.setViewLoading(true)
      try {
        const view = await window.diskUsage.directory({
          scanId: st.snapshot.scanId,
          nodeId,
          offset,
          limit: st.limit,
          sortBy: st.sortBy,
          order: st.order,
          nameFilter: st.nameFilter || undefined
        })
        const cur = useDiskStore.getState()
        cur.setView(view)
        cur.setError(null)
        if (cur.viewNodeId !== nodeId) cur.setViewNodeId(nodeId)
        else cur.setQuery({ offset })
      } catch (e) {
        useDiskStore.getState().setError((e as Error).message)
      } finally {
        useDiskStore.getState().setViewLoading(false)
      }
    },
    []
  )

  // Boot: context → subscribe → recover existing scan (reload-safe).
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const ctx = await window.diskUsage.getContext()
        if (!alive || !ctx) return
        s.setContext(ctx)
        if (ctx.theme) document.documentElement.dataset.theme = ctx.theme
        const snap = await window.diskUsage.snapshot({})
        if (alive && snap) {
          useDiskStore.getState().setSnapshot(snap)
          useDiskStore.getState().setEventSeq(snap.eventSeq)
          if (snap.rootNodeId) void loadDirectory(snap.rootNodeId)
        }
      } catch (e) {
        useDiskStore.getState().setError((e as Error).message)
      }
    })()
    unsubRef.current = window.diskUsage.onEvent((e) => {
      useDiskStore.getState().applyEvent(e)
      const st = useDiskStore.getState()
      if (e.type === 'state' && st.snapshot && ['completed', 'canceled', 'failed', 'limited'].includes(e.payload.state ?? '')) {
        if (st.viewNodeId) void loadDirectory(st.viewNodeId, st.offset)
        else if (st.snapshot.rootNodeId) void loadDirectory(st.snapshot.rootNodeId)
      }
      if (e.type === 'delete-progress' && e.payload.finished && st.deleteOp) {
        void window.diskUsage
          .deleteSnapshot({ operationId: st.deleteOp.operationId })
          .then((op) => useDiskStore.getState().setDeleteOp(op))
          .catch(() => undefined)
      }
    })
    return () => {
      alive = false
      unsubRef.current?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function startAnalysis(): Promise<void> {
    const st = useDiskStore.getState()
    st.setError(null)
    st.setDeletePlan(null)
    st.setDeleteOp(null)
    try {
      const snap = await window.diskUsage.start({ rootPath: st.draftRootPath.trim() })
      const cur = useDiskStore.getState()
      cur.setSnapshot(snap)
      cur.setView(null)
      cur.setViewNodeId(null)
      if (snap.rootNodeId) await loadDirectory(snap.rootNodeId)
    } catch (e) {
      useDiskStore.getState().setError((e as Error).message)
    }
  }

  async function stopAnalysis(): Promise<void> {
    if (!scanId) return
    try {
      await window.diskUsage.cancel({ scanId })
    } catch (e) {
      useDiskStore.getState().setError((e as Error).message)
    }
  }

  function applyPathRequest(): void {
    if (!s.pathRequest) return
    s.setDraftRootPath(s.pathRequest)
    s.setPathRequest(null)
  }

  function refreshQuery(): void {
    if (s.viewNodeId) void loadDirectory(s.viewNodeId, 0)
  }

  const selectedNodes = (s.view?.entries ?? []).filter((e) => s.selection.has(e.id))
  const selectedBytes = selectedNodes.reduce((n, e) => n + e.knownBytes, 0)
  const canDelete =
    s.snapshot?.state === 'completed' && !s.snapshot.stale && !s.deleteRunning && s.selection.size > 0

  async function copyPaths(): Promise<void> {
    if (!s.snapshot || !s.view) return
    const lines = selectedNodes.map((n) => fullPath(s.scanRootPath, n)).join('\n')
    await navigator.clipboard.writeText(lines)
  }

  async function openInFiles(): Promise<void> {
    if (!s.snapshot || s.selection.size !== 1) return
    const nodeId = [...s.selection][0]
    try {
      await window.diskUsage.openInFiles({ scanId: s.snapshot.scanId, nodeId })
    } catch (e) {
      s.setError((e as Error).message)
    }
  }

  async function prepareDelete(): Promise<void> {
    if (!s.snapshot) return
    s.setError(null)
    try {
      const plan = await window.diskUsage.prepareDelete({
        scanId: s.snapshot.scanId,
        revision: s.snapshot.revision,
        nodeIds: [...s.selection]
      })
      s.setDeletePlan(plan)
    } catch (e) {
      s.setError((e as Error).message)
    }
  }

  function onDividerDown(): void {
    dragRef.current = true
    const move = (e: MouseEvent): void => {
      if (!dragRef.current) return
      const pct = Math.round((e.clientX / window.innerWidth) * 100)
      const clamped = Math.min(75, Math.max(25, pct))
      setSplit(clamped)
      localStorage.setItem('diskUsage.split', String(clamped))
    }
    const up = (): void => {
      dragRef.current = false
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  return (
    <div className="flex h-screen flex-col bg-ink-900 text-slate-200">
      {/* Title bar */}
      <div className="flex shrink-0 items-center justify-between border-b border-ink-600 bg-ink-800 px-4 py-2">
        <h1 className="text-sm font-semibold text-white">{s.context?.title ?? 'Disk Usage'}</h1>
        <span className="text-xs text-slate-500">{s.context?.subtitle}</span>
      </div>

      <DiskToolbar
        scanning={scanning}
        onStart={startAnalysis}
        onStop={stopAnalysis}
        onBrowse={() => s.setBrowseOpen(true)}
      />

      {s.snapshot?.stale && (
        <div className="flex shrink-0 items-center border-b border-ink-700 bg-warn/10 px-4 py-1.5 text-xs text-warn">
          Results are outdated. Click Start Analysis to refresh.
        </div>
      )}

      {s.pathRequest && (
        <div className="flex shrink-0 items-center gap-2 border-b border-ink-700 bg-accent/10 px-4 py-1.5 text-xs">
          <span className="truncate text-slate-300">New path requested: {s.pathRequest}</span>
          <button onClick={applyPathRequest} disabled={scanning || s.deleteRunning} className="text-accent hover:underline disabled:opacity-40">
            Use this path
          </button>
          <button onClick={() => s.setPathRequest(null)} className="text-slate-500 hover:underline">
            Dismiss
          </button>
        </div>
      )}

      {s.error && (
        <div className="flex shrink-0 items-center gap-2 bg-bad/10 px-4 py-2 text-xs text-bad">
          <AlertCircle size={14} /> <span className="truncate">{s.error}</span>
        </div>
      )}

      {/* Breadcrumbs */}
      {s.view && (
        <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-ink-700 px-4 py-1.5 font-mono text-xs text-slate-400">
          {s.view.breadcrumbs.map((b, i) => (
            <span key={b.id} className="flex items-center gap-1">
              {i > 0 && <span className="text-slate-600">/</span>}
              <button onClick={() => void loadDirectory(b.id)} className="hover:text-accent">
                {b.name || '/'}
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Split: treemap | list */}
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 overflow-hidden" style={{ width: `${split}%` }}>
          {s.view ? (
            <DiskTreemap
              items={s.view.treemap}
              scanning={scanning}
              onSelect={(id) => {
                if (id.startsWith('__other__')) return
                const next = new Set(s.selection)
                if (next.has(id)) next.delete(id)
                else next.add(id)
                s.setSelection(next)
              }}
              onDrill={(id) => void loadDirectory(id)}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-slate-600">
              {scanning ? 'Waiting for results…' : 'Enter a path and click Start Analysis'}
            </div>
          )}
        </div>
        <div onMouseDown={onDividerDown} className="w-1 shrink-0 cursor-col-resize bg-ink-600 hover:bg-accent/60" />
        <div className="min-w-[340px] flex-1 overflow-hidden">
          <DiskDirectoryList
            onRefresh={refreshQuery}
            onOpen={(node) => void loadDirectory(node.id)}
            onPage={(offset) => s.viewNodeId && void loadDirectory(s.viewNodeId, offset)}
          />
        </div>
      </div>

      {/* Bottom action bar */}
      {s.snapshot && s.view && (
        <div className="flex shrink-0 items-center gap-3 border-t border-ink-600 bg-ink-800 px-4 py-2 text-xs">
          <span className="text-slate-400">
            {s.selection.size} selected · {fmtBytes(selectedBytes)}
          </span>
          <div className="flex-1" />
          <button onClick={copyPaths} disabled={s.selection.size === 0} className="btn-ghost border border-ink-500 disabled:opacity-40">
            <Copy size={13} /> Copy Paths
          </button>
          <button
            onClick={openInFiles}
            disabled={s.selection.size !== 1}
            className="btn-ghost border border-ink-500 disabled:opacity-40"
          >
            <ExternalLink size={13} /> Open in Files
          </button>
          <button
            onClick={prepareDelete}
            disabled={!canDelete}
            className="btn-ghost border border-bad/60 text-bad disabled:opacity-40"
            title={s.snapshot.state !== 'completed' ? 'Delete requires a completed scan' : s.snapshot.stale ? 'Results are outdated' : ''}
          >
            <Trash2 size={13} /> {s.snapshot.target.kind === 'local' ? 'Move to Trash…' : 'Delete Permanently…'}
          </button>
        </div>
      )}

      {s.browseOpen && <BrowseDialog onClose={() => s.setBrowseOpen(false)} />}
      {s.warningsOpen && s.snapshot && <DiskWarnings scanId={s.snapshot.scanId} onClose={() => s.setWarningsOpen(false)} />}
      {s.deletePlan && <DiskDeleteDialog />}
    </div>
  )
}
