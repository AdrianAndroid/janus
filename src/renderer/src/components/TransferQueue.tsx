import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, X, RotateCcw, Loader2, CheckCircle2, AlertCircle, Ban, Trash2, FolderOpen } from 'lucide-react'
import { useStore } from '../store'
import { fmtSize } from './FilePane'
import type { TransferTask } from '@shared/types'

function fmtSpeed(bytesPerSec: number): string {
  return `${fmtSize(bytesPerSec)}/s`
}

function statusBadge(t: TransferTask): JSX.Element | null {
  switch (t.status) {
    case 'done':
      return <CheckCircle2 size={13} className="shrink-0 text-good" />
    case 'error':
      return <AlertCircle size={13} className="shrink-0 text-bad" />
    case 'canceled':
      return <Ban size={13} className="shrink-0 text-slate-500" />
    case 'interrupted':
      return <AlertCircle size={13} className="shrink-0 text-warn" />
    case 'queued':
    case 'scanning':
      return <Loader2 size={13} className="shrink-0 animate-spin text-slate-400" />
    default:
      return null
  }
}

function statusText(t: TransferTask): string {
  switch (t.status) {
    case 'queued':
      return 'Queued'
    case 'scanning':
      return 'Scanning…'
    case 'waiting-conflict':
      return 'Waiting for choice…'
    case 'interrupted':
      return t.error || 'Interrupted'
    case 'error':
      return t.error || 'Failed'
    case 'canceled':
      return 'Canceled'
    case 'done':
      return 'Completed'
    default:
      return ''
  }
}

function Row({ task }: { task: TransferTask }): JSX.Element {
  const { cancelTransfer, resumeTransfer } = useStore()
  const [speed, setSpeed] = useState(0)
  const sample = useRef({ bytes: 0, time: 0 })

  useEffect(() => {
    const now = Date.now()
    const prev = sample.current
    if (prev.time && now - prev.time >= 500) {
      setSpeed(Math.max(0, Math.round(((task.transferred - prev.bytes) / (now - prev.time)) * 1000)))
      sample.current = { bytes: task.transferred, time: now }
    } else if (!prev.time) {
      sample.current = { bytes: task.transferred, time: now }
    }
    if (task.status !== 'running') setSpeed(0)
  }, [task.transferred, task.status])

  const pct = task.size > 0 ? Math.min(100, Math.round((task.transferred / task.size) * 100)) : task.status === 'done' ? 100 : 0
  const active = task.status === 'running' || task.status === 'queued' || task.status === 'scanning' || task.status === 'waiting-conflict'
  const resumable = task.status === 'interrupted' || task.status === 'error' || task.status === 'canceled'
  const info = statusText(task)

  return (
    <div className="flex items-center gap-3 px-3 py-1.5">
      {task.direction === 'upload' ? (
        <ArrowUp size={13} className="shrink-0 text-accent" />
      ) : (
        <ArrowDown size={13} className="shrink-0 text-good" />
      )}
      {task.isDir && <FolderOpen size={12} className="shrink-0 text-slate-500" />}
      <span className="w-44 truncate text-xs text-slate-200" title={task.name}>
        {task.name}
      </span>
      <div className="relative h-1.5 min-w-0 flex-1 overflow-hidden rounded bg-ink-600">
        <div
          className={`absolute inset-y-0 left-0 rounded transition-all ${
            task.status === 'error' || task.status === 'interrupted' ? 'bg-warn' : task.status === 'done' ? 'bg-good' : 'bg-accent'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-24 shrink-0 text-right font-mono text-[10px] text-slate-400">
        {fmtSize(task.transferred)} / {fmtSize(task.size)}
      </span>
      <span className="w-16 shrink-0 text-right font-mono text-[10px] text-slate-500">
        {task.status === 'running' && speed > 0 ? fmtSpeed(speed) : `${pct}%`}
      </span>
      <span className="flex w-40 shrink-0 items-center gap-1.5 truncate text-[10px] text-slate-500" title={info}>
        {statusBadge(task)}
        <span className="truncate">{info}</span>
      </span>
      <span className="flex shrink-0 gap-1">
        {active && (
          <button onClick={() => cancelTransfer(task.id)} className="rounded p-1 text-slate-400 hover:bg-bad hover:text-white" title="Cancel">
            <X size={12} />
          </button>
        )}
        {resumable && (
          <button onClick={() => resumeTransfer(task.id)} className="rounded p-1 text-slate-400 hover:bg-ink-500 hover:text-white" title="Resume">
            <RotateCcw size={12} />
          </button>
        )}
      </span>
    </div>
  )
}

export default function TransferQueue(): JSX.Element | null {
  const { transfers, clearFinishedTransfers } = useStore()
  if (transfers.length === 0) return null
  const finished = transfers.some((t) => ['done', 'error', 'canceled'].includes(t.status))
  return (
    <div className="max-h-44 shrink-0 overflow-y-auto border-t border-ink-600 bg-ink-800">
      <div className="flex items-center justify-between border-b border-ink-700 px-3 py-1">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Transfers</span>
        {finished && (
          <button onClick={() => clearFinishedTransfers()} className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-300">
            <Trash2 size={11} /> Clear finished
          </button>
        )}
      </div>
      {transfers.map((t) => (
        <Row key={t.id} task={t} />
      ))}
    </div>
  )
}
