// Video favorites — types and pure array operations (unit-testable).
// Storage lives in the MAIN process (userData/video-favorites.json) because
// player windows are separate renderer processes — one writer, no races.

import type { ProgressEntry } from './media'

export interface VideoFavorite {
  id: string
  serverId?: string
  path: string
  name: string
  addedAt: number
}

export interface VideoFavoriteView extends VideoFavorite {
  /** From media-progress.json (merged by key). */
  lastWatchedAt?: number
  done?: boolean
  resumeT?: number
}

export function videoFavKey(serverId: string | undefined, path: string): string {
  return serverId ? `${serverId}:${path}` : path
}

export function isVideoFav(list: VideoFavorite[], serverId: string | undefined, path: string): boolean {
  return list.some((f) => videoFavKey(f.serverId, f.path) === videoFavKey(serverId, path))
}

/** Add when missing, remove when present. Returns [nextList, favorited]. */
export function toggleVideoFav(
  list: VideoFavorite[],
  serverId: string | undefined,
  path: string,
  name: string,
  makeId: () => string
): [VideoFavorite[], boolean] {
  if (isVideoFav(list, serverId, path)) {
    return [list.filter((f) => videoFavKey(f.serverId, f.path) !== videoFavKey(serverId, path)), false]
  }
  return [[...list, { id: makeId(), serverId, path, name, addedAt: Date.now() }], true]
}

export function removeVideoFav(list: VideoFavorite[], id: string): VideoFavorite[] {
  return list.filter((f) => f.id !== id)
}

/** Merge watch progress into favorites (addedAt desc). at=0 counts as never watched. */
export function mergeProgress(list: VideoFavorite[], progress: Record<string, ProgressEntry>): VideoFavoriteView[] {
  return [...list]
    .sort((a, b) => b.addedAt - a.addedAt)
    .map((f) => {
      const p = progress[videoFavKey(f.serverId, f.path)]
      return {
        ...f,
        lastWatchedAt: p && p.at > 0 ? p.at : undefined,
        done: p?.done,
        resumeT: p && !p.done && p.t > 0 ? p.t : undefined
      }
    })
}

/** Keys of all favorites (for marking player playlist rows). */
export function favoriteKeys(list: VideoFavorite[]): string[] {
  return list.map((f) => videoFavKey(f.serverId, f.path))
}
