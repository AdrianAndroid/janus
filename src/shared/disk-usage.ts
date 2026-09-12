// Disk Usage analyzer — shared contracts between main, preload and the
// analysis-window renderer. No Node/Electron imports allowed here.

export type DiskTarget = { kind: 'local' } | { kind: 'ssh'; serverId: string }

export type ScanState =
  | 'starting'
  | 'scanning'
  | 'canceling'
  | 'completed'
  | 'canceled'
  | 'failed'
  | 'limited'

export type Coverage = 'pending' | 'complete' | 'partial' | 'excluded'

export interface DiskNode {
  /** Valid only within its scanId. */
  id: string
  parentId: string | null
  name: string
  /** Path relative to the scan root ('' for the root). Never accepted back for delete. */
  relativePath: string
  kind: 'directory' | 'file' | 'symlink' | 'other'
  /** Logical bytes of regular files, aggregated. */
  knownBytes: number
  coverage: Coverage
  childCount: number
  fileCount: number
  mtimeMs: number | null
  issueCount: number
  selectable: boolean
}

export interface ScanSnapshot {
  scanId: string
  target: DiskTarget
  rootPath: string
  rootNodeId: string
  state: ScanState
  revision: number
  eventSeq: number
  startedAt: number
  finishedAt?: number
  scannedFiles: number
  scannedDirs: number
  knownBytes: number
  warningCount: number
  currentPath?: string
  stale: boolean
  limitReason?: 'entries' | 'memory' | 'depth' | 'protocol'
  error?: string
}

export interface DirectoryQuery {
  scanId: string
  nodeId: string
  expectedRevision?: number
  offset: number
  limit: number
  sortBy: 'size' | 'name' | 'mtime'
  order: 'asc' | 'desc'
  nameFilter?: string
}

export interface TreemapChild {
  id: string
  name: string
  knownBytes: number
  kind: DiskNode['kind']
  /** Visual aggregate node ("Other") — no real nodeId, never deletable. */
  synthetic: boolean
}

export interface DirectoryView {
  scanId: string
  revision: number
  directory: DiskNode
  breadcrumbs: Array<{ id: string; name: string }>
  entries: DiskNode[]
  totalMatches: number
  totalChildren: number
  treemap: TreemapChild[]
}

export interface ScanWarning {
  code: string
  path: string
  message: string
}

export interface WarningsPage {
  scanId: string
  warnings: ScanWarning[]
  total: number
}

// ---- Events (main -> analysis window) ----

export type DiskEventType = 'progress' | 'state' | 'delete-progress' | 'path-request' | 'files-changed-local'

export interface DiskEvent {
  version: 1
  scanId: string
  seq: number
  revision: number
  type: DiskEventType
  payload: {
    state?: ScanState
    scannedFiles?: number
    scannedDirs?: number
    knownBytes?: number
    warningCount?: number
    currentPath?: string
    finishedAt?: number
    limitReason?: ScanSnapshot['limitReason']
    stale?: boolean
    error?: string
    // delete-progress
    operationId?: string
    done?: number
    total?: number
    currentItem?: string
    finished?: boolean
    // path-request (a new entry asked this window to analyze another path)
    requestedPath?: string
  }
}

// ---- Window context ----

export interface DiskContext {
  target: DiskTarget
  /** Window title, e.g. "Disk Usage · Desktop Server". */
  title: string
  /** Subtitle, e.g. "zhaojian@192.168.2.2:22" or "This Mac". */
  subtitle: string
  initialPath?: string
  theme?: string
}

// ---- Browse (shallow, direct subdirectories only) ----

export interface BrowseResult {
  cwd: string
  parent: string | null
  dirs: Array<{ name: string; path: string }>
}

// ---- Delete ----

export interface DeletePlanTarget {
  nodeId: string
  path: string
  knownBytes: number
  partial: boolean
  /** Backend identity check (lstat at plan time). Never renderer-supplied. */
  expect: {
    dev: string
    ino: string
    kind: DiskNode['kind']
    size: number | null
    /** ns timestamps as strings — they exceed Number.MAX_SAFE_INTEGER. */
    mtimeNs: string | null
  }
}

export interface DeletePlan {
  planId: string
  scanId: string
  revision: number
  mode: 'local-trash' | 'remote-permanent'
  expiresAt: number
  targets: DeletePlanTarget[]
  rejected: Array<{ nodeId: string; reason: string }>
  estimatedBytes: number
}

export type DeleteItemStatus = 'succeeded' | 'failed' | 'not-found' | 'skipped' | 'unknown'

export interface DeleteItemResult {
  path: string
  status: DeleteItemStatus
  message?: string
}

export interface DeleteOperation {
  operationId: string
  planId: string
  state: 'running' | 'done' | 'canceling'
  results: DeleteItemResult[]
  startedAt: number
  finishedAt?: number
}

// ---- Open-in-Files (analysis window -> main window) ----

export interface OpenInFilesRequest {
  requestId: string
  target: DiskTarget
  /** Canonical directory path to navigate to. */
  path: string
  /** Entry to select inside that directory, when a file was chosen. */
  selectName?: string
  /** Files-tab context the request came from, when known. */
  sourceServerId?: string
}

// ---- Errors ----

export type DiskErrorCode =
  | 'VAULT_LOCKED'
  | 'INVALID_OWNER'
  | 'INVALID_TARGET'
  | 'PYTHON_UNAVAILABLE'
  | 'PATH_NOT_FOUND'
  | 'NOT_DIRECTORY'
  | 'PERMISSION_DENIED'
  | 'SCAN_BUSY'
  | 'SCAN_LIMIT'
  | 'PROTOCOL_ERROR'
  | 'CONNECTION_LOST'
  | 'RESULT_STALE'
  | 'PLAN_EXPIRED'
  | 'PATH_CHANGED'
  | 'OUTSIDE_ROOT'
  | 'MOUNT_BOUNDARY'
  | 'TRANSFER_CONFLICT'
  | 'TRASH_FAILED'

export class DiskError extends Error {
  constructor(
    public code: DiskErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'DiskError'
  }
}

// ---- Limits (hard caps, may be lowered after measurement) ----

export const DISK_LIMITS = {
  // Raised from 200k to 500k on 2026-09-12 per user measurement (large home
  // trees exceeded 200k). Worker heap limit raised accordingly (512 MiB).
  maxNodes: 500_000,
  maxStringBytes: 128 * 1024 * 1024,
  maxActiveScans: 2,
  maxRetainedResults: 2,
  maxDepth: 512,
  maxWarnings: 1000,
  directoryPageDefault: 200,
  directoryPageMax: 500,
  treemapMaxNodes: 300,
  deleteMaxItems: 500,
  planTtlMs: 60_000,
  maxLineBytes: 1024 * 1024,
  maxStderrBytes: 64 * 1024
} as const
