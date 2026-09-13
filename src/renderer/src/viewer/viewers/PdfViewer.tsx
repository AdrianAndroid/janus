import { useCallback, useEffect, useRef, useState } from 'react'
import * as pdfjs from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react'
import type { ViewerContextPayload } from '@shared/viewer'
import { sniffMatches, VIEWER_LIMITS } from '@shared/viewer'
import { fetchHead, mediaUrl, ViewError, withTimeout } from '../lib'
import { LoadGuard } from '../main'

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

const SCALES = [0.5, 0.75, 1, 1.25, 1.5, 2]

export default function PdfViewer({ ctx }: { ctx: ViewerContextPayload & { progress?: { page: number } } }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [doc, setDoc] = useState<pdfjs.PDFDocumentProxy | null>(null)
  const [pageNum, setPageNum] = useState(1)
  const [pageCount, setPageCount] = useState(0)
  const [scaleIdx, setScaleIdx] = useState(2)
  const [error, setError] = useState<string | null>(null)
  const [rendering, setRendering] = useState(false)
  const key = ctx.serverId ? `${ctx.serverId}:${ctx.path}` : ctx.path

  // Sniff + load document.
  useEffect(() => {
    let disposed = false
    let task: pdfjs.PDFDocumentLoadingTask | null = null
    void (async () => {
      try {
        const url = mediaUrl(ctx.serverId, ctx.path)
        const head = await fetchHead(url, 16)
        if (!sniffMatches('pdf', head)) throw new ViewError('File does not start with %PDF- (extension mismatch or corrupted).')
        task = pdfjs.getDocument({ url })
        task.onPassword = () => {
          void task?.destroy()
          if (!disposed) setError('This PDF is password-protected — not supported yet.')
        }
        const d = (await withTimeout(task.promise, VIEWER_LIMITS.parseTimeoutMs, 'PDF parsing')) as pdfjs.PDFDocumentProxy
        if (disposed) {
          void task.destroy()
          return
        }
        setDoc(d)
        setPageCount(d.numPages)
        const saved = ctx.progress?.page ?? 1
        setPageNum(Math.min(Math.max(1, saved), d.numPages))
      } catch (e) {
        if (!disposed) setError((e as Error).message)
      }
    })()
    return () => {
      disposed = true
      try {
        void task?.destroy()
      } catch {
        /* noop */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.serverId, ctx.path])

  // Render current page.
  useEffect(() => {
    if (!doc || !canvasRef.current) return
    let cancelled = false
    setRendering(true)
    void (async () => {
      try {
        const page = await doc.getPage(pageNum)
        if (cancelled) return
        const viewport = page.getViewport({ scale: SCALES[scaleIdx] })
        const canvas = canvasRef.current!
        canvas.width = viewport.width
        canvas.height = viewport.height
        const context = canvas.getContext('2d')!
        await page.render({ canvas, canvasContext: context, viewport }).promise
        if (!cancelled) {
          setRendering(false)
          void window.viewer.saveProgress({ key, page: pageNum })
        }
      } catch (e) {
        if (!cancelled) {
          setRendering(false)
          setError((e as Error).message)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [doc, pageNum, scaleIdx, key])

  const go = useCallback(
    (n: number) => setPageNum((p) => Math.min(Math.max(1, n), pageCount || p)),
    [pageCount]
  )

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-ink-700 px-3 py-1 text-[11px] text-slate-400">
        <button onClick={() => go(pageNum - 1)} disabled={pageNum <= 1} className="rounded p-1 hover:bg-ink-700 disabled:opacity-30">
          <ChevronLeft size={13} />
        </button>
        <span className="font-mono">
          <input
            value={pageNum}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10)
              if (Number.isFinite(n)) go(n)
            }}
            className="w-10 rounded border border-ink-500 bg-ink-900 px-1 text-center"
          />
          {' / '}
          {pageCount || '…'}
        </span>
        <button onClick={() => go(pageNum + 1)} disabled={pageCount > 0 && pageNum >= pageCount} className="rounded p-1 hover:bg-ink-700 disabled:opacity-30">
          <ChevronRight size={13} />
        </button>
        <div className="flex-1" />
        <button onClick={() => setScaleIdx((i) => Math.max(0, i - 1))} disabled={scaleIdx === 0} className="rounded p-1 hover:bg-ink-700 disabled:opacity-30">
          <ZoomOut size={13} />
        </button>
        <span className="w-10 text-center font-mono">{Math.round(SCALES[scaleIdx] * 100)}%</span>
        <button onClick={() => setScaleIdx((i) => Math.min(SCALES.length - 1, i + 1))} disabled={scaleIdx === SCALES.length - 1} className="rounded p-1 hover:bg-ink-700 disabled:opacity-30">
          <ZoomIn size={13} />
        </button>
      </div>
      <div className="min-h0 relative flex-1 overflow-auto bg-ink-900">
        <LoadGuard checking={!doc && !error} error={error}>
          <div className="flex min-h-full justify-center p-4">
            <canvas ref={canvasRef} className="h-fit shadow-2xl" />
          </div>
          {rendering && (
            <div className="absolute right-3 top-3 flex items-center gap-1 rounded bg-ink-800/80 px-2 py-1 text-[10px] text-slate-400">
              <Loader2Icon /> rendering
            </div>
          )}
        </LoadGuard>
      </div>
    </div>
  )
}

function Loader2Icon(): JSX.Element {
  return (
    <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
      <path d="M21 12a9 9 0 1 1-6.2-8.56" strokeLinecap="round" />
    </svg>
  )
}
