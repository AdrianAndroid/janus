import { contextBridge, ipcRenderer } from 'electron'
import type { IpcResult } from '../shared/types'
import type { PlayerContext, SaveProgressReq } from '../shared/media'

// Self-contained preload for the video player window (sandbox:true forbids
// relative require of shared chunks — channel names kept in sync manually).
const IPC = {
  playerContext: 'player:context',
  playerSaveProgress: 'player:save-progress',
  videoFavList: 'videoFav:list',
  videoFavToggle: 'videoFav:toggle',
  videoFavRemove: 'videoFav:remove'
} as const

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const res = (await ipcRenderer.invoke(channel, ...args)) as IpcResult<T>
  if (!res.ok) throw new Error(res.error || 'Unknown error')
  return res.data as T
}

const api = {
  getContext: () => invoke<PlayerContext | null>(IPC.playerContext),
  saveProgress: (req: SaveProgressReq) => invoke<boolean>(IPC.playerSaveProgress, req),
  listFavorites: () => invoke<import('../shared/video-favorites').VideoFavoriteView[]>(IPC.videoFavList),
  toggleFavorite: (req: { serverId?: string; path: string; name?: string }) =>
    invoke<{ favorited: boolean }>(IPC.videoFavToggle, req),
  removeFavorite: (id: string) => invoke<boolean>(IPC.videoFavRemove, { id })
}

contextBridge.exposeInMainWorld('player', api)

export type PlayerApi = typeof api
