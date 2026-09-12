import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, File, Folder, Link2, Loader2, RefreshCw } from 'lucide-react'
import { useDiskStore } from './store'
import { fmtBytes } from './DiskUsageApp'
import type { DiskNode } from '@shared/disk-usage'

const ROW_H = 28

interface Props {
  onRefresh: () => void
  onOpen: (node: DiskNode) => void
  onPage: (offset: number) => void
}

/** Fixed-row-height virtual list — DOM rows stay constant for huge folders. */
export default function DiskDirectoryList({ onRefresh, onOpen, onPage }: Props): JSX.Element {
  const s = useDiskStore()
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportH, setViewportH] = useState(400)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!boxRef.current) return
    const ro = new ResizeObserver((entries) => setViewportH(entries[0].contentRect.height))
    ro.observe(boxRef.current)
    return () => ro.disconnect()
  }, [])

  const entries = s.view?.entries ?? []
  const total = s.view?.totalMatches ?? 0
  const dirBytes = s.view?.directory.knownBytes ?? 0

  const startIdx = Math.floor(scrollTop / ROW_H)
  const endIdx = Math.min(entries.length, startIdx + Math.ceil(viewportH / ROW_H) + 2)
  const visible = entries.slice(startIdx, endIdx)

  function toggle(node: DiskNode, additive: boolean): void {
    if (!node.selectable) return
    const next = additive ? new Set(s.selection) : new Set<string>()
    if (additive && next.has(node.id)) next.delete(node.id)
    else next.add(node.id)
    s.setSelection(next)
  }

  function selectAllOnPage(): void {
    const next = new Set(s.selection)
    for (const e of entries) if (e.selectable) next.add(e.id)
    s.setSelection(next)
  }

  const pageStart = s.offset + 1
  const pageEnd = s.offset + entries.length

  return (
    <div className="flex h-full flex-col">
      {/* Filter / sort bar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-ink-700 px-3 py-1.5">
        <input
          value={s.nameFilter}
          onChange={(e) => {
            s.setQuery({ nameFilter: e.target.value, offset: 0 })
            onRefresh()
          }}
          placeholder="Search current folder"
          spellCheck={false}
          className="field h-7 flex-1 text-xs"
        />
        {s.nameFilter && <span className="shrink-0 text-[10px] text-warn">List filter active</span>}
        <select
          value={`${s.sortBy}:${s.order}`}
          onChange={(e) => {
            const [sortBy, order] = e.target.value.split(':') as ['size' | 'name' | 'mtime', 'asc' | 'desc']
            s.setQuery({ sortBy, order, offset: 0 })
            onRefresh()
          }}
          className="field h-7 w-28 text-xs"
        >
          <option value="size:desc">Size ↓</option>
          <option value="size:asc">Size ↑</option>
          <option value="name:asc">Name A→Z</option>
          <option value="name:desc">Name Z→A</option>
          <option value="mtime:desc">Newest</option>
          <option value="mtime:asc">Oldest</option>
        </select>
        <button onClick={onRefresh} className="btn-ghost px-1.5 py-1" title="Refresh">
          <RefreshCw size={13} className={s.viewLoading ? 'animate-spin' : ''} />
        </button>
        <button onClick={selectAllOnPage} className="shrink-0 text-[10px] text-accent hover:underline" title="Select all items on this page">
          Select page
        </button>
      </div>

      {/* Header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-ink-700 px-3 py-1 text-[10px] uppercase tracking-wide text-slate-500">
        <span className="w-5" />
        <span className="flex-1">Name</span>
        <span className="w-20 text-right">Size</span>
        <span className="w-12 text-right">%</span>
        <span className="w-16 text-right">Status</span>
      </div>

      {/* Virtual rows */}
      <div ref={boxRef} className="min-h-0 flex-1 overflow-y-auto" onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
        {entries.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-10 text-xs text-slate-500">
            {s.viewLoading ? (
              <>
                <Loader2 size={13} className="animate-spin" /> Loading…
              </>
            ) : (
              'No items'
            )}
          </div>
        ) : (
          <div style={{ height: entries.length * ROW_H, position: 'relative' }}>
            {visible.map((node, i) => {
              const idx = startIdx + i
              const selected = s.selection.has(node.id)
              const pct = dirBytes > 0 ? Math.round((node.knownBytes / dirBytes) * 100) : null
              return (
                <div
                  key={node.id}
                  style={{ position: 'absolute', top: idx * ROW_H, height: ROW_H }}
                  className={`flex w-full items-center gap-2 px-3 text-xs ${
                    selected ? 'bg-accent/15' : 'hover:bg-ink-800'
                  }`}
                  onClick={(e) => toggle(node, e.metaKey || e.ctrlKey)}
                  onDoubleClick={() => node.kind === 'directory' && onOpen(node)}
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    disabled={!node.selectable}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => toggle(node, true)}
                    className="w-3.5 accent-accent"
                  />
                  {node.kind === 'directory' ? (
                    <Folder size={13} className="shrink-0 text-accent" />
                  ) : node.kind === 'symlink' ? (
                    <Link2 size={13} className="shrink-0 text-slate-500" />
                  ) : (
                    <File size={13} className="shrink-0 text-slate-400" />
                  )}
                  <span className={`flex-1 truncate ${node.kind === 'directory' ? 'text-slate-100' : 'text-slate-300'}`} title={node.name}>
                    {node.name}
                    {node.issueCount > 0 && <span className="ml-1 text-warn">⚠</span>}
                  </span>
                  <span className="w-20 shrink-0 text-right font-mono text-[11px] text-slate-500">{fmtBytes(node.knownBytes)}</span>
                  <span className="w-12 shrink-0 text-right font-mono text-[11px] text-slate-500">{pct === null ? '—' : `${pct}%`}</span>
                  <span className="w-16 shrink-0 text-right text-[10px] text-slate-600">
                    {node.coverage === 'partial' ? 'Partial' : node.coverage === 'excluded' ? 'Excluded' : node.coverage === 'pending' ? '…' : ''}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Pagination */}
      {total > 0 && (
        <div className="flex shrink-0 items-center justify-between border-t border-ink-700 px-3 py-1 text-[11px] text-slate-500">
          <span>
            {pageStart}–{pageEnd} of {total.toLocaleString()}
          </span>
          <span className="flex items-center gap-1">
            <button
              onClick={() => onPage(Math.max(0, s.offset - s.limit))}
              disabled={s.offset === 0}
              className="rounded p-1 hover:bg-ink-700 disabled:opacity-30"
            >
              <ChevronLeft size={13} />
            </button>
            <button
              onClick={() => onPage(s.offset + s.limit)}
              disabled={s.offset + s.limit >= total}
              className="rounded p-1 hover:bg-ink-700 disabled:opacity-30"
            >
              <ChevronRight size={13} />
            </button>
          </span>
        </div>
      )}
    </div>
  )
}
