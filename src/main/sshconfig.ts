import { readFile, writeFile, mkdir } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import type { ParsedSshHost, ServerProfile } from '@shared/types'

const configPath = (): string => join(homedir(), '.ssh', 'config')

const MARK_START = '# >>> Janus (auto-generated) >>>'
const MARK_END = '# <<< Janus <<<'

/** Parse ~/.ssh/config into concrete host entries (skips wildcards). */
export async function importSshConfig(): Promise<ParsedSshHost[]> {
  let raw: string
  try {
    raw = await readFile(configPath(), 'utf8')
  } catch {
    throw new Error('~/.ssh/config not found.')
  }

  const lines = raw.split('\n')
  const blocks: Record<string, string>[] = []
  let current: Record<string, string> | null = null

  for (const line of lines) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const m = t.match(/^(\S+)\s+(.+)$/)
    if (!m) continue
    const key = m[1].toLowerCase()
    const val = m[2].trim()
    if (key === 'host') {
      // Host can list multiple aliases; take the first non-glob.
      const alias = val.split(/\s+/).find((a) => !a.includes('*') && !a.includes('?'))
      if (alias) {
        current = { host: alias }
        blocks.push(current)
      } else {
        current = null
      }
    } else if (current) {
      current[key] = val
    }
  }

  const results: ParsedSshHost[] = []
  for (const b of blocks) {
    const name = b.host
    const hostName = b.hostname || b.host
    if (!hostName || hostName.includes('*')) continue
    let privateKey: string | undefined
    let authMethod: ParsedSshHost['authMethod'] = 'agent'
    if (b.identityfile) {
      const p = b.identityfile.replace(/^~(?=\/)/, homedir())
      try {
        privateKey = await readFile(p, 'utf8')
        authMethod = 'key'
      } catch {
        /* key not readable; fall back to agent */
      }
    }
    results.push({
      name,
      host: hostName,
      port: Number(b.port) || 22,
      username: b.user || 'root',
      privateKey,
      authMethod
    })
  }
  return results
}

/** Write the given servers into a managed block of ~/.ssh/config, preserving the rest. */
export async function exportSshConfig(servers: ServerProfile[]): Promise<string> {
  const path = configPath()
  await mkdir(join(homedir(), '.ssh'), { recursive: true })

  let existing = ''
  try {
    existing = await readFile(path, 'utf8')
  } catch {
    /* new file */
  }
  // Strip any previous Janus block.
  const startIdx = existing.indexOf(MARK_START)
  if (startIdx >= 0) {
    const endIdx = existing.indexOf(MARK_END, startIdx)
    if (endIdx >= 0) existing = existing.slice(0, startIdx).trimEnd() + '\n' + existing.slice(endIdx + MARK_END.length + 1)
  }

  const block = servers
    .map((s) => {
      const lines = [`Host ${s.name.replace(/\s+/g, '-')}`, `    HostName ${s.host}`, `    User ${s.username}`, `    Port ${s.port || 22}`]
      if (s.jumpHostId) {
        const jump = servers.find((x) => x.id === s.jumpHostId)
        if (jump) lines.push(`    ProxyJump ${jump.name.replace(/\s+/g, '-')}`)
      }
      return lines.join('\n')
    })
    .join('\n\n')

  const managed = `${MARK_START}\n# This block is managed by Janus — manual edits may not persist.\n\n${block}\n\n${MARK_END}\n`
  const next = (existing.trimEnd() + '\n\n' + managed).trimStart()
  await writeFile(path, next, { encoding: 'utf8', mode: 0o600 })
  return path
}
