import React, { Component, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AlertTriangle, FileWarning, Loader2 } from 'lucide-react'
import '../index.css'
import type { ViewerContextPayload } from '@shared/viewer'
import ImageViewer from './viewers/ImageViewer'
import TextViewer from './viewers/TextViewer'
import PdfViewer from './viewers/PdfViewer'
import DocxViewer from './viewers/DocxViewer'
import XlsxViewer from './viewers/XlsxViewer'
import UnsupportedViewer from './viewers/UnsupportedViewer'

type Ctx = ViewerContextPayload & { progress?: { page: number } }

// Error boundary: a viewer component may throw anything — it must never take
// the window (let alone the app) down. Renders an error page instead.
class ViewerErrorBoundary extends Component<{ children: React.ReactNode; fileName: string }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }
  componentDidCatch(error: Error): void {
    console.error('[viewer] render error:', error)
  }
  render(): React.ReactNode {
    if (this.state.error) {
      return <ErrorPage title="Cannot display this file" message={this.state.error.message} fileName={this.props.fileName} />
    }
    return this.props.children
  }
}

function ErrorPage({ title, message, fileName }: { title: string; message: string; fileName: string }): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <FileWarning size={36} className="text-warn" />
      <div className="text-sm font-medium text-white">{title}</div>
      <div className="max-w-md break-all font-mono text-xs text-slate-500">{fileName}</div>
      <div className="max-w-md text-xs text-slate-400">{message}</div>
      <button onClick={() => window.close()} className="btn-ghost mt-2 border border-ink-500">Close</button>
    </div>
  )
}

const KIND_LABEL: Record<string, string> = {
  pdf: 'PDF',
  docx: 'Word',
  xlsx: 'Excel',
  text: 'Text',
  image: 'Image',
  unsupported: 'Unsupported'
}

function ViewerApp(): JSX.Element {
  const [ctx, setCtx] = useState<Ctx | null>(null)
  const [bootError, setBootError] = useState<string | null>(null)
  const bootedRef = useRef(false)

  useEffect(() => {
    if (bootedRef.current) return
    bootedRef.current = true
    void (async () => {
      try {
        const c = await window.viewer.getContext()
        if (!c) setBootError('Viewer context unavailable — close and try again.')
        else {
          setCtx(c)
          document.title = c.title
        }
      } catch (e) {
        setBootError((e as Error).message)
      }
    })()
  }, [])

  const fileName = ctx?.path.split(/[\\/]/).pop() ?? ''
  return (
    <div className="flex h-screen flex-col bg-ink-900 text-slate-200">
      <div className="flex shrink-0 items-center gap-2 border-b border-ink-600 bg-ink-800 px-3 py-1.5">
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-300" title={ctx?.path}>
          {fileName || 'Viewer'}
        </span>
        {ctx && (
          <span className="shrink-0 rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
            {KIND_LABEL[ctx.kind] ?? ctx.kind}
          </span>
        )}
        {ctx?.serverId && <span className="shrink-0 rounded bg-ink-600 px-1.5 py-0.5 text-[10px] text-slate-400">remote</span>}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {bootError ? (
          <ErrorPage title="Cannot open viewer" message={bootError} fileName="" />
        ) : !ctx ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-slate-500">
            <Loader2 size={16} className="animate-spin" /> Loading…
          </div>
        ) : (
          <ViewerErrorBoundary key={ctx.path} fileName={fileName}>
            {ctx.kind === 'pdf' ? (
              <PdfViewer ctx={ctx} />
            ) : ctx.kind === 'docx' ? (
              <DocxViewer ctx={ctx} />
            ) : ctx.kind === 'xlsx' ? (
              <XlsxViewer ctx={ctx} />
            ) : ctx.kind === 'text' ? (
              <TextViewer ctx={ctx} />
            ) : ctx.kind === 'image' ? (
              <ImageViewer ctx={ctx} />
            ) : (
              <UnsupportedViewer ctx={ctx} />
            )}
          </ViewerErrorBoundary>
        )}
      </div>
    </div>
  )
}

export function LoadGuard({ checking, error, children }: { checking: boolean; error: string | null; children: React.ReactNode }): JSX.Element {
  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <AlertTriangle size={32} className="text-warn" />
        <div className="text-xs text-slate-400">{error}</div>
      </div>
    )
  }
  if (checking) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-slate-500">
        <Loader2 size={15} className="animate-spin" /> Loading…
      </div>
    )
  }
  return <>{children}</>
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ViewerApp />
  </React.StrictMode>
)
