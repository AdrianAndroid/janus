import type {
  DirectoryQuery,
  DirectoryView,
  DiskNode,
  ScanWarning,
  TreemapChild
} from '@shared/disk-usage'
import { DISK_LIMITS } from '@shared/disk-usage'

export interface StoredNode extends DiskNode {
  ownBytes: number
  dev?: string
  ino?: string
  /** ns timestamps as strings — they exceed Number.MAX_SAFE_INTEGER. */
  mtimeNs?: string | null
  size?: number
}

/** Raw record accepted from scanners (local walker or remote protocol). */
export interface NodeRecord {
  id: string
  parentId?: string | null
  name?: string
  rel?: string
  kind?: DiskNode['kind']
  ownBytes?: number
  knownBytes?: number
  coverage?: DiskNode['coverage']
  childCount?: number
  fileCount?: number
  mtimeMs?: number | null
  issueCount?: number
  selectable?: boolean
  dev?: string
  ino?: string
  mtimeNs?: string | null
  size?: number
}

export interface ResolvedTarget {
  nodeId: string
  path: string
  knownBytes: number
  partial: boolean
  expect: { dev: string; ino: string; kind: DiskNode['kind']; size: number | null; mtimeNs: string | null }
}

/**
 * Flat node index for one scan. Single copy of node data; children are id
 * lists. Upserts replace the previous summary (no double-counted deltas).
 */
export class DiskIndex {
  readonly nodes = new Map<string, StoredNode>()
  private childMap = new Map<string, string[]>()
  rootId = ''
  rootPath = ''
  revision = 0
  readonly warnings: ScanWarning[] = []
  warningOverflow = 0
  private sortCache = new Map<string, string[]>()

  setRoot(nodeId: string, rootPath: string): void {
    this.rootId = nodeId
    this.rootPath = rootPath
  }

  upsert(rec: NodeRecord): void {
    const prev = this.nodes.get(rec.id)
    const merged: StoredNode = {
      id: rec.id,
      parentId: rec.parentId !== undefined ? rec.parentId : (prev?.parentId ?? null),
      name: rec.name ?? prev?.name ?? '',
      relativePath: rec.rel ?? prev?.relativePath ?? '',
      kind: rec.kind ?? prev?.kind ?? 'other',
      ownBytes: rec.ownBytes ?? prev?.ownBytes ?? 0,
      knownBytes: rec.knownBytes ?? prev?.knownBytes ?? 0,
      coverage: rec.coverage ?? prev?.coverage ?? 'pending',
      childCount: rec.childCount ?? prev?.childCount ?? 0,
      fileCount: rec.fileCount ?? prev?.fileCount ?? 0,
      mtimeMs: rec.mtimeMs !== undefined ? rec.mtimeMs : (prev?.mtimeMs ?? null),
      issueCount: rec.issueCount ?? prev?.issueCount ?? 0,
      selectable: rec.selectable ?? prev?.selectable ?? true,
      dev: rec.dev ?? prev?.dev,
      ino: rec.ino ?? prev?.ino,
      mtimeNs: rec.mtimeNs ?? prev?.mtimeNs,
      size: rec.size ?? prev?.size
    }
    if (!prev && merged.parentId) {
      const list = this.childMap.get(merged.parentId) ?? []
      list.push(merged.id)
      this.childMap.set(merged.parentId, list)
    }
    this.nodes.set(merged.id, merged)
  }

  /** Bump revision after each applied batch; invalidates sorted caches. */
  commitBatch(): void {
    this.revision += 1
    this.sortCache.clear()
  }

  addWarning(w: ScanWarning): void {
    if (this.warnings.length < DISK_LIMITS.maxWarnings) this.warnings.push(w)
    else this.warningOverflow += 1
  }

  warningsPage(offset: number, limit: number): { warnings: ScanWarning[]; total: number } {
    return {
      warnings: this.warnings.slice(offset, offset + limit),
      total: this.warnings.length + this.warningOverflow
    }
  }

  private sortIds(nodeId: string, sortBy: DirectoryQuery['sortBy'], order: DirectoryQuery['order'], filter: string): string[] {
    const key = `${nodeId}:${sortBy}:${order}:${filter}`
    const cached = this.sortCache.get(key)
    if (cached) return cached
    const ids = (this.childMap.get(nodeId) ?? []).filter((id) => {
      if (!filter) return true
      return (this.nodes.get(id)?.name ?? '').toLowerCase().includes(filter)
    })
    const dir = order === 'asc' ? 1 : -1
    ids.sort((a, b) => {
      const na = this.nodes.get(a)!
      const nb = this.nodes.get(b)!
      // Directories always before non-directories; sort field applies within.
      const da = na.kind === 'directory' ? 0 : 1
      const db = nb.kind === 'directory' ? 0 : 1
      if (da !== db) return da - db
      let cmp = 0
      if (sortBy === 'size') cmp = na.knownBytes - nb.knownBytes
      else if (sortBy === 'name') cmp = na.name.localeCompare(nb.name)
      else cmp = (na.mtimeMs ?? 0) - (nb.mtimeMs ?? 0)
      if (cmp === 0) cmp = na.name.localeCompare(nb.name)
      return cmp * dir
    })
    this.sortCache.set(key, ids)
    return ids
  }

