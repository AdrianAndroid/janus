import { ipcMain, dialog, BrowserWindow, systemPreferences, powerMonitor, Notification } from 'electron'
import { IPC } from '@shared/ipc'
import { vaultStore } from './store'
import { SSHManager } from './ssh-manager'
import { setupAutoUpdater, updater } from './updater'
import { generateKey } from './keygen'
import { launchRdp } from './rdp'
import { importSshConfig, exportSshConfig } from './sshconfig'
import { DbManager } from './db-manager'
import { aiChat } from './ai'
import { TransferManager } from './transfer-manager'
import { localDirSize, localHome, localList, localMkdir, localRemove, localRename, localStat } from './local-fs'
import { mediaProgressKey, mediaUrl, openMediaPlayer, setupMediaProtocol } from './media'
import type { ConflictAction, KeyType, DbConnection, AiMessage, MediaOpenRequest, TransferRequest } from '@shared/types'
import type { ServerProfile, TunnelRule, Vault, IpcResult } from '@shared/types'

/** Wrap a handler so it always returns a tidy IpcResult and never throws across IPC. */
function handle<T>(channel: string, fn: (...args: unknown[]) => Promise<T> | T): void {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      const data = await fn(...args)
      return { ok: true, data } as IpcResult<T>
    } catch (err) {
      return { ok: false, error: (err as Error).message } as IpcResult<T>
    }
  })
}

/** Look up a server profile by id from the in-memory vault. */
function findServer(id: string): ServerProfile {
  const s = vaultStore.read().servers.find((x) => x.id === id)
  if (!s) throw new Error('Server not found.')
  return s
}

/** Resolve the jump host profile for a server, if any. */
function jumpFor(profile: ServerProfile): ServerProfile | null {
  if (!profile.jumpHostId) return null
  return vaultStore.read().servers.find((x) => x.id === profile.jumpHostId) ?? null
}

