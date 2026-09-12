import { DiskError } from '@shared/disk-usage'

/**
 * Path containment guards. Containment is decided by directory components
 * (relative-path semantics), never by naive startsWith — '/data2' must not
 * pass a '/data' root.
 */

/** POSIX-flavoured containment for remote (Linux) targets. */
export function isStrictDescendantPosix(root: string, target: string): boolean {
  const r = normalizePosix(root)
  const t = normalizePosix(target)
  if (t === r) return false
  const prefix = r === '/' ? '/' : r + '/'
  return t.startsWith(prefix)
}

export function normalizePosix(p: string): string {
  const parts = p.split('/').filter((s) => s && s !== '.')
  const out: string[] = []
  for (const part of parts) {
    if (part === '..') out.pop()
    else out.push(part)
  }
  return '/' + out.join('/')
}

/** Component-wise containment for local paths (platform separator aware). */
export function isStrictDescendantLocal(root: string, target: string): boolean {
  const r = root.replace(/[\\/]+$/, '')
  const t = target
  if (t === r) return false
  return t.startsWith(r + '/') || t.startsWith(r + '\\')
}

export function assertInsideRoot(root: string, target: string, remote: boolean): void {
  const ok = remote ? isStrictDescendantPosix(root, target) : isStrictDescendantLocal(root, target)
  if (!ok) throw new DiskError('OUTSIDE_ROOT', `Path is outside the scan root: ${target}`)
}

/** Reject obviously dangerous delete targets. */
export function assertDeletable(target: string): void {
  const t = target.trim()
  if (!t || t === '/' || t === '.' || t === '..') {
    throw new DiskError('OUTSIDE_ROOT', `Refusing to delete: ${target || '(empty)'}`)
  }
}
