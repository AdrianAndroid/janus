import { useEffect, useState } from 'react'
import { Maximize2, ZoomIn } from 'lucide-react'
import type { ViewerContextPayload } from '@shared/viewer'
import { sniffMatches, VIEWER_LIMITS } from '@shared/viewer'
import { fetchHead, mediaUrl } from '../lib'
import { LoadGuard } from '../main'

export default function ImageViewer({ ctx }: { ctx: ViewerContextPayload }): JSX.Element {
  const [checking, setChecking] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [fit, setFit] = useState(true)
  const url = mediaUrl(ctx.serverId, ctx.path)
  const name = ctx.path.split(/[\\/]/).pop() ?? ''
  const isSvg = name.toLowerCase().endsWith('.svg')

  useEffect(() => {
    let disposed = false
    void (async () => {
      try {
        // SVG is XML text — skip binary magic; <img> never executes its scripts.
        if (!isSvg) {
          const head = await fetchHead(url, 16)
          if (!sniffMatches('image', head)) throw new Error('File content does not look like an image (extension mismatch?).')
        }
        if (!disposed) setChecking(false)
      } catch (e) {
        if (!disposed) setError((e as Error).message)
      }
    })()
    return () => {
      disposed = true
    }
  }, [url, isSvg])

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-end gap-1 border-b border-ink-700 px-2 py-1">
        <button
          onClick={() => setFit(true)}
          className={`flex items-center gap-1 rounded px-2 py-0.5 text-[11px] ${fit ? 'bg-accent/20 text-accent' : 'text-slate-400 hover:text-white'}`}
        >
          <Maximize2 size={11} /> Fit
        </button>
        <button
          onClick={() => setFit(false)}
          className={`flex items-center gap-1 rounded px-2 py-0.5 text-[11px] ${!fit ? 'bg-accent/20 text-accent' : 'text-slate-400 hover:text-white'}`}
        >
          <ZoomIn size={11} /> Actual size
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <LoadGuard checking={checking} error={error}>
          <div className={`flex ${fit ? 'h-full items-center justify-center' : 'p-4'}`}>
            <img
              src={url}
              alt={name}
              draggable={false}
              className={fit ? 'max-h-full max-w-full object-contain' : 'max-w-none'}
              onError={() => setError('Failed to decode this image (unsupported or corrupted).')}
            />
          </div>
        </LoadGuard>
      </div>
      <div className="shrink-0 border-t border-ink-700 px-3 py-1 text-[10px] text-slate-600">
        {VIEWER_LIMITS.imageMaxBytes / 1024 / 1024}MB max · {name}
      </div>
    </div>
  )
}
