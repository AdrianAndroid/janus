import { useCallback, useEffect, useState } from 'react'
import { ArrowUp, Folder, Home, Loader2, X } from 'lucide-react'
import { useDiskStore } from './store'
import type { BrowseResult } from '@shared/disk-usage'

/** Shallow directory picker (direct subdirectories only — never measures). */
export default function BrowseDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const draftRootPath = useDiskStore((s) => s.draftRootPath)
  const setDraftRootPath = useDiskStore((s) => s.setDraftRootPath)
  const [data, setData] = useState<BrowseResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (p?: string) => {
    setLoading(true)
    setError(null)
    try {
      setData(await window.diskUsage.browse({ path: p }))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(draftRootPath || undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="flex h-[60vh] w-[520px] flex-col rounded-xl border border-ink-500 bg-ink-800 shadow-2xl">
        <div className="flex items-center justify-between border-b border-ink-600 px-5 py-3">
          <h2 className="font-semibold text-white">Choose folder</h2>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-ink-600 hover:text-white">
            <X size={16} />
          </button>
        </div>

        <div className="flex shrink-0 items-center gap-1 border-b border-ink-700 px-3 py-2">
          <button onClick={() => void load()} className="btn-ghost px-1.5 py-1" title="Home">
            <Home size={13} />
          </button>
          <button onClick={() => data?.parent && void load(data.parent)} disabled={!data?.parent} className="btn-ghost px-1.5 py-1 disabled:opacity-30" title="Up">
            <ArrowUp size={13} />
          </button>
          <span className="flex-1 truncate font-mono text-xs text-slate-400" title={data?.cwd}>{data?.cwd ?? '…'}</span>
        </div>

        {error && <div className="bg-bad/10 px-4 py-1.5 text-xs text-bad">{error}</div>}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-xs text-slate-500">
              <Loader2 size={13} className="animate-spin" /> Loading…
            </div>
          ) : (
            (data?.dirs ?? []).map((d) => (
              <div
                key={d.path}
                onDoubleClick={() => void load(d.path)}
                onClick={() => setDraftRootPath(d.path)}
                className={`flex cursor-pointer items-center gap-2 border-b border-ink-700/50 px-4 py-1.5 text-xs hover:bg-ink-700 ${
                  draftRootPath === d.path ? 'bg-accent/15' : ''
                }`}
              >
                <Folder size={13} className="shrink-0 text-accent" />
                <span className="truncate text-slate-300">{d.name}</span>
              </div>
            ))
          )}
          {!loading && (data?.dirs ?? []).length === 0 && <div className="py-8 text-center text-xs text-slate-500">No subfolders.</div>}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-ink-600 px-4 py-3">
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-slate-500" title={draftRootPath}>{draftRootPath}</span>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-ghost">Cancel</button>
            <button onClick={onClose} disabled={!draftRootPath.trim()} className="btn-primary disabled:opacity-40">
              Select Folder
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
