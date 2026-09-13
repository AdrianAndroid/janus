import type { DiskTarget } from '@shared/disk-usage'

// Favorites & recent folders — pure helpers (no React), unit-testable.
// Storage lives in localStorage via store.ts; these functions only transform data.

export interface FavoriteFolder {
  id: string
  target: DiskTarget
  path: string
  name: string
  addedAt: number
  /** Updated when the favorite is successfully opened. */
  lastOpenedAt?: number
}

export interface RecentFolder {
  target: DiskTarget
  path: string
  openedAt: number
}

export const RECENT_CAP = 50

export function sameTarget(a: DiskTarget, b: DiskTarget): boolean {
  if (a.kind !== b.kind) return false
  return a.kind === 'local' ? true : (a as { serverId: string }).serverId === (b as { serverId: string }).serverId
}

export function isFavorite(list: FavoriteFolder[], target: DiskTarget, path: string): boolean {
  return list.some((f) => sameTarget(f.target, target) && f.path === path)
}

/** Add when missing, remove when present (star toggle). */
export function toggleFavorite(
  list: FavoriteFolder[],
  target: DiskTarget,
  path: string,
  name: string,
  makeId: () => string
): FavoriteFolder[] {
  if (isFavorite(list, target, path)) {
    return list.filter((f) => !(sameTarget(f.target, target) && f.path === path))
  }
  return [...list, { id: makeId(), target, path, name, addedAt: Date.now() }]
}

export function removeFavorite(list: FavoriteFolder[], id: string): FavoriteFolder[] {
  return list.filter((f) => f.id !== id)
}

/** Display name: given name, else last path segment, else device-ish root label. */
export function favoriteDisplayName(f: Pick<FavoriteFolder, 'name' | 'path'>): string {
  if (f.name) return f.name
  const seg = f.path.replace(/[\\/]+$/, '').split(/[\\/]/).pop()
  return seg || '/'
}

/** Dedupe by target+path (moved to front), cap the list. Skips empty paths. */
export function recordRecent(list: RecentFolder[], target: DiskTarget, path: string, openedAt: number, cap = RECENT_CAP): RecentFolder[] {
  if (!path || !path.trim()) return list
  const rest = list.filter((r) => !(sameTarget(r.target, target) && r.path === path))
  return [{ target, path, openedAt }, ...rest].slice(0, cap)
}

/** Stable, collision-resistant-enough id for pseudo tabs (not cryptographic). */
export function hashString(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  return h.toString(36)
}

/** Pseudo-tab id for a favorite/recent folder view. */
export function folderViewTabId(source: { kind: 'favorite'; id: string } | { kind: 'recent'; target: DiskTarget; path: string }): string {
  if (source.kind === 'favorite') return `fav-${source.id}`
  const sid = source.target.kind === 'ssh' ? source.target.serverId : 'local'
  return `fav-recent-${source.target.kind}-${hashString(`${sid}:${source.path}`)}`
}
