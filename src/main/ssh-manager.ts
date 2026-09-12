import { Client, ConnectConfig } from 'ssh2'
import type { ClientChannel } from 'ssh2'
import { createServer, Server, Socket, connect as netConnect } from 'net'
import { WebSocketServer, WebSocket } from 'ws'
import type { ServerProfile, TunnelRule, SftpEntry, SessionStatus, ServerMetrics } from '@shared/types'

type Emit = (channel: string, payload: unknown) => void

interface ShellSession {
  client: Client
  stream: ClientChannel
  serverId: string
}

interface ActiveTunnel {
  rule: TunnelRule
  client: Client
  server?: Server // for local / dynamic forwards
}

/**
 * Builds an ssh2 ConnectConfig from a profile. Optionally tunnels the TCP
 * connection through a jump host (bastion) — basic ProxyJump support.
 */
function authFor(profile: ServerProfile): Partial<ConnectConfig> {
  const cfg: Partial<ConnectConfig> = {}
  if (profile.authMethod === 'password') {
    cfg.password = profile.password
  } else if (profile.authMethod === 'key') {
    cfg.privateKey = profile.privateKey
    if (profile.passphrase) cfg.passphrase = profile.passphrase
  } else if (profile.authMethod === 'agent') {
    cfg.agent = process.env.SSH_AUTH_SOCK || (process.platform === 'win32' ? 'pageant' : undefined)
  }
  return cfg
}

function baseConfig(profile: ServerProfile): ConnectConfig {
  return {
    host: profile.host,
    port: profile.port || 22,
    username: profile.username,
    readyTimeout: 25000,
    // Send keepalives frequently and tolerate several missed replies before
    // declaring the link dead — keeps sessions alive through NAT/idle drops.
    keepaliveInterval: (profile.keepaliveInterval ?? 20) * 1000,
    keepaliveCountMax: 6,
    // Many servers only offer keyboard-interactive for password logins; let
    // ssh2 fall back to it and answer the prompts with the stored password.
    tryKeyboard: profile.authMethod === 'password',
    ...authFor(profile)
  }
}

/** Answer keyboard-interactive prompts with the profile's password. */
function wireKeyboardInteractive(client: Client, profile: ServerProfile): void {
  if (profile.authMethod !== 'password') return
  client.on('keyboard-interactive', (_name, _instructions, _lang, _prompts, finish) => {
    finish([profile.password ?? ''])
  })
}

export class SSHManager {
  private emit: Emit
  private shells = new Map<string, ShellSession>()
  private tunnels = new Map<string, ActiveTunnel>()

  constructor(emit: Emit) {
    this.emit = emit
  }

  /** Resolve a connected ssh2 Client, optionally hopping through a jump host. */
  private connectClient(profile: ServerProfile, jump?: ServerProfile | null): Promise<Client> {
    return new Promise((resolve, reject) => {
      const target = new Client()
      const cfg = baseConfig(profile)
      wireKeyboardInteractive(target, profile)

      const finish = (config: ConnectConfig): void => {
        target
          .on('ready', () => resolve(target))
          .on('error', (err) => reject(err))
          .connect(config)
      }

      if (jump) {
        const hop = new Client()
        wireKeyboardInteractive(hop, jump)
        hop
          .on('ready', () => {
            hop.forwardOut('127.0.0.1', 0, profile.host, profile.port || 22, (err, stream) => {
              if (err) {
                hop.end()
                return reject(err)
              }
              // Tear down the hop when the target closes.
              target.on('close', () => hop.end())
              finish({ ...cfg, sock: stream })
            })
          })
          .on('error', (err) => reject(err))
          .connect(baseConfig(jump))
      } else {
        finish(cfg)
      }
    })
  }

