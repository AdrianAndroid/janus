import { FileWarning } from 'lucide-react'
import type { ViewerContextPayload } from '@shared/viewer'
import { extOf, isKnownUnsupported } from '@shared/viewer'

export default function UnsupportedViewer({ ctx }: { ctx: ViewerContextPayload }): JSX.Element {
  const ext = extOf(ctx.path) || '(no extension)'
  const legacy = isKnownUnsupported(ctx.path)
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <FileWarning size={36} className="text-slate-500" />
      <div className="text-sm font-medium text-white">
        {legacy ? `${ext} is not supported yet` : `Cannot preview ${ext} files`}
      </div>
      <div className="max-w-md text-xs leading-relaxed text-slate-400">
        {legacy
          ? 'The legacy binary Office formats (.doc/.ppt/.pptx) have no reliable in-app renderer. Download the file and open it with a desktop application.'
          : 'This file type has no preview. Use Download in Files to open it with a desktop application.'}
      </div>
      <div className="max-w-md break-all font-mono text-[11px] text-slate-600">{ctx.path}</div>
      <button onClick={() => window.close()} className="btn-ghost mt-1 border border-ink-500">Close</button>
    </div>
  )
}
