import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Check, ChevronLeft, ChevronRight, ListVideo, Loader2, Play, Repeat } from 'lucide-react'
import '../index.css'
import type { PlayerContext, ProgressEntry } from '@shared/media'

function mediaUrl(serverId: string | undefined, filePath: string): string {
  const params = new URLSearchParams({ path: filePath })
  if (serverId) params.set('server', serverId)
  return `janus-media://play?${params.toString()}`
}

function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '0:00'
  const s = Math.floor(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`
}

function PlayerApp(): JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [ctx, setCtx] = useState<PlayerContext | null>(null)
  const [index, setIndex] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [autoplay, setAutoplay] = useState(() => localStorage.getItem('janus.player.autoplay') !== '0')
  const resumeRef = useRef<number>(0)
  const lastSaveRef = useRef(0)
  const bootedRef = useRef(false)

  const current = ctx?.items[index] ?? null

  // Boot once (StrictMode-safe).
  useEffect(() => {
    if (bootedRef.current) return
    bootedRef.current = true
    void (async () => {
      try {
        const c = await window.player.getContext()
        if (!c) {
          setError('Player context unavailable — close and try again.')
          setLoading(false)
          return
        }
        setCtx(c)
        setIndex(c.index)
        const item = c.items[c.index]
        const p = c.progress[item.key]
        resumeRef.current = p && !p.done ? p.t : 0
        setLoading(false)
      } catch (e) {
        setError((e as Error).message)
        setLoading(false)
      }
    })()
  }, [])

  const saveNow = useCallback(
    (done?: boolean) => {
      const v = videoRef.current
      if (!v || !current) return
      const t = v.currentTime
      if (!Number.isFinite(t) || t <= 0) return
      const d = Number.isFinite(v.duration) ? v.duration : undefined
      void window.player.saveProgress({
        key: current.key,
        t,
        d,
        done: done ?? (d !== undefined && d > 0 && t / d >= 0.95 ? true : undefined)
      })
    },
    [current]
  )

  // Flush on window close.
  useEffect(() => {
    const flush = (): void => saveNow()
    window.addEventListener('pagehide', flush)
    return () => window.removeEventListener('pagehide', flush)
  }, [saveNow])

  const switchTo = useCallback(
    (next: number, fromEnded = false) => {
      if (!ctx || next < 0 || next >= ctx.items.length) return
      if (fromEnded && current) {
        const v = videoRef.current
        void window.player.saveProgress({
          key: current.key,
          t: v && Number.isFinite(v.duration) ? v.duration : 0,
          d: v && Number.isFinite(v.duration) ? v.duration : undefined,
          done: true
        })
      } else {
        saveNow()
      }
      const item = ctx.items[next]
      const p: ProgressEntry | undefined = ctx.progress[item.key]
      resumeRef.current = p && !p.done ? p.t : 0
      if (p?.done) {
        // Replaying a completed episode starts from 0 and clears the mark.
        void window.player.saveProgress({ key: item.key, t: 0, done: false })
      }
      setIndex(next)
      setError(null)
    },
    [ctx, current, saveNow]
  )

  // Apply resume offset once metadata is available for the new source.
  useEffect(() => {
    const v = videoRef.current
    if (!v || !current) return
    const apply = (): void => {
      if (resumeRef.current > 3) v.currentTime = resumeRef.current
      resumeRef.current = 0
    }
    if (v.readyState >= 1) apply()
    else v.addEventListener('loadedmetadata', apply, { once: true })
    document.title = current.name
  }, [current])

  function onTimeUpdate(): void {
    const now = Date.now()
    if (now - lastSaveRef.current >= 5000) {
      lastSaveRef.current = now
      saveNow()
    }
  }

  function onEnded(): void {
    if (autoplay && ctx && index < ctx.items.length - 1) {
      switchTo(index + 1, true)
    } else if (current) {
      const v = videoRef.current
      void window.player.saveProgress({
        key: current.key,
        t: v && Number.isFinite(v.duration) ? v.duration : 0,
        d: v && Number.isFinite(v.duration) ? v.duration : undefined,
        done: true
      })
      // Refresh local mark so the sidebar shows ✓ immediately.
      setCtx((c) => (c ? { ...c, progress: { ...c.progress, [current.key]: { t: v?.duration ?? 0, d: v?.duration, done: true, at: Date.now() } } } : c))
    }
  }

  function toggleAutoplay(): void {
    const next = !autoplay
    setAutoplay(next)
    localStorage.setItem('janus.player.autoplay', next ? '1' : '0')
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-black text-sm text-slate-500">
        <Loader2 size={16} className="mr-2 animate-spin" /> Loading…
      </div>
    )
  }
  if (!ctx || !current) {
    return <div className="flex h-screen items-center justify-center bg-black text-sm text-bad">{error ?? 'Nothing to play.'}</div>
  }

  const progressOf = (key: string): ProgressEntry | undefined => ctx.progress[key]

  return (
    <div className="flex h-screen flex-col bg-black text-slate-200">
      {/* Video area */}
      <div className="relative min-h-0 flex-1 bg-black">
        <video
          ref={videoRef}
          key={current.key}
          src={mediaUrl(ctx.serverId, current.path)}
          className="h-full w-full"
          controls
          autoPlay
          onTimeUpdate={onTimeUpdate}
          onPause={() => saveNow()}
          onEnded={onEnded}
          onError={() => setError('Cannot play this file (unsupported codec or read error).')}
        />
        {error && (
          <div className="absolute inset-x-0 top-0 bg-bad/80 px-4 py-2 text-center text-xs text-white">{error}</div>
        )}
      </div>

      {/* Bottom bar */}
      <div className="flex shrink-0 items-center gap-2 border-t border-ink-600 bg-ink-800 px-3 py-2 text-xs">
        <button
          onClick={() => switchTo(index - 1)}
          disabled={index === 0}
          className="btn-ghost border border-ink-500 px-2 py-1 disabled:opacity-30"
          title="Previous episode"
        >
          <ChevronLeft size={14} />
        </button>
        <button
          onClick={() => switchTo(index + 1)}
          disabled={index >= ctx.items.length - 1}
          className="btn-ghost border border-ink-500 px-2 py-1 disabled:opacity-30"
          title="Next episode"
        >
          <ChevronRight size={14} />
        </button>
        <span className="min-w-0 flex-1 truncate px-1 text-slate-300" title={current.name}>
          <Play size={12} className="mr-1 inline text-accent" />
          {current.name}
          <span className="ml-2 text-slate-500">
            {index + 1} / {ctx.items.length}
          </span>
        </span>
        <button
          onClick={toggleAutoplay}
          className={`btn-ghost border px-2 py-1 ${autoplay ? 'border-accent/60 text-accent' : 'border-ink-500 text-slate-500'}`}
          title="Autoplay next episode"
        >
          <Repeat size={13} /> Autoplay
        </button>
      </div>

      {/* Episode list */}
      <div className="max-h-44 shrink-0 overflow-y-auto border-t border-ink-600 bg-ink-900">
        <div className="flex items-center gap-1.5 border-b border-ink-700 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          <ListVideo size={12} /> Episodes ({ctx.items.length})
        </div>
        {ctx.items.map((item, i) => {
          const p = progressOf(item.key)
          const active = i === index
          return (
            <button
              key={item.key}
              onClick={() => switchTo(i)}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs ${
                active ? 'bg-accent/15 text-white' : 'text-slate-400 hover:bg-ink-800'
              }`}
            >
              <span className="w-6 shrink-0 text-right font-mono text-[10px] text-slate-600">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate" title={item.name}>{item.name}</span>
              {p?.done ? (
                <Check size={12} className="shrink-0 text-good" />
              ) : p && p.t > 3 ? (
                <span className="shrink-0 font-mono text-[10px] text-warn">at {fmtTime(p.t)}</span>
              ) : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PlayerApp />
  </React.StrictMode>
)
