import { useEffect, useRef, useState } from 'react'
import RFB from '@novnc/novnc'
import { Monitor, RotateCw, Command, Eye, EyeOff, AlertCircle, Loader2 } from 'lucide-react'
import { useStore } from '../store'
import type { Tab } from '../store'

export default function VncPanel({ tab }: { tab: Tab }): JSX.Element {
  const { vault, setTabStatus } = useStore()
  const server = vault?.servers.find((s) => s.id === tab.serverId)
  const hostRef = useRef<HTMLDivElement>(null)
  const rfbRef = useRef<RFB | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [phase, setPhase] = useState<'connecting' | 'connected' | 'closed'>('connecting')
  const [viewOnly, setViewOnly] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let disposed = false
    setError(null)
    setPhase('connecting')
    setTabStatus(tab.id, 'connecting')

    ;(async () => {
      try {
        const port = await window.janus.vnc.start(tab.id, tab.serverId)
        if (disposed || !hostRef.current) {
          window.janus.vnc.stop(tab.id)
          return
        }
        const rfb = new RFB(hostRef.current, `ws://127.0.0.1:${port}`, {
          credentials: { password: server?.vncPassword || '' }
        })
        rfb.scaleViewport = true
        rfb.background = '#0a0b0d'
        rfb.focusOnClick = true
        rfb.addEventListener('connect', () => {
          setPhase('connected')
          setTabStatus(tab.id, 'connected')
        })
        rfb.addEventListener('disconnect', (e: unknown) => {
          setPhase('closed')
          setTabStatus(tab.id, 'disconnected')
          const clean = (e as { detail?: { clean?: boolean } }).detail?.clean
          if (!clean) setError('Connection lost. Is the VNC server running / is the port correct?')
        })
        rfb.addEventListener('securityfailure', (e: unknown) => {
          const reason = (e as { detail?: { reason?: string } }).detail?.reason
          setError('Authentication failed' + (reason ? `: ${reason}` : ' (VNC password?)'))
        })
        rfbRef.current = rfb
      } catch (e) {
        setError((e as Error).message)
        setTabStatus(tab.id, 'error')
      }
    })()

    return () => {
      disposed = true
      try {
        rfbRef.current?.disconnect()
      } catch {
        /* noop */
      }
      rfbRef.current = null
      window.janus.vnc.stop(tab.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id, attempt])

  function toggleViewOnly(): void {
    const next = !viewOnly
    setViewOnly(next)
    if (rfbRef.current) rfbRef.current.viewOnly = next
  }

  return (
    <div className="flex h-full flex-col bg-ink-900">
      <div className="flex items-center gap-2 border-b border-ink-600 bg-ink-800 px-3 py-2">
        <Monitor size={16} className="text-accent" />
        <span className="text-sm font-medium text-slate-300">{server?.name}</span>
        <span
          className={`ml-1 h-2 w-2 rounded-full ${
            phase === 'connected' ? 'bg-good' : phase === 'connecting' ? 'bg-warn animate-pulse' : 'bg-slate-600'
          }`}
        />
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => rfbRef.current?.sendCtrlAltDel()}
            disabled={phase !== 'connected'}
            className="btn-ghost border border-ink-500 px-2 py-1 text-xs"
            title="Send Ctrl+Alt+Del"
          >
            <Command size={13} /> Ctrl+Alt+Del
          </button>
          <button onClick={toggleViewOnly} className="btn-ghost border border-ink-500 px-2 py-1 text-xs" title="View only">
            {viewOnly ? <EyeOff size={13} /> : <Eye size={13} />} {viewOnly ? 'Watching' : 'Control'}
          </button>
          <button onClick={() => setAttempt((a) => a + 1)} className="btn-ghost border border-ink-500 px-2 py-1 text-xs" title="Reconnect">
            <RotateCw size={13} />
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-bad/10 px-4 py-2 text-xs text-bad">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        {phase === 'connecting' && !error && (
          <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 text-sm text-slate-500">
            <Loader2 size={16} className="animate-spin" /> Connecting to desktop (via SSH tunnel)…
          </div>
        )}
        <div ref={hostRef} className="h-full w-full" />
      </div>
    </div>
  )
}
