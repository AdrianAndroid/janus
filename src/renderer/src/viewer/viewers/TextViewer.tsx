import { useEffect, useMemo, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { json } from '@codemirror/lang-json'
import { javascript } from '@codemirror/lang-javascript'
import { xml } from '@codemirror/lang-xml'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import type { Extension } from '@codemirror/state'
import type { ViewerContextPayload } from '@shared/viewer'
import { decodeText, extOf, looksBinary, VIEWER_LIMITS } from '@shared/viewer'
import { fetchAll, fmtBytes, mediaUrl, ViewError, withTimeout } from '../lib'
import { LoadGuard } from '../main'

function langFor(name: string): Extension[] {
  const ext = extOf(name)
  if (ext === '.json' || ext === '.jsonl') return [json()]
  if (['.js', '.jsx', '.ts', '.tsx'].includes(ext)) return [javascript({ typescript: ext.includes('t') })]
  if (['.xml', '.html', '.htm', '.svg'].includes(ext)) return [xml()]
  return []
}

export default function TextViewer({ ctx }: { ctx: ViewerContextPayload }): JSX.Element {
  const [state, setState] = useState<{
    text: string
    encoding: string
    truncated: boolean
    totalSize: number
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [previewMd, setPreviewMd] = useState(false)
  const name = ctx.path.split(/[\\/]/).pop() ?? ''
  const isMd = ['.md', '.markdown'].includes(extOf(name))

  useEffect(() => {
    let disposed = false
    void (async () => {
      try {
        const url = mediaUrl(ctx.serverId, ctx.path)
        const { bytes, totalSize, truncated } = await withTimeout(
          fetchAll(url, VIEWER_LIMITS.textMaxBytes, VIEWER_LIMITS.textPreviewBytes),
          VIEWER_LIMITS.parseTimeoutMs,
          'Reading'
        )
        if (disposed) return
        if (looksBinary(bytes.subarray(0, VIEWER_LIMITS.textBinarySampleBytes))) {
          throw new ViewError('This looks like a binary file — not opened as text.', 'BINARY')
        }
        const { text, encoding } = decodeText(bytes)
        if (!disposed) setState({ text, encoding, truncated, totalSize })
      } catch (e) {
        if (!disposed) setError((e as Error).message)
      }
    })()
    return () => {
      disposed = true
    }
  }, [ctx.serverId, ctx.path])

  const mdHtml = useMemo(() => {
    if (!isMd || !state || !previewMd) return ''
    return DOMPurify.sanitize(marked.parse(state.text, { async: false }) as string)
  }, [isMd, state, previewMd])

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-ink-700 px-3 py-1 text-[11px] text-slate-500">
        <span>{state ? `${state.encoding}${state.truncated ? ` · preview of first ${fmtBytes(VIEWER_LIMITS.textPreviewBytes)} (full ${fmtBytes(state.totalSize)})` : ` · ${fmtBytes(state.totalSize)}`}` : ''}</span>
        <div className="flex-1" />
        {isMd && (
          <button
            onClick={() => setPreviewMd((v) => !v)}
            className={`rounded px-2 py-0.5 ${previewMd ? 'bg-accent/20 text-accent' : 'text-slate-400 hover:text-white'}`}
          >
            {previewMd ? 'Source' : 'Preview'}
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <LoadGuard checking={!state && !error} error={error}>
          {state && previewMd && isMd ? (
            <div className="h-full overflow-y-auto px-6 py-4">
              <article className="prose prose-invert max-w-none text-sm" dangerouslySetInnerHTML={{ __html: mdHtml }} />
            </div>
          ) : state ? (
            <CodeMirror
              value={state.text}
              readOnly
              theme="dark"
              extensions={langFor(name)}
              basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: false }}
              className="h-full text-xs [&_.cm-editor]:h-full [&_.cm-scroller]:overflow-auto"
            />
          ) : null}
        </LoadGuard>
      </div>
    </div>
  )
}
