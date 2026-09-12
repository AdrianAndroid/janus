import { FolderSearch, Loader2, Play, Square } from 'lucide-react'
import { useDiskStore } from './store'
import { fmtBytes } from './DiskUsageApp'

interface Props {
  scanning: boolean
  onStart: () => void
  onStop: () => void
  onBrowse: () => void
}

/** Two-row toolbar: path entry on top, actions + scan status below. */
export default function DiskToolbar({ scanning, onStart, onStop, onBrowse }: Props): JSX.Element {
  const draftRootPath = useDiskStore((s) => s.draftRootPath)
  const setDraftRootPath = useDiskStore((s) => s.setDraftRootPath)
  const scanRootPath = useDiskStore((s) => s.scanRootPath)
  const snapshot = useDiskStore((s) => s.snapshot)
  const setWarningsOpen = useDiskStore((s) => s.setWarningsOpen)

  const stateText = !snapshot
    ? 'No scan yet'
    : snapshot.state === 'scanning'
      ? 'Scanning…'
      : snapshot.state === 'canceling'
        ? 'Stopping…'
        : snapshot.state === 'completed'
          ? 'Completed'
          : snapshot.state === 'canceled'
            ? 'Canceled (partial results)'
            : snapshot.state === 'limited'
              ? 'Limit reached (partial results)'
              : snapshot.state === 'starting'
                ? 'Starting…'
                : `Failed${snapshot.error ? `: ${snapshot.error}` : ''}`

  return (
    <div className="shrink-0 border-b border-ink-600 bg-ink-800">
      {/* Row 1: path entry */}
      <div className="flex items-center gap-2 px-4 pt-2">
        <span className="shrink-0 text-xs text-slate-500">Root</span>
        <input
          value={draftRootPath}
          onChange={(e) => setDraftRootPath(e.target.value)}
          disabled={scanning}
          placeholder="/path/to/analyze"
          spellCheck={false}
          className="field flex-1 font-mono text-xs disabled:opacity-50"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !scanning) onStart()
          }}
        />
        <button onClick={onBrowse} disabled={scanning} className="btn-ghost border border-ink-500 disabled:opacity-40">
          <FolderSearch size={14} /> Browse
        </button>
      </div>

      {/* Row 2: actions + status */}
      <div className="flex items-center gap-3 px-4 py-2">
        {scanning ? (
          <button onClick={onStop} className="btn-ghost border border-warn/60 text-warn">
            <Square size={14} /> Stop
          </button>
        ) : (
          <button onClick={onStart} disabled={!draftRootPath.trim()} className="btn-primary disabled:opacity-40">
            <Play size={14} /> Start Analysis
          </button>
        )}
        {scanRootPath && scanRootPath !== draftRootPath && (
          <span className="shrink-0 text-[10px] text-slate-600">results: {scanRootPath}</span>
        )}
        <div className="flex-1" />
        <span className="flex items-center gap-2 text-xs text-slate-400">
          {scanning && <Loader2 size={12} className="animate-spin text-accent" />}
          {snapshot
            ? `Scanned ${snapshot.scannedFiles.toLocaleString()} files · ${fmtBytes(snapshot.knownBytes)} · ${snapshot.warningCount} warnings · ${stateText}`
            : stateText}
        </span>
        {snapshot && snapshot.warningCount > 0 && (
          <button onClick={() => setWarningsOpen(true)} className="text-xs text-accent hover:underline">
            View warnings
          </button>
        )}
      </div>
    </div>
  )
}