  /** Open an interactive shell session and stream its output to the renderer. */
  async openShell(
    sessionId: string,
    profile: ServerProfile,
    cols: number,
    rows: number,
    jump?: ServerProfile | null
  ): Promise<void> {
    this.emit(`status:${sessionId}`, { status: 'connecting' as SessionStatus })
    let client: Client
    try {
      client = await this.connectClient(profile, jump)
    } catch (err) {
      this.emit(`status:${sessionId}`, { status: 'error' as SessionStatus, message: (err as Error).message })
      throw err
    }

    client.on('close', () => {
      this.shells.delete(sessionId)
      this.emit(`status:${sessionId}`, { status: 'disconnected' as SessionStatus })
    })
    client.on('error', (err) => {
      this.emit(`status:${sessionId}`, { status: 'error' as SessionStatus, message: err.message })
    })

    return new Promise((resolve, reject) => {
      client.shell({ term: 'xterm-256color', cols, rows }, (err, stream) => {
        if (err) {
          client.end()
          this.emit(`status:${sessionId}`, { status: 'error' as SessionStatus, message: err.message })
          return reject(err)
        }
        this.shells.set(sessionId, { client, stream, serverId: profile.id })
        this.emit(`status:${sessionId}`, { status: 'connected' as SessionStatus })

        stream.on('data', (d: Buffer) => this.emit(`data:${sessionId}`, d.toString('utf8')))
        stream.stderr.on('data', (d: Buffer) => this.emit(`data:${sessionId}`, d.toString('utf8')))
        stream.on('close', () => {
          client.end()
          this.shells.delete(sessionId)
          this.emit(`status:${sessionId}`, { status: 'disconnected' as SessionStatus })
        })
        resolve()
      })
    })
  }

  sendData(sessionId: string, data: string): void {
    this.shells.get(sessionId)?.stream.write(data)
  }

  resize(sessionId: string, cols: number, rows: number): void {
    this.shells.get(sessionId)?.stream.setWindow(rows, cols, 0, 0)
  }

  disconnect(sessionId: string): void {
    const s = this.shells.get(sessionId)
    if (s) {
      s.stream.end()
      s.client.end()
      this.shells.delete(sessionId)
    }
  }

  /** Run a one-off command and capture its stdout/stderr. */
  async exec(profile: ServerProfile, command: string, jump?: ServerProfile | null): Promise<{ stdout: string; stderr: string; code: number }> {
    const client = await this.connectClient(profile, jump)
    return new Promise((resolve, reject) => {
      client.exec(command, (err, stream) => {
        if (err) {
          client.end()
          return reject(err)
        }
        let stdout = ''
        let stderr = ''
        stream
          .on('close', (code: number) => {
            client.end()
            resolve({ stdout, stderr, code: code ?? 0 })
          })
          .on('data', (d: Buffer) => (stdout += d.toString('utf8')))
        stream.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf8')))
      })
    })
  }

  /** Append a public key to the server's ~/.ssh/authorized_keys. */
  async installPublicKey(profile: ServerProfile, publicKey: string, jump?: ServerProfile | null): Promise<void> {
    const safe = publicKey.replace(/'/g, '').trim()
    const cmd =
      `mkdir -p ~/.ssh && chmod 700 ~/.ssh && ` +
      `touch ~/.ssh/authorized_keys && grep -qxF '${safe}' ~/.ssh/authorized_keys || echo '${safe}' >> ~/.ssh/authorized_keys && ` +
      `chmod 600 ~/.ssh/authorized_keys && echo OK`
    const { code, stdout, stderr } = await this.exec(profile, cmd, jump)
    if (code !== 0 || !stdout.includes('OK')) throw new Error(stderr || 'Failed to install key.')
  }

  // ---------------- Live log / command streaming ----------------

  private streams = new Map<string, Client>()

  async startStream(
    streamId: string,
    profile: ServerProfile,
    command: string,
    jump?: ServerProfile | null
  ): Promise<void> {
    const client = await this.connectClient(profile, jump)
    this.streams.set(streamId, client)
    client.on('close', () => {
      this.streams.delete(streamId)
      this.emit(`logstatus:${streamId}`, { status: 'closed' })
    })
    client.exec(command, (err, stream) => {
      if (err) {
        this.emit(`logstatus:${streamId}`, { status: 'error', message: err.message })
        client.end()
        return
      }
      this.emit(`logstatus:${streamId}`, { status: 'open' })
      stream.on('data', (d: Buffer) => this.emit(`logdata:${streamId}`, d.toString('utf8')))
      stream.stderr.on('data', (d: Buffer) => this.emit(`logdata:${streamId}`, d.toString('utf8')))
      stream.on('close', () => client.end())
    })
  }

  stopStream(streamId: string): void {
    const c = this.streams.get(streamId)
    if (c) {
      c.end()
      this.streams.delete(streamId)
    }
  }

  // ---------------- VNC remote desktop (WS↔TCP bridge over SSH) ----------------

  private vncServers = new Map<string, WebSocketServer>()

  /**
   * Open a localhost WebSocket bridge that pipes a noVNC client (renderer) to
   * the server's VNC port (127.0.0.1:vncPort on the server) through SSH.
   * Returns the local WS port the renderer should connect to.
   */
  async startVnc(sessionId: string, profile: ServerProfile, jump?: ServerProfile | null): Promise<number> {
    this.stopVnc(sessionId)
    const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 })
    this.vncServers.set(sessionId, wss)
    await new Promise<void>((resolve) => wss.once('listening', () => resolve()))
    const addr = wss.address()
    const port = typeof addr === 'object' && addr ? addr.port : 0

