import { useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { useDiskStore } from './store'
import { fmtBytes } from './DiskUsageApp'
import type { DeleteOperation } from '@shared/disk-usage'

function OpResults({ op }: { op: DeleteOperation }): JSX.Element {
  return (
    <div className="mt-3 max-h-48 overflow-y-auto rounded border border-ink-600">
      {op.results.map((r, i) => (
        <div key={i} className="flex items-center gap-2 border-b border-ink-700/50 px-3 py-1 text-[11px]">
          <span
            className={`w-20 shrink-0 font-medium ${
              r.status === 'succeeded' ? 'text-good' : r.status === 'not-found' ? 'text-slate-500' : r.status === 'skipped' ? 'text-slate-500' : 'text-bad'
            }`}
          >
            {r.status}
          </span>
          <span className="flex-1 truncate font-mono text-slate-400" title={r.path}>{r.path}</span>
          {r.message && <span className="shrink-0 text-slate-600">{r.message}</span>}
        </div>
      ))}
      {op.results.length === 0 && <div className="px-3 py-2 text-xs text-slate-500">No results yet.</div>}
    </div>
  )
}

/** Two-phase delete: plan preview (this dialog) → confirm → execute. */
export default function DiskDeleteDialog(): JSX.Element | null {
  const s = useDiskStore()
  const plan = s.deletePlan
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!plan) return null
  const op = s.deleteOp
  const isLocal = plan.mode === 'local-trash'
  const running = busy || (op && op.state !== 'done')

  async function confirm(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const { operationId } = await window.diskUsage.executeDelete({ planId: plan!.planId })
      useDiskStore.getState().setDeleteRunning(true)
      const snap = await window.diskUsage.deleteSnapshot({ operationId })
      useDiskStore.getState().setDeleteOp(snap)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  async function cancelOp(): Promise<void> {
    if (!op) return
    try {
      await window.diskUsage.cancelDelete({ operationId: op.operationId })
    } catch {
      /* already finished */
    }
  }

  function close(): void {
    const st = useDiskStore.getState()
    st.setDeletePlan(null)
    st.setDeleteOp(null)
    st.setDeleteRunning(false)
    st.setSelection(new Set())
    setBusy(false)
  }

  const finished = op?.state === 'done'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="flex max-h-[85vh] w-[640px] flex-col rounded-xl border border-ink-500 bg-ink-800 shadow-2xl">
        <div className="border-b border-ink-600 px-5 py-3">
          <h2 className="font-semibold text-white">{isLocal ? 'Move to Trash' : 'Delete Permanently'}</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {isLocal
              ? 'Items are moved to the system Trash.'
              : 'Items are permanently deleted on the server. There is no undo.'}
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
          {!op && (
            <>
              <div className="mb-2 flex items-start gap-2 text-xs text-warn">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>
                  Selected folders are deleted with ALL their current contents — including hidden files and anything the
                  scan could not read. Estimated logical size, not guaranteed reclaimable space.
                </span>
              </div>
              <div className="max-h-56 overflow-y-auto rounded border border-ink-600">
                {plan.targets.map((t) => (
                  <div key={t.nodeId} className="flex items-center gap-2 border-b border-ink-700/50 px-3 py-1.5 text-xs">
                    <span className="flex-1 truncate font-mono text-slate-300" title={t.path}>{t.path}</span>
                    {t.partial && <span className="shrink-0 rounded bg-warn/15 px-1 text-[10px] text-warn">partial</span>}
                    <span className="w-20 shrink-0 text-right font-mono text-slate-500">{fmtBytes(t.knownBytes)}</span>
                  </div>
                ))}
              </div>
              <div className="mt-2 text-xs text-slate-400">
                {plan.targets.length} item(s) · estimated {fmtBytes(plan.estimatedBytes)}
              </div>
              {plan.rejected.length > 0 && (
                <div className="mt-2 rounded border border-ink-600 px-3 py-2 text-[11px] text-slate-500">
                  {plan.rejected.length} item(s) skipped: {plan.rejected.map((r) => r.reason).join('; ')}
                </div>
              )}
            </>
          )}
          {op && (
            <>
              <div className="text-xs text-slate-400">
                {finished ? 'Operation finished.' : 'Deleting…'} {op.results.length}/{plan.targets.length}
              </div>
              <OpResults op={op} />
            </>
          )}
          {error && <div className="mt-2 rounded bg-bad/10 px-3 py-2 text-xs text-bad">{error}</div>}
          {finished && (
            <p className="mt-2 text-[11px] text-slate-500">Results are outdated. Click Start Analysis to refresh.</p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-ink-600 px-5 py-3">
          {!op && (
            <>
              <button onClick={close} className="btn-ghost">Cancel</button>
              <button
                onClick={confirm}
                disabled={running || plan.targets.length === 0}
                className="btn-primary bg-bad hover:bg-bad/90 disabled:opacity-40"
              >
                {running ? <Loader2 size={14} className="animate-spin" /> : null}
                {isLocal ? 'Move to Trash' : 'Delete Permanently'}
              </button>
            </>
          )}
          {op && !finished && (
            <button onClick={cancelOp} className="btn-ghost border border-warn/60 text-warn">
              Stop remaining
            </button>
          )}
          {op && finished && (
            <button onClick={close} className="btn-primary">Close</button>
          )}
        </div>
      </div>
    </div>
  )
}
