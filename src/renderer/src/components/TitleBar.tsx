import { Lock, Minus, Square, X, StickyNote, PictureInPicture2 } from 'lucide-react'
import { useStore } from '../store'
import logo from '../assets/logo-mark.png'

export default function TitleBar({ minimal = false }: { minimal?: boolean }): JSX.Element {
  const { lock, locked, toggleNotes, notesOpen, setMini, miniMode, tabs } = useStore()
  const isMac = navigator.platform.toLowerCase().includes('mac')
  const hasTerminal = tabs.some((t) => t.kind === 'terminal')
  const activeServer = tabs.find((t) => t.kind === 'terminal')?.title

  return (
    <div className="drag-region flex h-10 shrink-0 items-center justify-between border-b border-ink-600 bg-ink-800/80 px-3 backdrop-blur">
      {/* Reserve space for the macOS traffic lights so nothing overlaps them. */}
      <div className="flex items-center gap-2.5" style={{ paddingLeft: isMac ? 70 : 4 }}>
        {/* Brand wordmark (transparent, white "Janus"). */}
        <img src={logo} alt="Janus" className="h-[18px] w-auto select-none" draggable={false} />
        {!minimal && !miniMode && (
          <span className="ml-1 text-[11px] font-medium text-slate-600">
            SSH Manager <span className="text-slate-700">|</span>{' '}
            <span className="text-slate-400">The Asaf Effect</span>
          </span>
        )}
        {miniMode && activeServer && (
          <span className="ml-1 truncate text-[11px] font-medium text-slate-400">{activeServer}</span>
        )}
      </div>

      <div className="no-drag flex items-center gap-1">
        {miniMode && (
          <button
            onClick={() => setMini(false)}
            className="rounded-md p-1.5 text-accent hover:bg-ink-600"
            title="Back to full window"
          >
            <PictureInPicture2 size={15} />
          </button>
        )}
        {!minimal && !locked && !miniMode && (
          <>
            <button
              onClick={toggleNotes}
              className={`rounded-md p-1.5 ${notesOpen ? 'text-accent' : 'text-slate-400'} hover:bg-ink-600 hover:text-white`}
              title="Notes"
            >
              <StickyNote size={15} />
            </button>
            {hasTerminal && (
              <button
                onClick={() => setMini(true)}
                className="rounded-md p-1.5 text-slate-400 hover:bg-ink-600 hover:text-white"
                title="Mini panel mode"
              >
                <PictureInPicture2 size={15} />
              </button>
            )}
            <button onClick={() => lock()} className="btn-ghost mx-1 px-2.5 py-1 text-[12px]" title="Lock vault">
              <Lock size={13} /> Lock
            </button>
          </>
        )}
        {!isMac && !miniMode && (
          <div className="flex items-center">
            <button onClick={() => window.janus.window.minimize()} className="rounded-md p-2 text-slate-400 hover:bg-ink-600 hover:text-white">
              <Minus size={14} />
            </button>
            <button onClick={() => window.janus.window.maximize()} className="rounded-md p-2 text-slate-400 hover:bg-ink-600 hover:text-white">
              <Square size={11} />
            </button>
            <button onClick={() => window.janus.window.close()} className="rounded-md p-2 text-slate-400 hover:bg-bad hover:text-white">
              <X size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
