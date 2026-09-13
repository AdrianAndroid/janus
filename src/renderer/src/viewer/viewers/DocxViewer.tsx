import { useEffect, useRef, useState } from 'react'
import { renderAsync } from 'docx-preview'
import type { ViewerContextPayload } from '@shared/viewer'
import { sniffMatches, VIEWER_LIMITS } from '@shared/viewer'
import { fetchAll, fmtBytes, mediaUrl, ViewError, withTimeout } from '../lib'
import { LoadGuard } from '../main'

export default function DocxViewer({ ctx }: { ctx: ViewerContextPayload }): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [size, setSize] = useState(0)

  useEffect(() => {
    let disposed = false
    void (async () => {
      try {
        const url = mediaUrl(ctx.serverId, ctx.path)
        const { bytes, totalSize, truncated } = await fetchAll(url, VIEWER_LIMITS.officeMaxBytes, 0)
        if (disposed) return
        if (truncated) {
          throw new ViewError(`File is too large to preview (${fmtBytes(totalSize)}, limit ${fmtBytes(VIEWER_LIMITS.officeMaxBytes)}). Download and open it locally instead.`, 'TOO_BIG')
        }
        if (!sniffMatches('docx', bytes.subarray(0, 16))) {
          throw new ViewError('Not a valid docx (zip) package — the file may be corrupted or mis-named.')
        }
        setSize(totalSize)
        await withTimeout(
          renderAsync(bytes.buffer as ArrayBuffer, hostRef.current!, undefined, {
            inWrapper: true,
            ignoreWidth: false,
            ignoreHeight: false,
            breakPages: true
          }),
          VIEWER_LIMITS.parseTimeoutMs,
          'DOCX rendering'
        )
        if (!disposed) setDone(true)
      } catch (e) {
        if (!disposed) setError((e as Error).message)
      }
    })()
    return () => {
      disposed = true
    }
  }, [ctx.serverId, ctx.path])

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-ink-700 px-3 py-1 text-[11px] text-slate-500">
        {done ? `Word document · ${fmtBytes(size)} · complex layouts may render approximately` : ''}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto bg-slate-100">
        <LoadGuard checking={!done && !error} error={error}>
          <div ref={hostRef} className="docx-host mx-auto max-w-[900px] bg-white py-4 text-black" />
        </LoadGuard>
      </div>
    </div>
  )
}
