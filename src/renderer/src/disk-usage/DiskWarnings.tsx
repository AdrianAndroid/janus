import { useCallback, useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import type { ScanWarning } from '@shared/disk-usage'

const PAGE = 100

export default function DiskWarnings({ scanId, onClose }: { scanId: string; onClose: () => void }): JSX.Element {
  const [warnings, setWarnings] = useState<ScanWarning[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(false)

  const load = useCallback(
    async (off: number) => {
      setLoading(true)
      try {
        const res = await window.diskUsage.warnings({ scanId, offset: off, limit: PAGE })
        setWarnings(res.warnings)
        setTotal(res.total)
        setOffset(off)
      } finally {
        setLoading(false)
      }
    },
    [scanId]
  )

  useEffect(() => {
    void load(0)
  }, [load])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="flex max-h-[80vh] w-[640px] flex-col rounded-xl border border-ink-500 bg-ink-800 shadow-2xl">
        <div className="flex items-center justify-between border-b border-ink-600 px-5 py-3">
          <h2 className="font-semibold text-white">Scan warnings ({total.toLocaleString()})</h2>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-ink-600 hover:text-white">
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
          {warnings.map((w, i) => (
            <div key={offset + i} className="flex items-start gap-2 border-b border-ink-700/50 px-2 py-1.5 text-[11px]">
              <span className="w-32 shrink-0 font-mono text-warn">{w.code}</span>
              <span className="flex-1 truncate font-mono text-slate-400" title={w.path}>{w.path}</span>
              <span className="shrink-0 text-slate-600">{w.message}</span>
            </div>
          ))}
          {warnings.length === 0 && !loading && <div className="py-8 text-center text-xs text-slate-500">No warnings.</div>}
        </div>
        {total > PAGE && (
          <div className="flex items-center justify-between border-t border-ink-600 px-4 py-2 text-[11px] text-slate-500">
            <span>
              {offset + 1}–{Math.min(offset + PAGE, total)} of {total.toLocaleString()}
            </span>
            <span className="flex gap-1">
              <button onClick={() => void load(Math.max(0, offset - PAGE))} disabled={offset === 0 || loading} className="rounded p-1 hover:bg-ink-700 disabled:opacity-30">
                <ChevronLeft size={13} />
              </button>
              <button onClick={() => void load(offset + PAGE)} disabled={offset + PAGE >= total || loading} className="rounded p-1 hover:bg-ink-700 disabled:opacity-30">
                <ChevronRight size={13} />
              </button>
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
