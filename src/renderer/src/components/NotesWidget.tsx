import { useEffect, useRef, useState } from 'react'
import { StickyNote, X, Eye, EyeOff, GripVertical } from 'lucide-react'
import { useStore } from '../store'

interface Geom {
  x: number
  y: number
  w: number
  h: number
}
const GEOM_KEY = 'janus.notes.geom'

function loadGeom(): Geom {
  try {
    const g = JSON.parse(localStorage.getItem(GEOM_KEY) || '')
    if (g && typeof g.x === 'number') return g
  } catch {
    /* default */
  }
  return { x: Math.max(20, window.innerWidth - 380), y: 56, w: 340, h: 360 }
}
function saveGeom(g: Geom): void {
  try {
    localStorage.setItem(GEOM_KEY, JSON.stringify(g))
  } catch {
    /* ignore */
  }
}

export default function NotesWidget(): JSX.Element | null {
  const { notesOpen, toggleNotes, vault, setNotes } = useStore()
  const [geom, setGeom] = useState<Geom>(loadGeom)
  const [blur, setBlur] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  // Persist size when the user resizes (CSS resize handle).
  useEffect(() => {
    if (!boxRef.current) return
    const ro = new ResizeObserver(() => {
      const el = boxRef.current
      if (!el) return
      setGeom((g) => {
        const next = { ...g, w: el.offsetWidth, h: el.offsetHeight }
        saveGeom(next)
        return next
      })
    })
    ro.observe(boxRef.current)
    return () => ro.disconnect()
  }, [notesOpen])

  if (!notesOpen) return null

  function startDrag(e: React.MouseEvent): void {
    e.preventDefault()
    const start = { mx: e.clientX, my: e.clientY, x: geom.x, y: geom.y }
    const move = (ev: MouseEvent): void => {
      const x = Math.max(0, Math.min(window.innerWidth - 80, start.x + (ev.clientX - start.mx)))
      const y = Math.max(36, Math.min(window.innerHeight - 60, start.y + (ev.clientY - start.my)))
      setGeom((g) => ({ ...g, x, y }))
    }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      setGeom((g) => {
        saveGeom(g)
        return g
      })
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  return (
    <div
      ref={boxRef}
      className="fixed z-[55] flex flex-col overflow-hidden rounded-xl border border-ink-500 bg-ink-800/95 shadow-2xl backdrop-blur"
      style={{ left: geom.x, top: geom.y, width: geom.w, height: geom.h, minWidth: 240, minHeight: 160, resize: 'both' }}
    >
      <div
        onMouseDown={startDrag}
        className="flex shrink-0 cursor-move items-center gap-2 border-b border-ink-600 bg-ink-700/60 px-3 py-2"
      >
        <GripVertical size={14} className="text-slate-600" />
        <StickyNote size={14} className="text-accent" />
        <span className="flex-1 text-xs font-semibold text-slate-200">Notes</span>
        <button onClick={() => setBlur((b) => !b)} className="rounded p-1 text-slate-400 hover:bg-ink-600 hover:text-white" title={blur ? 'Show' : 'Hide'}>
          {blur ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
        <button onClick={toggleNotes} className="rounded p-1 text-slate-400 hover:bg-ink-600 hover:text-white" title="Close">
          <X size={14} />
        </button>
      </div>
      <textarea
        value={vault?.notes ?? ''}
        onChange={(e) => setNotes(e.target.value)}
        spellCheck={false}
        placeholder="Passwords, notes, IPs… Project-wide, stored in the encrypted vault."
        className={`min-h-0 flex-1 resize-none bg-transparent px-3 py-2.5 font-mono text-[12.5px] leading-relaxed text-slate-200 outline-none placeholder:text-slate-600 ${
          blur ? 'blur-sm hover:blur-0 focus:blur-0' : ''
        }`}
      />
      <div className="shrink-0 border-t border-ink-600 px-3 py-1 text-[10px] text-slate-600">
        🔒 Auto-saved to the encrypted vault
      </div>
    </div>
  )
}
