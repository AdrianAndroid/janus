import { contextBridge, ipcRenderer } from 'electron'
import type { IpcResult } from '../shared/types'
import type { ViewerContextPayload, ViewerProgressReq } from '../shared/viewer'

// Self-contained preload for viewer windows (sandbox:true forbids relative
// require of shared chunks — channel names kept in sync manually).
const IPC = {
  viewerContext: 'viewer:context',
  viewerSaveProgress: 'viewer:save-progress'
} as const

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const res = (await ipcRenderer.invoke(channel, ...args)) as IpcResult<T>
  if (!res.ok) throw new Error(res.error || 'Unknown error')
  return res.data as T
}

const api = {
  getContext: () => invoke<(ViewerContextPayload & { progress?: { page: number } }) | null>(IPC.viewerContext),
  saveProgress: (req: ViewerProgressReq) => invoke<boolean>(IPC.viewerSaveProgress, req)
}

contextBridge.exposeInMainWorld('viewer', api)

export type ViewerApi = typeof api
