import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import Modal from './Modal'
import { useStore } from '../store'
import { fmtSize } from './FilePane'
import type { TransferConflict } from '@shared/types'

export default function ConflictModal({ conflict }: { conflict: TransferConflict }): JSX.Element {
  const { resolveConflict } = useStore()
  const [remember, setRemember] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [newName, setNewName] = useState(conflict.name)

  const dirWord = conflict.direction === 'upload' ? 'on the server' : 'locally'

  return (
    <Modal title="File already exists" onClose={() => resolveConflict(conflict.taskId, 'skip', false)} width={460}>
      <div className="flex items-start gap-3">
        <AlertTriangle size={20} className="mt-0.5 shrink-0 text-warn" />
        <div className="min-w-0 text-sm text-slate-300">
          <p className="break-all font-medium text-white">{conflict.name}</p>
          <p className="mt-1 text-xs text-slate-400">
            Already exists {dirWord} ({fmtSize(conflict.targetSize)}), source is {fmtSize(conflict.sourceSize)}.
          </p>
        </div>
      </div>

      {renaming ? (
        <div className="mt-4 flex items-center gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="field flex-1"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newName.trim()) resolveConflict(conflict.taskId, 'rename', false, newName.trim())
            }}
          />
          <button
            onClick={() => newName.trim() && resolveConflict(conflict.taskId, 'rename', false, newName.trim())}
            className="btn-primary"
          >
            Rename
          </button>
        </div>
      ) : (
        <>
          <label className="mt-4 flex cursor-pointer items-center gap-2 text-xs text-slate-400">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="accent-accent" />
            Remember my choice for this session
          </label>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button onClick={() => resolveConflict(conflict.taskId, 'skip', remember)} className="btn-ghost border border-ink-500">
              Skip
            </button>
            <button onClick={() => setRenaming(true)} className="btn-ghost border border-ink-500">
              Rename…
            </button>
            {conflict.canResume && (
              <button
                onClick={() => resolveConflict(conflict.taskId, 'resume', remember)}
                className="btn-ghost border border-accent/60 text-accent"
                title="Continue from the existing byte offset"
              >
                Resume
              </button>
            )}
            <button onClick={() => resolveConflict(conflict.taskId, 'overwrite', remember)} className="btn-primary">
              Overwrite
            </button>
          </div>
        </>
      )}
    </Modal>
  )
}
