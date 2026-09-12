import { contextBridge, ipcRenderer } from 'electron'
import type { IpcResult } from '../shared/types'

// Self-contained preload for VNC popout windows (sandbox:true forbids
// relative require of shared chunks — channel name kept in sync manually).
const IPC = { vncContext: 'vnc:context' } as const

export interface VncContext {
  title: string
  wsPort: number
  password: string
}

const api = {
  getContext: async (): Promise<VncContext | null> => {
    const res = (await ipcRenderer.invoke(IPC.vncContext)) as IpcResult<VncContext | null>
    if (!res.ok) throw new Error(res.error || 'Unknown error')
    return res.data ?? null
  }
}

contextBridge.exposeInMainWorld('vnc', api)

export type VncApi = typeof api
