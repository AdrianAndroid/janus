import { create } from 'zustand'
import type {
  DeleteOperation,
  DeletePlan,
  DirectoryView,
  DiskContext,
  DiskEvent,
  ScanSnapshot
} from '@shared/disk-usage'

// Standalone lightweight store for the analysis window — intentionally
// separate from the main window's vault store (different renderer process).

export type SortBy = 'size' | 'name' | 'mtime'
export type SortOrder = 'asc' | 'desc'

interface DiskUsageState {
  context: DiskContext | null
  draftRootPath: string
  scanRootPath: string
  snapshot: ScanSnapshot | null
  view: DirectoryView | null
  viewNodeId: string | null
  viewLoading: boolean
  error: string | null
  eventSeq: number

  offset: number
  limit: number
  sortBy: SortBy
  order: SortOrder
  nameFilter: string

  selection: Set<string>
  browseOpen: boolean
  warningsOpen: boolean
  deletePlan: DeletePlan | null
  deleteOp: DeleteOperation | null
  deleteRunning: boolean
  /** New entry request while this window is busy. */
  pathRequest: string | null

  setContext: (c: DiskContext) => void
  setDraftRootPath: (p: string) => void
  setSnapshot: (s: ScanSnapshot | null) => void
  setView: (v: DirectoryView | null) => void
  setViewNodeId: (id: string | null) => void
  setViewLoading: (b: boolean) => void
  setError: (e: string | null) => void
  setEventSeq: (n: number) => void
  setQuery: (q: Partial<Pick<DiskUsageState, 'offset' | 'limit' | 'sortBy' | 'order' | 'nameFilter'>>) => void
  setSelection: (s: Set<string>) => void
  setBrowseOpen: (b: boolean) => void
  setWarningsOpen: (b: boolean) => void
  setDeletePlan: (p: DeletePlan | null) => void
  setDeleteOp: (o: DeleteOperation | null) => void
  setDeleteRunning: (b: boolean) => void
  setPathRequest: (p: string | null) => void
  applyEvent: (e: DiskEvent) => void
}

export const useDiskStore = create<DiskUsageState>((set, get) => ({
  context: null,
  draftRootPath: '',
  scanRootPath: '',
  snapshot: null,
  view: null,
  viewNodeId: null,
  viewLoading: false,
  error: null,
  eventSeq: 0,

  offset: 0,
  limit: 200,
  sortBy: 'size',
  order: 'desc',
  nameFilter: '',

  selection: new Set<string>(),
  browseOpen: false,
  warningsOpen: false,
  deletePlan: null,
  deleteOp: null,
  deleteRunning: false,
  pathRequest: null,

  setContext: (c) => set({ context: c, draftRootPath: c.initialPath ?? '' }),
  setDraftRootPath: (p) => set({ draftRootPath: p }),
  setSnapshot: (s) => set({ snapshot: s, scanRootPath: s?.rootPath ?? get().scanRootPath }),
  setView: (v) => set({ view: v }),
  setViewNodeId: (id) => set({ viewNodeId: id, offset: 0, selection: new Set() }),
  setViewLoading: (b) => set({ viewLoading: b }),
  setError: (e) => set({ error: e }),
  setEventSeq: (n) => set({ eventSeq: n }),
  setQuery: (q) => set(q),
  setSelection: (s) => set({ selection: s }),
  setBrowseOpen: (b) => set({ browseOpen: b }),
  setWarningsOpen: (b) => set({ warningsOpen: b }),
  setDeletePlan: (p) => set({ deletePlan: p }),
  setDeleteOp: (o) => set({ deleteOp: o }),
  setDeleteRunning: (b) => set({ deleteRunning: b }),
  setPathRequest: (p) => set({ pathRequest: p }),

  applyEvent: (e) => {
    const s = get()
    if (e.type === 'path-request') {
      const busy = s.snapshot && ['starting', 'scanning', 'canceling'].includes(s.snapshot.state)
      if (busy || s.deleteRunning) set({ pathRequest: e.payload.requestedPath ?? null })
      else if (e.payload.requestedPath) set({ draftRootPath: e.payload.requestedPath })
      return
    }
    if (e.scanId && s.snapshot && e.scanId !== s.snapshot.scanId) return
    if (e.seq <= s.eventSeq) return
    set({ eventSeq: e.seq })
    if (!s.snapshot) return
    const snap = { ...s.snapshot }
    if (e.type === 'progress') {
      snap.scannedFiles = e.payload.scannedFiles ?? snap.scannedFiles
      snap.scannedDirs = e.payload.scannedDirs ?? snap.scannedDirs
      snap.knownBytes = e.payload.knownBytes ?? snap.knownBytes
      snap.warningCount = e.payload.warningCount ?? snap.warningCount
      snap.currentPath = e.payload.currentPath
    } else if (e.type === 'state') {
      snap.state = e.payload.state ?? snap.state
      snap.revision = e.revision
      if (e.payload.finishedAt) snap.finishedAt = e.payload.finishedAt
      if (e.payload.limitReason) snap.limitReason = e.payload.limitReason
      if (e.payload.stale !== undefined) snap.stale = e.payload.stale
    } else if (e.type === 'delete-progress') {
      const op = s.deleteOp
      if (op && e.payload.operationId === op.operationId) {
        // Results stream in via deleteSnapshot polling after finish; here
        // we only track counters.
        set({ deleteOp: { ...op } })
      }
    }
    snap.revision = Math.max(snap.revision, e.revision)
    set({ snapshot: snap })
  }
}))
