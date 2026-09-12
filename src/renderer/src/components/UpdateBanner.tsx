import { useEffect, useState } from 'react'
import { Download, RefreshCw, X, CheckCircle2, Loader2 } from 'lucide-react'
import type { UpdateStatus } from '@shared/types'

export default function UpdateBanner(): JSX.Element | null {
  const [status, setStatus] = useState<UpdateStatus>({ phase: 'idle' })
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    const off = window.janus.updates.onStatus((s) => {
      setStatus(s)
      if (s.phase === 'available' || s.phase === 'downloaded') setDismissed(false)
    })
    return off
  }, [])

  const { phase } = status
  if (dismissed) return null
  if (phase === 'idle' || phase === 'checking' || phase === 'not-available') return null

  return (
    <div className="absolute bottom-4 right-4 z-50 w-80 rounded-xl border border-ink-500 bg-ink-800 p-4 shadow-[0_16px_48px_-12px_rgba(0,0,0,0.7)]">
      <div className="mb-1 flex items-start justify-between">
        <div className="flex items-center gap-2 font-semibold text-slate-100">
          {phase === 'downloaded' ? (
            <CheckCircle2 size={17} className="text-good" />
          ) : phase === 'downloading' ? (
            <Loader2 size={17} className="animate-spin text-accent" />
          ) : (
            <Download size={17} className="text-accent" />
          )}
          {phase === 'available' && 'Update available'}
          {phase === 'downloading' && 'Downloading…'}
          {phase === 'downloaded' && 'Update ready'}
          {phase === 'error' && 'Update error'}
        </div>
        <button onClick={() => setDismissed(true)} className="rounded p-1 text-slate-500 hover:bg-ink-600 hover:text-white">
          <X size={15} />
        </button>
      </div>

      {status.version && phase !== 'error' && (
        <p className="mb-3 text-xs text-slate-500">
          Version <span className="font-mono text-slate-300">v{status.version}</span>
        </p>
      )}

      {phase === 'downloading' && (
        <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-ink-600">
          <div className="h-full bg-accent transition-all" style={{ width: `${status.percent ?? 0}%` }} />
        </div>
      )}

      {phase === 'error' && <p className="mb-3 text-xs text-bad">{status.error}</p>}

      <div className="flex gap-2">
        {phase === 'available' && (
          <button onClick={() => window.janus.updates.download()} className="btn-primary flex-1 py-1.5 text-xs">
            <Download size={13} /> Download
          </button>
        )}
        {phase === 'downloaded' && (
          <button onClick={() => window.janus.updates.install()} className="btn-primary flex-1 py-1.5 text-xs">
            <RefreshCw size={13} /> Restart & install
          </button>
        )}
        {phase === 'error' && status.manualOnly && (
          <button
            onClick={() => window.open('https://asafudurgucu.github.io/janus/')}
            className="btn-primary flex-1 py-1.5 text-xs"
          >
            <Download size={13} /> Download from site
          </button>
        )}
        {phase === 'error' && !status.manualOnly && (
          <button onClick={() => window.janus.updates.check()} className="btn-ghost flex-1 border border-ink-500 py-1.5 text-xs">
            <RefreshCw size={13} /> Retry
          </button>
        )}
      </div>
    </div>
  )
}
