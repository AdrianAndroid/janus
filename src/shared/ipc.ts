// Central registry of IPC channel names. Keeps main <-> preload <-> renderer in sync.

export const IPC = {
  // Vault lifecycle
  vaultStatus: 'vault:status',
  vaultCreate: 'vault:create',
  vaultUnlock: 'vault:unlock',
  vaultLock: 'vault:lock',
  vaultChangePassword: 'vault:change-password',
  vaultRead: 'vault:read',
  vaultWrite: 'vault:write',
  vaultExport: 'vault:export',
  vaultImport: 'vault:import',
  vaultRemember: 'vault:remember',
  vaultForget: 'vault:forget',
  vaultAutoUnlock: 'vault:auto-unlock',

  // SSH session lifecycle
  sshConnect: 'ssh:connect',
  sshData: 'ssh:data', // renderer -> main (keystrokes)
  sshResize: 'ssh:resize',
  sshDisconnect: 'ssh:disconnect',
  sshExec: 'ssh:exec', // run a one-off command, return output
  sshMetrics: 'ssh:metrics', // gather live system metrics
  sshKeygen: 'ssh:keygen', // generate an SSH key pair
  sshInstallKey: 'ssh:install-key', // append a public key to authorized_keys

  // Live log / command streaming
  streamStart: 'stream:start',
  streamStop: 'stream:stop',
  streamOnData: 'stream:on-data',
  streamOnStatus: 'stream:on-status',

  // System integration
  touchIdAvailable: 'sys:touchid-available',
  touchIdPrompt: 'sys:touchid-prompt',

  // VNC remote desktop (WS↔TCP bridge, tunneled over SSH)
  vncStart: 'vnc:start',
  vncStop: 'vnc:stop',

  // RDP — launch the OS remote desktop client
  rdpLaunch: 'rdp:launch',

  // SSH config import/export
  sshConfigImport: 'sshconfig:import',
  sshConfigExport: 'sshconfig:export',

  // Desktop notifications
  notifyShow: 'notify:show',

  // AI copilot
  aiChat: 'ai:chat',

  // Database manager
  dbTest: 'db:test',
  dbQuery: 'db:query',
  dbTables: 'db:tables',
  dbClose: 'db:close',

  // System power events (main → renderer)
  systemResume: 'system:resume',
  systemSuspend: 'system:suspend',

  // SSH session events (main -> renderer, prefixed with session id)
  sshOnData: 'ssh:on-data',
  sshOnStatus: 'ssh:on-status',

  // SFTP
  sftpList: 'sftp:list',
  sftpDownload: 'sftp:download',
  sftpUpload: 'sftp:upload',
  sftpMkdir: 'sftp:mkdir',
  sftpRemove: 'sftp:remove',
  sftpRename: 'sftp:rename',
  sftpReadFile: 'sftp:read-file',
  sftpWriteFile: 'sftp:write-file',

  // Local filesystem (this machine)
  localHome: 'localfs:home',
  localList: 'localfs:list',
  localMkdir: 'localfs:mkdir',
  localRename: 'localfs:rename',
  localRemove: 'localfs:remove',
  localStat: 'localfs:stat',
  localDirSize: 'localfs:dir-size',

  // File transfer engine
  transferStart: 'transfer:start',
  transferCancel: 'transfer:cancel',
  transferResume: 'transfer:resume',
  transferResolve: 'transfer:resolve',
  transferClear: 'transfer:clear',
  transferList: 'transfer:list',
  transferProgress: 'transfer:progress', // main -> renderer event
  transferConflict: 'transfer:conflict', // main -> renderer event

  // Recursive remote delete
  sftpRemoveRecursive: 'sftp:remove-recursive',
  sftpDirSize: 'sftp:dir-size',

  // Tunnels / port forwarding
  tunnelStart: 'tunnel:start',
  tunnelStop: 'tunnel:stop',
  tunnelOnStatus: 'tunnel:on-status',

  // Media player
  mediaOpen: 'media:open',

  // Dialogs / misc
  dialogOpenFile: 'dialog:open-file',
  dialogSaveFile: 'dialog:save-file',
  windowMinimize: 'window:minimize',
  windowMaximize: 'window:maximize',
  windowClose: 'window:close',
  windowSetMini: 'window:set-mini',

  // Auto-update
  updateCheck: 'update:check',
  updateDownload: 'update:download',
  updateInstall: 'update:install',
  updateGetVersion: 'update:get-version',
  updateOnStatus: 'update:on-status'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
