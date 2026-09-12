import { app, shell } from 'electron'
import { writeFile } from 'fs/promises'
import { join } from 'path'
import { spawn } from 'child_process'
import type { ServerProfile } from '@shared/types'

function rdpFileContent(host: string, port: number, user: string): string {
  return [
    `full address:s:${host}:${port}`,
    user ? `username:s:${user}` : '',
    'prompt for credentials:i:1',
    'administrative session:i:0',
    'screen mode id:i:2',
    'authentication level:i:0',
    'redirectclipboard:i:1'
  ]
    .filter(Boolean)
    .join('\r\n')
}

/**
 * Opens the OS's native RDP client connected to the server. This is the
 * reliable cross-platform path (native NLA/CredSSP), rather than an in-app
 * renderer which can't do modern Windows auth.
 */
export async function launchRdp(profile: ServerProfile): Promise<void> {
  const host = profile.host
  const port = profile.rdpPort || 3389
  const user = profile.rdpUsername || profile.username || ''
  const file = join(app.getPath('temp'), `janus-${profile.id}.rdp`)

  if (process.platform === 'win32') {
    await writeFile(file, rdpFileContent(host, port, user), 'utf8')
    spawn('mstsc.exe', [file], { detached: true, stdio: 'ignore' }).unref()
    return
  }

  if (process.platform === 'darwin') {
    await writeFile(file, rdpFileContent(host, port, user), 'utf8')
    const err = await shell.openPath(file)
    if (err) {
      throw new Error(
        'Microsoft Remote Desktop not found. Install it for free from the Mac App Store and try again.'
      )
    }
    return
  }

  // Linux — try common clients in order.
  const target = `${host}:${port}`
  const candidates: [string, string[]][] = [
    ['xfreerdp', [`/v:${target}`, user ? `/u:${user}` : '', '/cert:ignore'].filter(Boolean)],
    ['remmina', ['-c', `rdp://${user ? user + '@' : ''}${target}`]]
  ]
  for (const [bin, args] of candidates) {
    try {
      spawn(bin, args, { detached: true, stdio: 'ignore' }).unref()
      return
    } catch {
      /* try next */
    }
  }
  throw new Error('No RDP client found. Install xfreerdp or remmina.')
}
