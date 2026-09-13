import { app } from 'electron'
import { randomUUID } from 'crypto'
import path from 'path'
import { readFileSync, writeFileSync } from 'fs'
import type { VideoFavorite, VideoFavoriteView } from '@shared/video-favorites'
import { favoriteKeys, mergeProgress, removeVideoFav, toggleVideoFav } from '@shared/video-favorites'
import { readProgressMap } from './media'

/**
 * Main-process-owned video favorites store (userData/video-favorites.json).
 * Player windows are separate renderer processes, so both they and the main
 * window go through IPC — this store is the single writer, no races.
 */
export class VideoFavoritesStore {
  private file(): string {
    return path.join(app.getPath('userData'), 'video-favorites.json')
  }

  private read(): VideoFavorite[] {
    try {
      const raw = JSON.parse(readFileSync(this.file(), 'utf8')) as unknown
      return Array.isArray(raw) ? (raw as VideoFavorite[]) : []
    } catch {
      return []
    }
  }

  private write(list: VideoFavorite[]): void {
    try {
      writeFileSync(this.file(), JSON.stringify(list))
    } catch {
      /* ignore quota/fs errors */
    }
  }

  list(): VideoFavoriteView[] {
    return mergeProgress(this.read(), readProgressMap())
  }

  keys(): string[] {
    return favoriteKeys(this.read())
  }

  toggle(serverId: string | undefined, path: string, name: string): { favorited: boolean } {
    const [next, favorited] = toggleVideoFav(this.read(), serverId, path, name, () => randomUUID())
    this.write(next)
    return { favorited }
  }

  remove(id: string): void {
    this.write(removeVideoFav(this.read(), id))
  }
}