  private publicNode(n: StoredNode): DiskNode {
    const { ownBytes: _o, dev: _d, ino: _i, mtimeNs: _m, size: _s, ...rest } = n
    return rest
  }

  breadcrumbs(nodeId: string): Array<{ id: string; name: string }> {
    const trail: Array<{ id: string; name: string }> = []
    let cur: string | null = nodeId
    while (cur) {
      const n = this.nodes.get(cur)
      if (!n) break
      trail.unshift({ id: n.id, name: n.id === this.rootId ? this.rootPath : n.name })
      cur = n.parentId
    }
    return trail
  }

  treemap(nodeId: string): TreemapChild[] {
    const ids = this.childMap.get(nodeId) ?? []
    const all = ids
      .map((id) => this.nodes.get(id)!)
      .filter(Boolean)
      .sort((a, b) => b.knownBytes - a.knownBytes)
    const max = DISK_LIMITS.treemapMaxNodes - 1
    const top = all.slice(0, max)
    const rest = all.slice(max)
    const out: TreemapChild[] = top.map((n) => ({
      id: n.id,
      name: n.name,
      knownBytes: n.knownBytes,
      kind: n.kind,
      synthetic: false
    }))
    if (rest.length > 0) {
      const restBytes = rest.reduce((sum, n) => sum + (n.knownBytes > 0 ? n.knownBytes : 0), 0)
      out.push({
        id: `__other__:${nodeId}`,
        name: `Other (${rest.length} items)`,
        knownBytes: restBytes,
        kind: 'other',
        synthetic: true
      })
    }
    return out
  }

  query(q: DirectoryQuery): DirectoryView {
    const dir = this.nodes.get(q.nodeId)
    if (!dir) throw new Error('PATH_NOT_FOUND: unknown node')
    const filter = (q.nameFilter ?? '').toLowerCase()
    const sorted = this.sortIds(q.nodeId, q.sortBy, q.order, filter)
    const limit = Math.min(Math.max(q.limit || DISK_LIMITS.directoryPageDefault, 1), DISK_LIMITS.directoryPageMax)
    const page = sorted.slice(q.offset, q.offset + limit)
    return {
      scanId: q.scanId,
      revision: this.revision,
      directory: this.publicNode(dir),
      breadcrumbs: this.breadcrumbs(q.nodeId),
      entries: page.map((id) => this.publicNode(this.nodes.get(id)!)),
      totalMatches: sorted.length,
      totalChildren: (this.childMap.get(q.nodeId) ?? []).length,
      treemap: this.treemap(q.nodeId)
    }
  }

  absolutePath(n: StoredNode): string {
    if (n.id === this.rootId) return this.rootPath
    return `${this.rootPath.replace(/\/+$/, '')}/${n.relativePath.split('/').join('/')}`
  }

  /** Resolve renderer-supplied nodeIds into verified delete candidates. */
  resolveForDelete(nodeIds: string[]): { targets: ResolvedTarget[]; rejected: Array<{ nodeId: string; reason: string }> } {
    const targets: ResolvedTarget[] = []
    const rejected: Array<{ nodeId: string; reason: string }> = []
    const seen = new Set<string>()

    const sorted = [...nodeIds].sort((a, b) => {
      const pa = this.nodes.get(a)?.relativePath ?? ''
      const pb = this.nodes.get(b)?.relativePath ?? ''
      return pa.length - pb.length
    })

    for (const id of sorted) {
      const n = this.nodes.get(id)
      if (!n) {
        rejected.push({ nodeId: id, reason: 'Unknown node' })
        continue
      }
      if (id === this.rootId) {
        rejected.push({ nodeId: id, reason: 'Cannot delete the scan root' })
        continue
      }
      if (!n.selectable) {
        rejected.push({ nodeId: id, reason: 'Unsupported filename' })
        continue
      }
      if (n.coverage === 'excluded') {
        rejected.push({ nodeId: id, reason: 'Excluded (mount boundary)' })
        continue
      }
      const abs = this.absolutePath(n)
      // Skip descendants of an already-selected ancestor.
      let skip = false
      for (const chosen of seen) {
        if (abs.startsWith(chosen.endsWith('/') ? chosen : chosen + '/')) {
          skip = true
          break
        }
      }
      if (skip) {
        rejected.push({ nodeId: id, reason: 'Covered by a selected parent' })
        continue
      }
      seen.add(abs)
      targets.push({
        nodeId: id,
        path: abs,
        knownBytes: n.knownBytes,
        partial: n.coverage === 'partial' || n.issueCount > 0,
        expect: {
          dev: n.dev ?? '',
          ino: n.ino ?? '',
          kind: n.kind,
          size: n.kind === 'file' ? n.ownBytes : null,
          mtimeNs: n.mtimeNs ?? null
        }
      })
    }
    return { targets, rejected }
  }
}
