import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type {
  Vault,
  ServerProfile,
  TunnelRule,
  SftpEntry,
  VaultStatus,
  UpdateStatus,
  ServerMetrics,
  GeneratedKey,
  KeyType,
  IpcResult
} from '../shared/types'

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const res = (await ipcRenderer.invoke(channel, ...args)) as IpcResult<T>
  if (!res.ok) throw new Error(res.error || 'Unknown error')
  return res.data as T
}

const api = {
  vault: {
    status: () => invoke<VaultStatus>(IPC.vaultStatus),
    create: (password: string) => invoke<Vault>(IPC.vaultCreate, password),
    unlock: (password: string) => invoke<Vault>(IPC.vaultUnlock, password),
    lock: () => invoke<boolean>(IPC.vaultLock),
    changePassword: (oldP: string, newP: string) => invoke<boolean>(IPC.vaultChangePassword, oldP, newP),
    read: () => invoke<Vault>(IPC.vaultRead),
    write: (vault: Vault) => invoke<boolean>(IPC.vaultWrite, vault),
    export: () => invoke<string | false>(IPC.vaultExport),
    import: (password: string) => invoke<Vault | false>(IPC.vaultImport, password),
    remember: (password?: string) => invoke<boolean>(IPC.vaultRemember, password),
    forget: () => invoke<boolean>(IPC.vaultForget),
    autoUnlock: () => invoke<Vault>(IPC.vaultAutoUnlock)
  },
  ssh: {
    connect: (sessionId: string, serverId: string, cols: number, rows: number) =>
      invoke<boolean>(IPC.sshConnect, sessionId, serverId, cols, rows),
    data: (sessionId: string, data: string) => ipcRenderer.send(IPC.sshData, sessionId, data),
    resize: (sessionId: string, cols: number, rows: number) => ipcRenderer.send(IPC.sshResize, sessionId, cols, rows),
    disconnect: (sessionId: string) => ipcRenderer.send(IPC.sshDisconnect, sessionId),
    exec: (serverId: string, command: string) =>
      invoke<{ stdout: string; stderr: string; code: number }>(IPC.sshExec, serverId, command),
    metrics: (serverId: string) => invoke<ServerMetrics>(IPC.sshMetrics, serverId),
    keygen: (type: KeyType, comment: string) => invoke<GeneratedKey>(IPC.sshKeygen, type, comment),
    installKey: (serverId: string, publicKey: string) => invoke<boolean>(IPC.sshInstallKey, serverId, publicKey),
    onData: (sessionId: string, cb: (data: string) => void) => {
      const ch = `data:${sessionId}`
      const listener = (_e: unknown, payload: string): void => cb(payload)
      ipcRenderer.on(ch, listener)
      return () => {
        ipcRenderer.removeListener(ch, listener)
      }
    },
    onStatus: (sessionId: string, cb: (payload: { status: string; message?: string }) => void) => {
      const ch = `status:${sessionId}`
      const listener = (_e: unknown, payload: { status: string; message?: string }): void => cb(payload)
      ipcRenderer.on(ch, listener)
      return () => {
        ipcRenderer.removeListener(ch, listener)
      }
    }
  },
  sftp: {
    list: (serverId: string, path: string) =>
      invoke<{ cwd: string; entries: SftpEntry[] }>(IPC.sftpList, serverId, path),
    download: (serverId: string, remote: string) => invoke<string | false>(IPC.sftpDownload, serverId, remote),
    upload: (serverId: string, remoteDir: string) => invoke<number | false>(IPC.sftpUpload, serverId, remoteDir),
    mkdir: (serverId: string, path: string) => invoke<boolean>(IPC.sftpMkdir, serverId, path),
    remove: (serverId: string, path: string, isDir: boolean) => invoke<boolean>(IPC.sftpRemove, serverId, path, isDir),
    removeRecursive: (serverId: string, path: string) => invoke<boolean>(IPC.sftpRemoveRecursive, serverId, path),
    dirSize: (serverId: string, path: string) => invoke<number>(IPC.sftpDirSize, serverId, path),
    stat: (serverId: string, path: string) => invoke<{ size: number; isDirectory: boolean } | null>(IPC.sftpStat, serverId, path),
    rename: (serverId: string, from: string, to: string) => invoke<boolean>(IPC.sftpRename, serverId, from, to),
    readFile: (serverId: string, path: string) => invoke<string>(IPC.sftpReadFile, serverId, path),
    writeFile: (serverId: string, path: string, content: string) =>
      invoke<boolean>(IPC.sftpWriteFile, serverId, path, content)
  },
  localFs: {
    home: () => invoke<string>(IPC.localHome),
    list: (path: string) => invoke<{ cwd: string; entries: SftpEntry[] }>(IPC.localList, path),
    mkdir: (path: string) => invoke<boolean>(IPC.localMkdir, path),
    rename: (from: string, to: string) => invoke<boolean>(IPC.localRename, from, to),
    remove: (path: string) => invoke<boolean>(IPC.localRemove, path),
    stat: (path: string) => invoke<SftpEntry | null>(IPC.localStat, path),
    dirSize: (path: string) => invoke<number>(IPC.localDirSize, path)
  },
  transfer: {
    start: (req: import('../shared/types').TransferRequest) => invoke<string>(IPC.transferStart, req),
    cancel: (id: string) => invoke<boolean>(IPC.transferCancel, id),
    resume: (id: string) => invoke<boolean>(IPC.transferResume, id),
    resolve: (id: string, action: import('../shared/types').ConflictAction, newName?: string) =>
      invoke<boolean>(IPC.transferResolve, id, action, newName),
    clear: () => invoke<boolean>(IPC.transferClear),
    list: () => invoke<import('../shared/types').TransferTask[]>(IPC.transferList),
    onProgress: (cb: (task: import('../shared/types').TransferTask) => void) => {
      const listener = (_e: unknown, payload: import('../shared/types').TransferTask): void => cb(payload)
      ipcRenderer.on(IPC.transferProgress, listener)
      return () => {
        ipcRenderer.removeListener(IPC.transferProgress, listener)
      }
    },
    onConflict: (cb: (conflict: import('../shared/types').TransferConflict) => void) => {
      const listener = (_e: unknown, payload: import('../shared/types').TransferConflict): void => cb(payload)
      ipcRenderer.on(IPC.transferConflict, listener)
      return () => {
        ipcRenderer.removeListener(IPC.transferConflict, listener)
      }
    }
  },
  tunnel: {
    start: (rule: TunnelRule) => invoke<boolean>(IPC.tunnelStart, rule),
    stop: (ruleId: string) => invoke<boolean>(IPC.tunnelStop, ruleId),
    onStatus: (ruleId: string, cb: (payload: { status: string; message?: string }) => void) => {
      const ch = `tunnel:${ruleId}`
      const listener = (_e: unknown, payload: { status: string; message?: string }): void => cb(payload)
      ipcRenderer.on(ch, listener)
      return () => {
        ipcRenderer.removeListener(ch, listener)
      }
    }
  },
  stream: {
    start: (streamId: string, serverId: string, command: string) =>
      invoke<boolean>(IPC.streamStart, streamId, serverId, command),
    stop: (streamId: string) => ipcRenderer.send(IPC.streamStop, streamId),
    onData: (streamId: string, cb: (data: string) => void) => {
      const ch = `logdata:${streamId}`
      const listener = (_e: unknown, payload: string): void => cb(payload)
      ipcRenderer.on(ch, listener)
      return () => {
        ipcRenderer.removeListener(ch, listener)
      }
    },
    onStatus: (streamId: string, cb: (payload: { status: string; message?: string }) => void) => {
      const ch = `logstatus:${streamId}`
      const listener = (_e: unknown, payload: { status: string; message?: string }): void => cb(payload)
      ipcRenderer.on(ch, listener)
      return () => {
        ipcRenderer.removeListener(ch, listener)
      }
    }
  },
  system: {
    touchIdAvailable: () => invoke<boolean>(IPC.touchIdAvailable),
    touchIdPrompt: (reason: string) => invoke<boolean>(IPC.touchIdPrompt, reason)
  },
  vnc: {
    start: (sessionId: string, serverId: string) => invoke<number>(IPC.vncStart, sessionId, serverId),
    stop: (sessionId: string) => ipcRenderer.send(IPC.vncStop, sessionId),
    popout: (serverId: string) => invoke<boolean>(IPC.vncPopout, serverId)
  },
  rdp: {
    launch: (serverId: string) => invoke<boolean>(IPC.rdpLaunch, serverId)
  },
  sshConfig: {
    import: () => invoke<import('../shared/types').ParsedSshHost[]>(IPC.sshConfigImport),
    export: () => invoke<string>(IPC.sshConfigExport)
  },
  notify: (title: string, body: string) => ipcRenderer.send(IPC.notifyShow, title, body),
  media: {
    open: (req: import('../shared/types').MediaOpenRequest) => invoke<boolean>(IPC.mediaOpen, req)
  },
  viewer: {
    open: (req: { path: string; serverId?: string; kind: import('../shared/viewer').ViewerKind }) =>
      invoke<boolean>(IPC.viewerOpen, req)
  },
  diskUsage: {
    openWindow: (req: { target: import('../shared/disk-usage').DiskTarget; initialPath?: string }) =>
      invoke<boolean>(IPC.diskOpenWindow, req),
    onFilesChanged: (cb: (payload: { target: import('../shared/disk-usage').DiskTarget; affectedPaths: string[]; operationId: string }) => void) => {
      const listener = (_e: unknown, payload: { target: import('../shared/disk-usage').DiskTarget; affectedPaths: string[]; operationId: string }): void => cb(payload)
      ipcRenderer.on(IPC.diskFilesChanged, listener)
      return () => {
        ipcRenderer.removeListener(IPC.diskFilesChanged, listener)
      }
    },
    onOpenInFiles: (cb: (req: import('../shared/disk-usage').OpenInFilesRequest) => void) => {
      const listener = (_e: unknown, payload: import('../shared/disk-usage').OpenInFilesRequest): void => cb(payload)
      ipcRenderer.on(IPC.diskOpenInFilesRequest, listener)
      return () => {
        ipcRenderer.removeListener(IPC.diskOpenInFilesRequest, listener)
      }
    }
  },
  ai: {
    chat: (messages: import('../shared/types').AiMessage[], system: string) =>
      invoke<import('../shared/types').AiReply>(IPC.aiChat, messages, system)
  },
  db: {
    test: (conn: import('../shared/types').DbConnection) => invoke<boolean>(IPC.dbTest, conn),
    query: (conn: import('../shared/types').DbConnection, sql: string) =>
      invoke<import('../shared/types').DbQueryResult>(IPC.dbQuery, conn, sql),
    tables: (conn: import('../shared/types').DbConnection) => invoke<string[]>(IPC.dbTables, conn),
    close: (id: string) => invoke<boolean>(IPC.dbClose, id)
  },
  power: {
    onResume: (cb: () => void) => {
      const listener = (): void => cb()
      ipcRenderer.on(IPC.systemResume, listener)
      return () => {
        ipcRenderer.removeListener(IPC.systemResume, listener)
      }
    },
    onSuspend: (cb: () => void) => {
      const listener = (): void => cb()
      ipcRenderer.on(IPC.systemSuspend, listener)
      return () => {
        ipcRenderer.removeListener(IPC.systemSuspend, listener)
      }
    }
  },
  updates: {
    check: () => invoke<boolean>(IPC.updateCheck),
    download: () => invoke<boolean>(IPC.updateDownload),
    install: () => invoke<boolean>(IPC.updateInstall),
    version: () => invoke<string>(IPC.updateGetVersion),
    onStatus: (cb: (status: UpdateStatus) => void) => {
      const listener = (_e: unknown, payload: UpdateStatus): void => cb(payload)
      ipcRenderer.on(IPC.updateOnStatus, listener)
      return () => {
        ipcRenderer.removeListener(IPC.updateOnStatus, listener)
      }
    }
  },
  window: {
    minimize: () => ipcRenderer.send(IPC.windowMinimize),
    maximize: () => ipcRenderer.send(IPC.windowMaximize),
    close: () => ipcRenderer.send(IPC.windowClose),
    setMini: (on: boolean) => ipcRenderer.send(IPC.windowSetMini, on)
  }
}

contextBridge.exposeInMainWorld('janus', api)

export type JanusApi = typeof api
