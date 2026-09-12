import { useRef, useState } from 'react'
import { v4 as uuid } from 'uuid'
import { SplitSquareHorizontal, X } from 'lucide-react'
import TerminalView from './Terminal'
import { useStore } from '../store'
import type { Tab } from '../store'
import type { SessionStatus } from '@shared/types'

/** A terminal tab that can be split into up to 4 independent panes. */
export default function SplitTerminal({ tab }: { tab: Tab }): JSX.Element {
  const { setTabStatus } = useStore()
  // The first pane reuses the tab id as its session id for continuity.
  const [panes, setPanes] = useState<string[]>([tab.id])
  const statuses = useRef<Record<string, SessionStatus>>({})

  function aggregate(): void {
    const vals = Object.values(statuses.current)
    let s: SessionStatus = 'disconnected'
    if (vals.some((v) => v === 'connected')) s = 'connected'
    else if (vals.some((v) => v === 'connecting')) s = 'connecting'
    else if (vals.some((v) => v === 'error')) s = 'error'
    setTabStatus(tab.id, s)
  }

  function addPane(): void {
    if (panes.length >= 4) return
    setPanes((p) => [...p, `${tab.id}::${uuid().slice(0, 8)}`])
  }
  function closePane(id: string): void {
    delete statuses.current[id]
    setPanes((p) => p.filter((x) => x !== id))
    aggregate()
  }

  const cols = panes.length >= 2 ? 2 : 1
  const rows = panes.length > 2 ? 2 : 1

  return (
    <div
      className="grid h-full w-full gap-px bg-ink-600"
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0,1fr))` }}
    >
      {panes.map((pid) => (
        <div key={pid} className="group relative min-h-0 min-w-0 bg-ink-900">
          <div className="absolute right-2 top-2 z-10 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            {panes.length < 4 && (
              <button onClick={addPane} className="rounded bg-ink-700/90 p-1 text-slate-300 hover:bg-ink-600 hover:text-white" title="Split (new pane)">
                <SplitSquareHorizontal size={13} />
              </button>
            )}
            {panes.length > 1 && (
              <button onClick={() => closePane(pid)} className="rounded bg-ink-700/90 p-1 text-slate-300 hover:bg-bad hover:text-white" title="Close pane">
                <X size={13} />
              </button>
            )}
          </div>
          <TerminalView
            sessionId={pid}
            serverId={tab.serverId}
            onStatus={(s) => {
              statuses.current[pid] = s
              aggregate()
            }}
          />
        </div>
      ))}
    </div>
  )
}