    wss.on('connection', (ws) => {
      // Buffer client frames until the SSH channel is ready — noVNC sends its
      // security handshake immediately after the banner, and bytes arriving
      // before forwardOut completes were previously dropped (first-connect race).
      let stream: ClientChannel | null = null
      const backlog: Buffer[] = []
      ws.on('message', (data: Buffer) => {
        if (stream) stream.write(data)
        else backlog.push(data)
      })
      this.connectClient(profile, jump)
        .then((client) => {
          client.forwardOut('127.0.0.1', 0, '127.0.0.1', profile.vncPort || 5900, (err, s) => {
            if (err) {
              ws.close()
              client.end()
              return
            }
            stream = s
            for (const d of backlog) s.write(d)
            backlog.length = 0
            s.on('data', (d: Buffer) => {
              if (ws.readyState === WebSocket.OPEN) ws.send(d)
            })
            s.on('close', () => ws.close())
            ws.on('close', () => {
              s.end()
              client.end()
            })
          })
        })
        .catch(() => ws.close())
    })
    return port
  }

  stopVnc(sessionId: string): void {
    const wss = this.vncServers.get(sessionId)
    if (wss) {
      wss.clients.forEach((c) => c.close())
      wss.close()
      this.vncServers.delete(sessionId)
    }
  }

  // ---------------- Health metrics ----------------

  /** Gather live system metrics (Linux). Best-effort; never throws. */
  async metrics(profile: ServerProfile, jump?: ServerProfile | null): Promise<ServerMetrics> {
    const cmd = [
      'echo "OS:$(. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME" || uname -s)"',
      'echo "KERNEL:$(uname -r)"',
      'echo "UPTIME:$(cut -d. -f1 /proc/uptime 2>/dev/null)"',
      'echo "LOAD:$(cut -d\' \' -f1-3 /proc/loadavg 2>/dev/null)"',
      'echo "CPU:$(nproc 2>/dev/null || grep -c ^processor /proc/cpuinfo)"',
      'echo "MEM:$(free -b 2>/dev/null | awk \'/^Mem:/{print $2","$3","$7}\')"',
      'echo "DISK:$(df -B1 / 2>/dev/null | awk \'NR==2{print $2","$3","$4}\')"'
    ].join('; ')

    try {
      const { stdout } = await this.exec(profile, cmd, jump)
      const m: ServerMetrics = { reachable: true }
      for (const line of stdout.split('\n')) {
        const [key, ...rest] = line.split(':')
        const val = rest.join(':').trim()
        if (!val) continue
        if (key === 'OS') m.os = val
        else if (key === 'KERNEL') m.kernel = val
        else if (key === 'UPTIME') m.uptimeSec = Number(val) || undefined
        else if (key === 'LOAD') {
          const p = val.split(/\s+/).map(Number)
          if (p.length >= 3) m.load = [p[0], p[1], p[2]]
        } else if (key === 'CPU') m.cpuCount = Number(val) || undefined
        else if (key === 'MEM') {
          const [t, u, a] = val.split(',').map(Number)
          m.memTotal = t || undefined
          m.memUsed = u || undefined
          m.memAvailable = a || undefined
        } else if (key === 'DISK') {
          const [t, u, a] = val.split(',').map(Number)
          m.diskTotal = t || undefined
          m.diskUsed = u || undefined
          m.diskAvailable = a || undefined
        }
      }
      return m
    } catch (e) {
      return { reachable: false, error: (e as Error).message }
    }
  }

  /**
   * Dedicated-connection exec channel for long-running structured protocols
   * (Disk Usage scan/delete). stdout/stderr stay separate, stdin stays
   * writable, and closing it never disturbs shared SFTP/terminal sessions.
   */
  async openExecChannel(
    profile: ServerProfile,
    command: string,
    jump?: ServerProfile | null
  ): Promise<{ stream: ClientChannel; close: () => void }> {
    const client = await this.connectClient(profile, jump)
    return new Promise((resolve, reject) => {
      let settled = false
      const fail = (err: Error): void => {
        if (settled) return
        settled = true
        client.end()
        reject(err)
      }
      client.once('error', fail)
      client.exec(command, (err, stream) => {
        if (err) return fail(err)
        settled = true
        resolve({
          stream,
          close: () => {
            try {
              stream.close()
            } catch {
              /* already closed */
            }
            client.end()
          }
        })
      })
    })
  }

  // ---------------- SFTP ----------------

  private sftpClients = new Map<string, Client>()
  private sftpConnecting = new Map<string, Promise<Client>>()
  private sftpChannels = new WeakMap<Client, Promise<import('ssh2').SFTPWrapper>>()

  private async getSftpClient(profile: ServerProfile, jump?: ServerProfile | null): Promise<Client> {
    const existing = this.sftpClients.get(profile.id)
    if (existing) return existing
    const pending = this.sftpConnecting.get(profile.id)
    if (pending) return pending
    const connecting = this.connectClient(profile, jump).then((client) => {
      if (this.sftpConnecting.get(profile.id) !== connecting) {
        client.end()
        throw new Error('SFTP connection canceled')
      }
      const cleanup = (): void => {
        if (this.sftpClients.get(profile.id) === client) this.sftpClients.delete(profile.id)
        this.sftpChannels.delete(client)
      }
      client.on('close', cleanup)
      client.on('end', cleanup)
      client.on('error', () => {
        cleanup()
        client.end()
      })
      this.sftpClients.set(profile.id, client)
      return client
    }).finally(() => {
      if (this.sftpConnecting.get(profile.id) === connecting) this.sftpConnecting.delete(profile.id)
    })
    this.sftpConnecting.set(profile.id, connecting)
    return connecting
  }

  private sftp(client: Client): Promise<import('ssh2').SFTPWrapper> {
    const existing = this.sftpChannels.get(client)
    if (existing) return existing
    const opening = new Promise<import('ssh2').SFTPWrapper>((resolve, reject) => {
      client.sftp((err, sftp) => {
        if (err) return reject(err)
        const cleanup = (): void => {
          if (this.sftpChannels.get(client) === opening) this.sftpChannels.delete(client)
        }
        sftp.on('close', cleanup)
        sftp.on('end', cleanup)
        sftp.on('error', () => {
          cleanup()
          sftp.end()
        })
        resolve(sftp)
      })
    }).catch((err) => {
      if (this.sftpChannels.get(client) === opening) this.sftpChannels.delete(client)
      throw err
    })
    this.sftpChannels.set(client, opening)
    return opening
  }

  async sftpList(
    profile: ServerProfile,
    path: string,
    jump?: ServerProfile | null
  ): Promise<{ cwd: string; entries: SftpEntry[] }> {
    const client = await this.getSftpClient(profile, jump)
    const sftp = await this.sftp(client)
    // Resolve to an absolute, canonical path so ".", "~" and ".." all work and
    // navigating to the parent directory is always reliable.
    const cwd = await new Promise<string>((res, rej) =>
      sftp.realpath(path && path.trim() ? path : '.', (e, abs) => (e ? rej(e) : res(abs)))
    )
    return new Promise((resolve, reject) => {
      sftp.readdir(cwd, (err, list) => {
        if (err) return reject(err)
        const base = cwd.endsWith('/') ? cwd : cwd + '/'
        const entries: SftpEntry[] = list.map((e) => {
          const m = e.attrs.mode
          let type: SftpEntry['type'] = 'other'
          if (e.attrs.isDirectory()) type = 'directory'
          else if (e.attrs.isFile()) type = 'file'
          else if (e.attrs.isSymbolicLink()) type = 'symlink'
          return {
            name: e.filename,
            path: (base + e.filename).replace(/\/+/g, '/'),
            type,
            size: e.attrs.size,
            mtime: e.attrs.mtime * 1000,
            mode: m,
            owner: e.attrs.uid,
            group: e.attrs.gid
          }
        })
        entries.sort((a, b) => {
          if (a.type === 'directory' && b.type !== 'directory') return -1
          if (a.type !== 'directory' && b.type === 'directory') return 1
          return a.name.localeCompare(b.name)
        })
        resolve({ cwd, entries })
      })
    })
  }

  async sftpDownload(profile: ServerProfile, remote: string, local: string, jump?: ServerProfile | null): Promise<void> {
    const client = await this.getSftpClient(profile, jump)
    const sftp = await this.sftp(client)
    return new Promise((resolve, reject) => {
      sftp.fastGet(remote, local, (err) => (err ? reject(err) : resolve()))
    })
  }

  async sftpUpload(profile: ServerProfile, local: string, remote: string, jump?: ServerProfile | null): Promise<void> {
    const client = await this.getSftpClient(profile, jump)
    const sftp = await this.sftp(client)
    return new Promise((resolve, reject) => {
      sftp.fastPut(local, remote, (err) => (err ? reject(err) : resolve()))
    })
  }

  async sftpMkdir(profile: ServerProfile, path: string, jump?: ServerProfile | null): Promise<void> {
    const client = await this.getSftpClient(profile, jump)
    const sftp = await this.sftp(client)
    return new Promise((resolve, reject) => {
      sftp.mkdir(path, (err) => (err ? reject(err) : resolve()))
    })
  }

  async sftpRemove(profile: ServerProfile, path: string, isDir: boolean, jump?: ServerProfile | null): Promise<void> {
    const client = await this.getSftpClient(profile, jump)
    const sftp = await this.sftp(client)
    return new Promise((resolve, reject) => {
      const cb = (err: Error | null | undefined): void => (err ? reject(err) : resolve())
      if (isDir) sftp.rmdir(path, cb)
      else sftp.unlink(path, cb)
    })
  }

  async sftpRename(profile: ServerProfile, from: string, to: string, jump?: ServerProfile | null): Promise<void> {
    const client = await this.getSftpClient(profile, jump)
    const sftp = await this.sftp(client)
    return new Promise((resolve, reject) => {
      sftp.rename(from, to, (err) => (err ? reject(err) : resolve()))
    })
  }

  async sftpReadFile(profile: ServerProfile, path: string, jump?: ServerProfile | null): Promise<string> {
    const client = await this.getSftpClient(profile, jump)
    const sftp = await this.sftp(client)
    return new Promise((resolve, reject) => {
      sftp.readFile(path, (err, buf) => (err ? reject(err) : resolve(buf.toString('utf8'))))
    })
  }

  async sftpWriteFile(profile: ServerProfile, path: string, content: string, jump?: ServerProfile | null): Promise<void> {
    const client = await this.getSftpClient(profile, jump)
    const sftp = await this.sftp(client)
    return new Promise((resolve, reject) => {
      sftp.writeFile(path, content, (err) => (err ? reject(err) : resolve()))
    })
  }

  /** Shared SFTP handle; callers close their file streams, never this channel. */
  async getSftp(profile: ServerProfile, jump?: ServerProfile | null): Promise<import('ssh2').SFTPWrapper> {
    const client = await this.getSftpClient(profile, jump)
    return this.sftp(client)
  }

  async sftpStat(
    profile: ServerProfile,
    path: string,
    jump?: ServerProfile | null
  ): Promise<{ size: number; isDirectory: boolean } | null> {
    const sftp = await this.getSftp(profile, jump)
    return new Promise((resolve) => {
      sftp.stat(path, (err, st) => {
        if (err) return resolve(null)
        resolve({ size: st.size, isDirectory: st.isDirectory() })
      })
    })
  }

  /** mkdir -p on the remote side; existing segments are ignored. */
  async sftpMakedirs(profile: ServerProfile, dir: string, jump?: ServerProfile | null): Promise<void> {
    const sftp = await this.getSftp(profile, jump)
    const parts = dir.split('/').filter(Boolean)
    let cur = dir.startsWith('/') ? '' : '.'
    for (const part of parts) {
      cur = cur === '' ? `/${part}` : `${cur}/${part}`
      const p = cur
      await new Promise<void>((resolve) => {
        sftp.mkdir(p, (err) => {
          // EEXIST/failure because it already exists is fine; other errors
          // will surface when a file inside the directory is written.
          void err
          resolve()
        })
      })
    }
  }

  /** Recursive delete: unlink files depth-first, then rmdir bottom-up. */
  async sftpRemoveRecursive(profile: ServerProfile, path: string, jump?: ServerProfile | null): Promise<void> {
    const sftp = await this.getSftp(profile, jump)
    const walk = async (p: string): Promise<void> => {
      const st = await new Promise<import('ssh2').Stats | null>((resolve) => {
        sftp.lstat(p, (err, s) => resolve(err ? null : s))
      })
      if (!st) throw new Error(`Not found: ${p}`)
      if (st.isDirectory() && !st.isSymbolicLink()) {
        const list = await new Promise<import('ssh2').FileEntryWithStats[]>((resolve, reject) => {
          sftp.readdir(p, (err, l) => (err ? reject(err) : resolve(l)))
        })
        for (const e of list) {
          if (e.filename === '.' || e.filename === '..') continue
          await walk(`${p.replace(/\/$/, '')}/${e.filename}`)
        }
        await new Promise<void>((resolve, reject) => sftp.rmdir(p, (err) => (err ? reject(err) : resolve())))
      } else {
        await new Promise<void>((resolve, reject) => sftp.unlink(p, (err) => (err ? reject(err) : resolve())))
      }
    }
    await walk(path)
  }

  /** Recursive disk usage of a remote folder. Symlinked dirs are not followed. */
  async sftpDirSize(profile: ServerProfile, path: string, jump?: ServerProfile | null): Promise<number> {
    const sftp = await this.getSftp(profile, jump)
    const walk = async (dir: string): Promise<number> => {
      const list = await new Promise<import('ssh2').FileEntryWithStats[]>((resolve, reject) => {
        sftp.readdir(dir, (err, l) => (err ? reject(err) : resolve(l)))
      })
      let total = 0
      for (const e of list) {
        if (e.filename === '.' || e.filename === '..') continue
        const full = `${dir.replace(/\/$/, '')}/${e.filename}`
        if (e.attrs.isDirectory()) total += await walk(full)
        else if (e.attrs.isFile()) total += e.attrs.size
      }
      return total
    }
    return walk(path)
  }

  // ---------------- Tunnels / port forwarding ----------------

  async startTunnel(rule: TunnelRule, profile: ServerProfile, jump?: ServerProfile | null): Promise<void> {
    if (this.tunnels.has(rule.id)) throw new Error('Tunnel is already running.')
    const client = await this.connectClient(profile, jump)
    client.on('close', () => {
      this.tunnels.delete(rule.id)
      this.emit(`tunnel:${rule.id}`, { status: 'disconnected' })
    })
    client.on('error', (err) => this.emit(`tunnel:${rule.id}`, { status: 'error', message: err.message }))

    if (rule.type === 'local') {
      const server = createServer((sock: Socket) => {
        client.forwardOut(sock.remoteAddress || '127.0.0.1', sock.remotePort || 0, rule.remoteHost, rule.remotePort, (err, stream) => {
          if (err) {
            sock.destroy()
            return
          }
          sock.pipe(stream).pipe(sock)
        })
      })
      server.on('error', (err) => this.emit(`tunnel:${rule.id}`, { status: 'error', message: err.message }))
      server.listen(rule.localPort, rule.localHost || '127.0.0.1', () => {
        this.tunnels.set(rule.id, { rule, client, server })
        this.emit(`tunnel:${rule.id}`, { status: 'connected' })
      })
    } else if (rule.type === 'remote') {
      client.forwardIn(rule.remoteHost || '127.0.0.1', rule.remotePort, (err) => {
        if (err) {
          client.end()
          this.emit(`tunnel:${rule.id}`, { status: 'error', message: err.message })
          return
        }
        this.tunnels.set(rule.id, { rule, client })
        this.emit(`tunnel:${rule.id}`, { status: 'connected' })
      })
      client.on('tcp connection', (_info, accept) => {
        const stream = accept()
        const local = netConnect(rule.localPort, rule.localHost || '127.0.0.1', () => {
          stream.pipe(local).pipe(stream)
        })
        local.on('error', () => stream.end())
      })
    } else if (rule.type === 'dynamic') {
      const server = createServer((sock: Socket) => this.handleSocks(sock, client))
      server.on('error', (err) => this.emit(`tunnel:${rule.id}`, { status: 'error', message: err.message }))
      server.listen(rule.localPort, rule.localHost || '127.0.0.1', () => {
        this.tunnels.set(rule.id, { rule, client, server })
        this.emit(`tunnel:${rule.id}`, { status: 'connected' })
      })
    }
  }

  stopTunnel(ruleId: string): void {
    const t = this.tunnels.get(ruleId)
    if (!t) return
    t.server?.close()
    t.client.end()
    this.tunnels.delete(ruleId)
    this.emit(`tunnel:${ruleId}`, { status: 'disconnected' })
  }

  /** Minimal SOCKS5 (no-auth, CONNECT) over the SSH client for dynamic forwarding. */
  private handleSocks(sock: Socket, client: Client): void {
    let stage = 0
    sock.on('error', () => sock.destroy())
    sock.once('data', (greeting) => {
      if (greeting[0] !== 0x05) return sock.destroy()
      // No authentication required.
      sock.write(Buffer.from([0x05, 0x00]))
      stage = 1
      sock.once('data', (req) => {
        if (stage !== 1 || req[0] !== 0x05 || req[1] !== 0x01) {
          sock.write(Buffer.from([0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0]))
          return sock.destroy()
        }
        const atyp = req[3]
        let host = ''
        let offset = 4
        if (atyp === 0x01) {
          host = `${req[4]}.${req[5]}.${req[6]}.${req[7]}`
          offset = 8
        } else if (atyp === 0x03) {
          const len = req[4]
          host = req.slice(5, 5 + len).toString('utf8')
          offset = 5 + len
        } else if (atyp === 0x04) {
          const parts: string[] = []
          for (let i = 0; i < 16; i += 2) parts.push(req.slice(4 + i, 6 + i).toString('hex'))
          host = parts.join(':')
          offset = 20
        } else {
          return sock.destroy()
        }
        const port = req.readUInt16BE(offset)
        client.forwardOut(sock.remoteAddress || '127.0.0.1', sock.remotePort || 0, host, port, (err, stream) => {
          if (err) {
            sock.write(Buffer.from([0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0]))
            return sock.destroy()
          }
          sock.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]))
          sock.pipe(stream).pipe(sock)
        })
      })
    })
  }

  /**
   * Open an ephemeral local TCP forward (127.0.0.1:localPort → dstHost:dstPort)
   * through the server's SSH. Used to tunnel database connections.
   */
  async openLocalForward(
    profile: ServerProfile,
    dstHost: string,
    dstPort: number,
    jump?: ServerProfile | null
  ): Promise<{ localPort: number; close: () => void }> {
    const client = await this.connectClient(profile, jump)
    return new Promise((resolve, reject) => {
      const server = createServer((sock: Socket) => {
        client.forwardOut(sock.remoteAddress || '127.0.0.1', sock.remotePort || 0, dstHost, dstPort, (err, stream) => {
          if (err) {
            sock.destroy()
            return
          }
          sock.pipe(stream).pipe(sock)
        })
      })
      server.on('error', reject)
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address()
        const localPort = typeof addr === 'object' && addr ? addr.port : 0
        resolve({
          localPort,
          close: () => {
            server.close()
            client.end()
          }
        })
      })
    })
  }

  /** Tear everything down (called on lock / quit). */
  shutdown(): void {
    for (const id of [...this.shells.keys()]) this.disconnect(id)
    for (const id of [...this.tunnels.keys()]) this.stopTunnel(id)
    for (const id of [...this.streams.keys()]) this.stopStream(id)
    for (const id of [...this.vncServers.keys()]) this.stopVnc(id)
    for (const [, c] of this.sftpClients) c.end()
    this.sftpClients.clear()
    this.sftpConnecting.clear()
    this.sftpChannels = new WeakMap()
  }
}
