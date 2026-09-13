import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Check, ChevronLeft, ChevronRight, Gauge, ListVideo, Loader2, Play, Repeat, Star } from 'lucide-react'
import '../index.css'
import type { PlayerContext, ProgressEntry } from '@shared/media'
import { fmtFull, fmtShort } from '@shared/timefmt'

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

const RATE_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2]

function loadRate(): number {
  const raw = parseFloat(localStorage.getItem('janus.player.rate') ?? '')
  return RATE_STEPS.includes(raw) ? raw : 1
}

function PlayerApp(): JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [ctx, setCtx] = useState<PlayerContext | null>(null)
  const [index, setIndex] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [autoplay, setAutoplay] = useState(() => localStorage.getItem('janus.player.autoplay') !== '0')
  const [rate, setRate] = useState<number>(loadRate)
  // Live progress/favorite state (context only seeds them at boot).
  const [progressMap, setProgressMap] = useState<Record<string, ProgressEntry>>({})
  const [favKeys, setFavKeys] = useState<Set<string>>(new Set())
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
        setProgressMap(c.progress)
        setFavKeys(new Set(c.favoriteKeys ?? []))
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

  const updateProgress = useCallback((key: string, entry: ProgressEntry) => {
    setProgressMap((m) => ({ ...m, [key]: entry }))
  }, [])

  const saveNow = useCallback(
    (done?: boolean) => {
      const v = videoRef.current
      if (!v || !current) return
      const t = v.currentTime
      if (!Number.isFinite(t) || t <= 0) return
      const d = Number.isFinite(v.duration) ? v.duration : undefined
      const isDone = done ?? (d !== undefined && d > 0 && t / d >= 0.95 ? true : undefined)
      void window.player.saveProgress({ key: current.key, t, d, done: isDone })
      updateProgress(current.key, { t, d, done: isDone ?? progressMap[current.key]?.done, at: Date.now() })
    },
    [current, progressMap, updateProgress]
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
        const d = v && Number.isFinite(v.duration) ? v.duration : undefined
        void window.player.saveProgress({ key: current.key, t: d ?? 0, d, done: true })
        updateProgress(current.key, { t: d ?? 0, d, done: true, at: Date.now() })
      } else {
        saveNow()
      }
      const item = ctx.items[next]
      const p: ProgressEntry | undefined = progressMap[item.key]
      resumeRef.current = p && !p.done ? p.t : 0
      if (p?.done) {
        // Replaying a completed episode starts from 0 and clears the mark.
        void window.player.saveProgress({ key: item.key, t: 0, done: false })
        updateProgress(item.key, { t: 0, d: p.d, done: false, at: Date.now() })
      }
      setIndex(next)
      setError(null)
    },
    [ctx, current, saveNow, progressMap, updateProgress]
  )

  // Apply resume offset AND playback rate for every new source (load() resets
  // playbackRate to 1 — and the video element is remounted per episode).
  useEffect(() => {
    const v = videoRef.current
    if (!v || !current) return
    const apply = (): void => {
      v.playbackRate = rate
      if (resumeRef.current > 3) v.currentTime = resumeRef.current
      resumeRef.current = 0
    }
    if (v.readyState >= 1) apply()
    else v.addEventListener('loadedmetadata', apply, { once: true })
    document.title = current.name
  }, [current, rate])

  // Scroll the episode list so the current row stays visible.
  useEffect(() => {
    if (!listRef.current || !current) return
    listRef.current.querySelector(`[data-key="${CSS.escape(current.key)}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [index, current])

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
      const d = v && Number.isFinite(v.duration) ? v.duration : undefined
      void window.player.saveProgress({ key: current.key, t: d ?? 0, d, done: true })
      updateProgress(current.key, { t: d ?? 0, d, done: true, at: Date.now() })
    }
  }

  function onRateChange(): void {
    const v = videoRef.current
    // Single source of truth: native control-menu speed changes are captured too.
    if (v && Number.isFinite(v.playbackRate) && v.playbackRate !== rate) {
      setRate(v.playbackRate)
      localStorage.setItem('janus.player.rate', String(v.playbackRate))
    }
  }

  function cycleRate(): void {
    const v = videoRef.current
    const next = RATE_STEPS[(RATE_STEPS.indexOf(rate) + 1) % RATE_STEPS.length]
    setRate(next)
    localStorage.setItem('janus.player.rate', String(next))
    if (v) v.playbackRate = next
  }

  function toggleAutoplay(): void {
    const next = !autoplay
    setAutoplay(next)
    localStorage.setItem('janus.player.autoplay', next ? '1' : '0')
  }

  async function toggleFav(key: string, path: string, name: string): Promise<void> {
    try {
      const { favorited } = await window.player.toggleFavorite({ serverId: ctx?.serverId, path, name })
      setFavKeys((s) => {
        const next = new Set(s)
        if (favorited) next.add(key)
        else next.delete(key)
        return next
      })
    } catch (e) {
      setError((e as Error).message)
    }
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
          onRateChange={onRateChange}
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
          onClick={cycleRate}
          className="btn-ghost flex items-center gap-1 border border-ink-500 px-2 py-1"
          title="Playback speed (applies to all episodes)"
        >
          <Gauge size={13} /> {rate}×
        </button>
        <button
          onClick={toggleAutoplay}
          className={`btn-ghost border px-2 py-1 ${autoplay ? 'border-accent/60 text-accent' : 'border-ink-500 text-slate-500'}`}
          title="Autoplay next episode"
        >
          <Repeat size={13} /> Autoplay
        </button>
      </div>

      {/* Episode list */}
      <div ref={listRef} className="max-h-44 shrink-0 overflow-y-auto border-t border-ink-600 bg-ink-900">
        <div className="flex items-center gap-1.5 border-b border-ink-700 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          <ListVideo size={12} /> Episodes ({ctx.items.length})
        </div>
        {ctx.items.map((item, i) => {
          const p = progressMap[item.key]
          const active = i === index
          const starred = favKeys.has(item.key)
          return (
            <div
              key={item.key}
              data-key={item.key}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-xs ${
                active ? 'bg-accent/15 text-white' : 'text-slate-400 hover:bg-ink-800'
              }`}
            >
              <button onClick={() => toggleFav(item.key, item.path, item.name)} className={`shrink-0 rounded p-0.5 hover:bg-ink-500 ${starred ? 'text-warn' : 'text-slate-600 hover:text-white'}`} title={starred ? 'Remove from favorites' : 'Add to favorites'}>
                <Star size={11} fill={starred ? 'currentColor' : 'none'} />
              </button>
              <button onClick={() => switchTo(i)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                <span className="w-5 shrink-0 text-right font-mono text-[10px] text-slate-600">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate" title={item.name}>{item.name}</span>
                {p?.done ? (
                  <Check size={12} className="shrink-0 text-good" />
                ) : p && p.t > 3 ? (
                  <span className="shrink-0 font-mono text-[10px] text-warn">at {fmtTime(p.t)}</span>
                ) : null}
                <span className="w-16 shrink-0 text-right font-mono text-[10px] text-slate-600" title={p?.at ? fmtFull(p.at) : '—'}>
                  {p?.at ? fmtShort(p.at) : ''}
                </span>
              </button>
            </div>
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