export function registerIpc(getWindow: () => BrowserWindow | null): void {
  const emit = (channel: string, payload: unknown): void => {
    getWindow()?.webContents.send(channel, payload)
  }
  const ssh = new SSHManager(emit)
  const dbm = new DbManager((sshServerId, host, port) => {
    const p = findServer(sshServerId)
    return ssh.openLocalForward(p, host, port, jumpFor(p))
  })
  const transfers = new TransferManager(ssh, emit, (serverId) => {
    const profile = findServer(serverId)
    return { profile, jump: jumpFor(profile) }
  })
  setupMediaProtocol(ssh, (serverId) => {
    const profile = findServer(serverId)
    return { profile, jump: jumpFor(profile) }
  })

  // ---- Media player ----
  handle(IPC.mediaOpen, async (req) => {
    const r = req as MediaOpenRequest
    if (r.serverId) findServer(r.serverId) // validates the id
    openMediaPlayer(r.title || 'Player', mediaUrl(r.serverId, r.path), mediaProgressKey(r.serverId, r.path))
    return true
  })

  // ---- Vault lifecycle ----
  handle(IPC.vaultStatus, async () => ({
    exists: await vaultStore.exists(),
    unlocked: vaultStore.isUnlocked,
    path: vaultStore.filePath,
    hasRemembered: await vaultStore.hasRemembered()
  }))
  handle(IPC.vaultRemember, async (password) => {
    await vaultStore.rememberPassword(password as string)
    return true
  })
  handle(IPC.vaultForget, async () => {
    await vaultStore.forget()
    return true
  })
  handle(IPC.vaultAutoUnlock, async () => vaultStore.autoUnlock())
  handle(IPC.vaultCreate, async (password) => {
    await vaultStore.create(password as string)
    return vaultStore.read()
  })
  handle(IPC.vaultUnlock, async (password) => vaultStore.unlock(password as string))
  handle(IPC.vaultLock, async () => {
    ssh.shutdown()
    dbm.shutdown()
    vaultStore.lock()
    return true
  })
  handle(IPC.vaultChangePassword, async (oldP, newP) => {
    await vaultStore.changePassword(oldP as string, newP as string)
    return true
  })
  handle(IPC.vaultRead, async () => vaultStore.read())
  handle(IPC.vaultWrite, async (vault) => {
    await vaultStore.write(vault as Vault)
    return true
  })
  handle(IPC.vaultExport, async () => {
    const win = getWindow()
    const res = await dialog.showSaveDialog(win!, {
      title: 'Export vault',
      defaultPath: 'janus-export.vault.json',
      filters: [{ name: 'Janus Vault', extensions: ['json'] }]
    })
    if (res.canceled || !res.filePath) return false
    await vaultStore.exportTo(res.filePath)
    return res.filePath
  })
  handle(IPC.vaultImport, async (password) => {
    const win = getWindow()
    const res = await dialog.showOpenDialog(win!, {
      title: 'Import vault',
      properties: ['openFile'],
      filters: [{ name: 'Janus Vault', extensions: ['json'] }]
    })
    if (res.canceled || !res.filePaths[0]) return false
    return vaultStore.importFrom(res.filePaths[0], password as string)
  })

  // ---- SSH shell ----
  handle(IPC.sshConnect, async (sessionId, serverId, cols, rows) => {
    const profile = findServer(serverId as string)
    await ssh.openShell(sessionId as string, profile, cols as number, rows as number, jumpFor(profile))
    return true
  })
  ipcMain.on(IPC.sshData, (_e, sessionId: string, data: string) => ssh.sendData(sessionId, data))
  ipcMain.on(IPC.sshResize, (_e, sessionId: string, cols: number, rows: number) => ssh.resize(sessionId, cols, rows))
  ipcMain.on(IPC.sshDisconnect, (_e, sessionId: string) => ssh.disconnect(sessionId))
  handle(IPC.sshExec, async (serverId, command) => {
    const profile = findServer(serverId as string)
    return ssh.exec(profile, command as string, jumpFor(profile))
  })
  handle(IPC.sshMetrics, async (serverId) => {
    const profile = findServer(serverId as string)
    return ssh.metrics(profile, jumpFor(profile))
  })
  handle(IPC.sshKeygen, async (type, comment) => generateKey((type as KeyType) || 'ed25519', (comment as string) || 'janus'))
  handle(IPC.sshInstallKey, async (serverId, publicKey) => {
    const profile = findServer(serverId as string)
    await ssh.installPublicKey(profile, publicKey as string, jumpFor(profile))
    return true
  })

  // ---- Live log / command streaming ----
  handle(IPC.streamStart, async (streamId, serverId, command) => {
    const profile = findServer(serverId as string)
    await ssh.startStream(streamId as string, profile, command as string, jumpFor(profile))
    return true
  })
  ipcMain.on(IPC.streamStop, (_e, streamId: string) => ssh.stopStream(streamId))

  // ---- VNC remote desktop ----
  handle(IPC.vncStart, async (sessionId, serverId) => {
    const profile = findServer(serverId as string)
    return ssh.startVnc(sessionId as string, profile, jumpFor(profile))
  })
  ipcMain.on(IPC.vncStop, (_e, sessionId: string) => ssh.stopVnc(sessionId))

  // ---- RDP (native client) ----
  handle(IPC.rdpLaunch, async (serverId) => {
    await launchRdp(findServer(serverId as string))
    return true
  })

  // ---- SSH config import/export ----
  handle(IPC.sshConfigImport, async () => importSshConfig())
  handle(IPC.sshConfigExport, async () => exportSshConfig(vaultStore.read().servers))

  // ---- Database manager ----
  handle(IPC.dbTest, async (conn) => dbm.test(conn as DbConnection))
  handle(IPC.dbQuery, async (conn, sql) => dbm.query(conn as DbConnection, sql as string))
  handle(IPC.dbTables, async (conn) => dbm.tables(conn as DbConnection))
  handle(IPC.dbClose, async (id) => {
    await dbm.close(id as string)
    return true
  })

  // ---- AI copilot ----
  handle(IPC.aiChat, async (messages, system) =>
    aiChat(vaultStore.read().settings.ai, messages as AiMessage[], system as string)
  )

  // ---- Desktop notifications ----
  ipcMain.on(IPC.notifyShow, (_e, title: string, body: string) => {
    if (Notification.isSupported()) new Notification({ title, body, silent: false }).show()
  })

  // ---- Power events → renderer (reconnect after sleep) ----
  powerMonitor.on('resume', () => emit(IPC.systemResume, {}))
  powerMonitor.on('suspend', () => emit(IPC.systemSuspend, {}))

  // ---- System integration (Touch ID) ----
  handle(IPC.touchIdAvailable, async () => process.platform === 'darwin' && systemPreferences.canPromptTouchID())
  handle(IPC.touchIdPrompt, async (reason) => {
    await systemPreferences.promptTouchID((reason as string) || 'Unlock Janus')
    return true
  })

  // ---- SFTP ----
  handle(IPC.sftpList, async (serverId, path) => {
    const p = findServer(serverId as string)
    return ssh.sftpList(p, path as string, jumpFor(p))
  })
  handle(IPC.sftpDownload, async (serverId, remote) => {
    const p = findServer(serverId as string)
    const win = getWindow()
    const res = await dialog.showSaveDialog(win!, { defaultPath: (remote as string).split('/').pop() })
    if (res.canceled || !res.filePath) return false
    await ssh.sftpDownload(p, remote as string, res.filePath, jumpFor(p))
    return res.filePath
  })
  handle(IPC.sftpUpload, async (serverId, remoteDir) => {
    const p = findServer(serverId as string)
    const win = getWindow()
    const res = await dialog.showOpenDialog(win!, { properties: ['openFile', 'multiSelections'] })
    if (res.canceled || res.filePaths.length === 0) return false
    for (const local of res.filePaths) {
      const name = local.split(/[\\/]/).pop()!
      const remote = `${(remoteDir as string).replace(/\/$/, '')}/${name}`
      await ssh.sftpUpload(p, local, remote, jumpFor(p))
    }
    return res.filePaths.length
  })
  handle(IPC.sftpMkdir, async (serverId, path) => {
    const p = findServer(serverId as string)
    await ssh.sftpMkdir(p, path as string, jumpFor(p))
    return true
  })
  handle(IPC.sftpRemove, async (serverId, path, isDir) => {
    const p = findServer(serverId as string)
    await ssh.sftpRemove(p, path as string, isDir as boolean, jumpFor(p))
    return true
  })
  handle(IPC.sftpRename, async (serverId, from, to) => {
    const p = findServer(serverId as string)
    await ssh.sftpRename(p, from as string, to as string, jumpFor(p))
    return true
  })
  handle(IPC.sftpReadFile, async (serverId, path) => {
    const p = findServer(serverId as string)
    return ssh.sftpReadFile(p, path as string, jumpFor(p))
  })
  handle(IPC.sftpWriteFile, async (serverId, path, content) => {
    const p = findServer(serverId as string)
    await ssh.sftpWriteFile(p, path as string, content as string, jumpFor(p))
    return true
  })
  handle(IPC.sftpRemoveRecursive, async (serverId, path) => {
    const p = findServer(serverId as string)
    await ssh.sftpRemoveRecursive(p, path as string, jumpFor(p))
    return true
  })

  // ---- Local filesystem (dual-pane file manager) ----
  handle(IPC.localHome, async () => localHome())
  handle(IPC.localList, async (path) => localList(path as string))
  handle(IPC.localMkdir, async (path) => {
    await localMkdir(path as string)
    return true
  })
  handle(IPC.localRename, async (from, to) => {
    await localRename(from as string, to as string)
    return true
  })
  handle(IPC.localRemove, async (path) => {
    await localRemove(path as string)
    return true
  })
  handle(IPC.localStat, async (path) => localStat(path as string))
  handle(IPC.localDirSize, async (path) => localDirSize(path as string))
  handle(IPC.sftpDirSize, async (serverId, path) => {
    const p = findServer(serverId as string)
    return ssh.sftpDirSize(p, path as string, jumpFor(p))
  })

  // ---- File transfer engine ----
  handle(IPC.transferStart, async (req) => transfers.start(req as TransferRequest))
  handle(IPC.transferCancel, async (id) => {
    transfers.cancel(id as string)
    return true
  })
  handle(IPC.transferResume, async (id) => {
    transfers.resume(id as string)
    return true
  })
  handle(IPC.transferResolve, async (id, action, newName) => {
    transfers.resolve(id as string, action as ConflictAction, newName as string | undefined)
    return true
  })
  handle(IPC.transferClear, async () => {
    transfers.clear()
    return true
  })
  handle(IPC.transferList, async () => transfers.list())

  // ---- Tunnels ----
  handle(IPC.tunnelStart, async (rule) => {
    const r = rule as TunnelRule
    const p = findServer(r.serverId)
    await ssh.startTunnel(r, p, jumpFor(p))
    return true
  })
  handle(IPC.tunnelStop, async (ruleId) => {
    ssh.stopTunnel(ruleId as string)
    return true
  })

  // ---- Auto-update ----
  setupAutoUpdater(getWindow)
  handle(IPC.updateCheck, async () => {
    await updater.check()
    return true
  })
  handle(IPC.updateDownload, async () => {
    await updater.download()
    return true
  })
  handle(IPC.updateInstall, async () => {
    updater.install()
    return true
  })
  handle(IPC.updateGetVersion, async () => updater.version())

  // ---- Window controls ----
  ipcMain.on(IPC.windowMinimize, () => getWindow()?.minimize())
  ipcMain.on(IPC.windowMaximize, () => {
    const w = getWindow()
    if (!w) return
    w.isMaximized() ? w.unmaximize() : w.maximize()
  })
  ipcMain.on(IPC.windowClose, () => getWindow()?.close())

  // Mini SSH panel mode — shrink + pin on top; restore previous bounds.
  let prevBounds: Electron.Rectangle | null = null
  ipcMain.on(IPC.windowSetMini, (_e, on: boolean) => {
    const w = getWindow()
    if (!w) return
    if (on) {
      prevBounds = w.getBounds()
      w.setAlwaysOnTop(true, 'floating')
      w.setMinimumSize(360, 240)
      const { workArea } = require('electron').screen.getPrimaryDisplay()
      const width = 480
      const height = 380
      w.setBounds({ width, height, x: workArea.x + workArea.width - width - 24, y: workArea.y + 24 }, true)
    } else {
      w.setAlwaysOnTop(false)
      w.setMinimumSize(920, 600)
      if (prevBounds) w.setBounds(prevBounds, true)
    }
  })

  return
}
