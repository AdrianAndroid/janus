import { contextBridge, ipcRenderer } from 'electron'
import type { IpcResult } from '../shared/types'

// Channel names inlined on purpose: this preload runs with sandbox:true,
// where relative require() (e.g. shared chunks) is not allowed — the bundle
// must stay fully self-contained. Keep in sync with src/shared/ipc.ts disk:*.
const IPC = {
  diskContext: 'disk:context',
  diskBrowse: 'disk:browse',
  diskStart: 'disk:start',
  diskCancel: 'disk:cancel',
  diskSnapshot: 'disk:snapshot',
  diskDirectory: 'disk:directory',
  diskWarnings: 'disk:warnings',
  diskPrepareDelete: 'disk:prepare-delete',
  diskExecuteDelete: 'disk:execute-delete',
  diskCancelDelete: 'disk:cancel-delete',
  diskDeleteSnapshot: 'disk:delete-snapshot',
  diskOpenInFiles: 'disk:open-in-files',
  diskEvent: 'disk:event'
} as const
import type {
  BrowseResult,
  DeleteOperation,
  DeletePlan,
  DirectoryQuery,
  DirectoryView,
  DiskContext,
  DiskEvent,
  ScanSnapshot,
  WarningsPage
} from '../shared/disk-usage'

// Bridge for the Disk Usage analysis window. No ipcRenderer, no vault, no
// server profiles — only the typed diskUsage surface.

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const res = (await ipcRenderer.invoke(channel, ...args)) as IpcResult<T>
  if (!res.ok) {
    const err = new Error(res.error || 'Unknown error') as Error & { code?: string }
    err.code = res.code
    throw err
  }
  return res.data as T
}

const api = {
  getContext: () => invoke<DiskContext | null>(IPC.diskContext),
  browse: (req: { path?: string }) => invoke<BrowseResult>(IPC.diskBrowse, req),
  start: (req: { rootPath: string }) => invoke<ScanSnapshot>(IPC.diskStart, req),
  cancel: (req: { scanId: string }) => invoke<boolean>(IPC.diskCancel, req),
  snapshot: (req: { scanId?: string }) => invoke<ScanSnapshot | null>(IPC.diskSnapshot, req),
  directory: (query: DirectoryQuery) => invoke<DirectoryView>(IPC.diskDirectory, query),
  warnings: (req: { scanId: string; offset?: number; limit?: number }) => invoke<WarningsPage>(IPC.diskWarnings, req),
  prepareDelete: (req: { scanId: string; revision: number; nodeIds: string[] }) =>
    invoke<DeletePlan>(IPC.diskPrepareDelete, req),
  executeDelete: (req: { planId: string }) => invoke<{ operationId: string }>(IPC.diskExecuteDelete, req),
  cancelDelete: (req: { operationId: string }) => invoke<boolean>(IPC.diskCancelDelete, req),
  deleteSnapshot: (req: { operationId: string }) => invoke<DeleteOperation>(IPC.diskDeleteSnapshot, req),
  openInFiles: (req: { scanId: string; nodeId: string }) => invoke<boolean>(IPC.diskOpenInFiles, req),
  onEvent: (cb: (event: DiskEvent) => void) => {
    const listener = (_e: unknown, payload: DiskEvent): void => cb(payload)
    ipcRenderer.on(IPC.diskEvent, listener)
    return () => {
      ipcRenderer.removeListener(IPC.diskEvent, listener)
    }
  }
}

contextBridge.exposeInMainWorld('diskUsage', api)

export type DiskUsageApi = typeof api
