import { useState } from 'react'
import { v4 as uuid } from 'uuid'
import { useStore } from '../store'
import Modal from './Modal'
import type { Group } from '@shared/types'

const COLORS = ['#7aa2ff', '#3ecf8e', '#f0b429', '#f0506e', '#a78bfa', '#22d3ee', '#fb923c', '#94a3b8']

export default function GroupForm(): JSX.Element {
  const { editingGroup, closeGroupForm, upsertGroup, vault } = useStore()
  const [form, setForm] = useState<Group>(
    () =>
      editingGroup ?? {
        id: uuid(),
        name: '',
        parentId: null,
        color: COLORS[0],
        collapsed: false,
        order: (vault?.groups.length ?? 0) + 1
      }
  )
  const parents = (vault?.groups ?? []).filter((g) => g.id !== form.id)

  async function save(): Promise<void> {
    if (!form.name.trim()) return
    await upsertGroup(form)
    closeGroupForm()
  }

  return (
    <Modal
      title={editingGroup ? 'Edit Group' : 'New Group'}
      onClose={closeGroupForm}
      width={420}
      footer={
        <>
          <button onClick={closeGroupForm} className="btn-ghost">
            Cancel
          </button>
          <button onClick={save} disabled={!form.name.trim()} className="btn-primary">
            Save
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="label">Group name *</label>
          <input
            autoFocus
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="field"
            placeholder="Production Servers"
          />
        </div>
        <div>
          <label className="label">Parent group</label>
          <select value={form.parentId ?? ''} onChange={(e) => setForm({ ...form, parentId: e.target.value || null })} className="field">
            <option value="">— Root —</option>
            {parents.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Color</label>
          <div className="flex gap-2">
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setForm({ ...form, color: c })}
                className={`h-7 w-7 rounded-full border-2 ${form.color === c ? 'border-white' : 'border-transparent'}`}
                style={{ background: c }}
              />
            ))}
          </div>
        </div>
      </div>
    </Modal>
  )
}
