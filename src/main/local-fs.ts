import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import type { SftpEntry } from '@shared/types'

// Local filesystem access for the dual-pane file manager. Runs in the main
// process with the user's own privileges — same trust level as paths picked
// through the native open/save dialogs.

function toEntry(name: string, full: string, st: import('fs').Stats, isLink: boolean): SftpEntry {
  let type: SftpEntry['type'] = 'other'
  if (st.isDirectory()) type = 'directory'
  else if (st.isFile()) type = 'file'
  else if (isLink) type = 'symlink'
  return {
    name,
    path: full,
    type,
    size: st.size,
    mtime: st.mtimeMs,
    mode: st.mode,
    owner: st.uid,
    group: st.gid
  }
}

export async function localHome(): Promise<string> {
  return os.homedir()
}

export async function localList(target: string): Promise<{ cwd: string; entries: SftpEntry[] }> {
  const cwd = path.resolve(target && target.trim() ? target : os.homedir())
  const dirents = await fs.readdir(cwd, { withFileTypes: true })
  const entries: SftpEntry[] = []
  for (const d of dirents) {
    const full = path.join(cwd, d.name)
    try {
      // lstat so symlinks are reported as links, not followed
      const st = await fs.lstat(full)
      entries.push(toEntry(d.name, full, st, st.isSymbolicLink()))
    } catch {
      // Entry vanished or is unreadable (permissions) — skip it.
    }
  }
  entries.sort((a, b) => {
    if (a.type === 'directory' && b.type !== 'directory') return -1
    if (a.type !== 'directory' && b.type === 'directory') return 1
    return a.name.localeCompare(b.name)
  })
  return { cwd, entries }
}

export async function localMkdir(target: string): Promise<void> {
  await fs.mkdir(target, { recursive: true })
}

export async function localRename(from: string, to: string): Promise<void> {
  await fs.rename(from, to)
}

export async function localRemove(target: string): Promise<void> {
  await fs.rm(target, { recursive: true, force: true })
}

export async function localStat(target: string): Promise<SftpEntry | null> {
  try {
    const st = await fs.lstat(target)
    return toEntry(path.basename(target), target, st, st.isSymbolicLink())
  } catch {
    return null
  }
}

/** Recursive disk usage of a folder. Symlinks are not followed. */
export async function localDirSize(target: string): Promise<number> {
  let total = 0
  const walk = async (dir: string): Promise<void> => {
    const dirents = await fs.readdir(dir, { withFileTypes: true })
    for (const d of dirents) {
      const full = path.join(dir, d.name)
      if (d.isDirectory()) {
        await walk(full)
      } else if (d.isFile()) {
        try {
          total += (await fs.lstat(full)).size
        } catch {
          /* vanished — skip */
        }
      }
    }
  }
  await walk(target)
  return total
}
