import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import RFB from '@novnc/novnc'
import '../index.css'

type Phase = 'connecting' | 'connected' | 'closed'

function VncApp(): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const rfbRef = useRef<RFB | null>(null)
  const retriedRef = useRef(false)
  const [phase, setPhase] = useState<Phase>('connecting')
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let disposed = false
    setPhase('connecting')
    setError(null)
    void (async () => {
      try {
        const ctx = await window.vnc.getContext()
        if (!ctx) {
          if (!disposed) setError('Window context unavailable — close and pop out again.')
          return
        }
        if (disposed || !hostRef.current) return
        const rfb = new RFB(hostRef.current, `ws://127.0.0.1:${ctx.wsPort}`, {
          credentials: { password: ctx.password }
        })
        rfb.scaleViewport = true
        rfb.background = '#0a0b0d'
        rfb.focusOnClick = true
        rfb.addEventListener('connect', () => setPhase('connected'))
        rfb.addEventListener('disconnect', (e: unknown) => {
          setPhase('closed')
          const clean = (e as { detail?: { clean?: boolean } }).detail?.clean
          if (!clean) {
            if (!retriedRef.current) {
              retriedRef.current = true
              setPhase('connecting')
              setTimeout(() => setAttempt((a) => a + 1), 800)
            } else {
              setError('Connection lost. Is the VNC server running / is the port correct?')
            }
          }
        })
        rfb.addEventListener('securityfailure', (e: unknown) => {
          const reason = (e as { detail?: { reason?: string } }).detail?.reason
          setError('Authentication failed' + (reason ? `: ${reason}` : ' (VNC password?)'))
        })
        rfbRef.current = rfb
      } catch (e) {
        setError((e as Error).message)
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
    }
  }, [attempt])

  return (
    <div className="flex h-screen flex-col bg-ink-900">
      <div className="flex shrink-0 items-center gap-2 border-b border-ink-600 bg-ink-800 px-3 py-1.5 text-xs text-slate-400">
        <span className={`h-1.5 w-1.5 rounded-full ${phase === 'connected' ? 'bg-good' : phase === 'connecting' ? 'animate-pulse bg-warn' : 'bg-bad'}`} />
        <span>{phase === 'connected' ? 'Connected' : phase === 'connecting' ? 'Connecting…' : 'Disconnected'}</span>
        <div className="flex-1" />
        <button
          onClick={() => rfbRef.current?.sendCtrlAltDel()}
          className="rounded px-2 py-0.5 text-slate-400 hover:bg-ink-600 hover:text-white"
        >
          Ctrl+Alt+Del
        </button>
        <button
          onClick={() => setAttempt((n) => n + 1)}
          className="rounded px-2 py-0.5 text-slate-400 hover:bg-ink-600 hover:text-white"
        >
          Reconnect
        </button>
      </div>
      {error && <div className="shrink-0 bg-bad/10 px-3 py-1.5 text-xs text-bad">{error}</div>}
      <div ref={hostRef} className="min-h-0 flex-1" />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <VncApp />
  </React.StrictMode>
)
