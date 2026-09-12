// Shared domain types used by both the main and renderer processes.

export type AuthMethod = 'password' | 'key' | 'agent'

/** A saved server connection profile. */
export interface ServerProfile {
  id: string
  name: string
  host: string
  port: number
  username: string
  authMethod: AuthMethod
  /** Plaintext only ever lives in the decrypted vault in memory / on disk encrypted. */
  password?: string
  /** Private key contents (PEM). Stored encrypted in the vault. */
  privateKey?: string
  passphrase?: string
  groupId: string | null
  tags: string[]
  color?: string
  /** Free-form notes (markdown-ish). */
  notes?: string
  /** Optional jump host (bastion) server id for ProxyJump-style chaining. */
  jumpHostId?: string | null
  /** Keepalive interval in seconds (0 = off). */
  keepaliveInterval?: number
  /** Remote desktop (VNC) — port on the server (default 5900) and optional password. */
  vncPort?: number
  vncPassword?: string
  /** RDP (Windows remote desktop) — opens the OS RDP client. */
  rdpPort?: number
  rdpUsername?: string
  createdAt: number
  updatedAt: number
  lastConnectedAt?: number
}

/** A group/folder for organizing servers (supports nesting via parentId). */
export interface Group {
  id: string
  name: string
  parentId: string | null
  color?: string
  collapsed?: boolean
  order: number
}

/** A reusable command snippet. */
export interface Snippet {
  id: string
  name: string
  command: string
  description?: string
  tags: string[]
  createdAt: number
  updatedAt: number
}

/** Port forwarding rule. */
export type TunnelType = 'local' | 'remote' | 'dynamic'

export interface TunnelRule {
  id: string
  serverId: string
  name: string
  type: TunnelType
  // local: localPort -> remoteHost:remotePort over server
  // remote: remotePort on server -> localHost:localPort
  // dynamic: SOCKS proxy on localPort
  localHost: string
  localPort: number
  remoteHost: string
  remotePort: number
  autoStart?: boolean
}

export type AiProvider = 'anthropic' | 'openai' | 'google' | 'openrouter' | 'custom'

export interface AiConfig {
  provider: AiProvider
  apiKey: string
  model: string
  baseUrl?: string // for 'custom' (OpenAI-compatible, e.g. Ollama/LM Studio)
}

export interface AiMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface AiReply {
  text: string
  truncated: boolean // hit max output tokens → can be continued
  rateLimit?: string // provider rate-limit remaining, if reported
  usage?: { input?: number; output?: number }
}

export type ThemeId =
  | 'midnight'
  | 'slate'
  | 'carbon'
  | 'ocean'
  | 'plum'
  | 'forest'
  | 'coffee'
  | 'claude'
  | 'sand'

export interface AppSettings {
  theme: ThemeId
  fontFamily: string
  fontSize: number
  cursorStyle: 'block' | 'underline' | 'bar'
  cursorBlink: boolean
  scrollback: number
  lockAfterMinutes: number // auto-lock idle vault, 0 = never
  copyOnSelect: boolean
  autoReconnect: boolean // reconnect dropped SSH sessions automatically
  notifications: boolean // desktop notifications
  backgroundMonitor: boolean // poll all servers in the background for history + alerts
  ai: AiConfig
}

/** The full decrypted vault — this is what gets serialized into the single encrypted file. */
export interface Vault {
  version: number
  servers: ServerProfile[]
  groups: Group[]
  snippets: Snippet[]
  tunnels: TunnelRule[]
  settings: AppSettings
  /** Project-wide encrypted scratchpad (passwords, notes). */
  notes?: string
  databases?: DbConnection[]
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'midnight',
  fontFamily: 'JetBrains Mono, SFMono-Regular, Menlo, monospace',
  fontSize: 13,
  cursorStyle: 'bar',
  cursorBlink: true,
  scrollback: 10000,
  lockAfterMinutes: 0,
  copyOnSelect: true,
  autoReconnect: true,
  notifications: true,
  backgroundMonitor: false,
  ai: { provider: 'anthropic', apiKey: '', model: 'claude-3-5-sonnet-latest' }
}

export function emptyVault(): Vault {
  return {
    version: 1,
    servers: [],
    groups: [],
    snippets: [],
    tunnels: [],
    settings: { ...DEFAULT_SETTINGS },
    notes: '',
    databases: []
  }
}

// ---- Runtime (non-persisted) session state shared over IPC ----

export type SessionStatus = 'connecting' | 'connected' | 'disconnected' | 'error'

export interface VaultStatus {
  exists: boolean // a vault file is present on disk
  unlocked: boolean // currently decrypted in memory
  path: string
  hasRemembered: boolean // a master password is stored for this device (auto-unlock)
}

/** Live system metrics for a server (best-effort, Linux). */
export interface ServerMetrics {
  reachable: boolean
  os?: string
  kernel?: string
  uptimeSec?: number
  load?: [number, number, number]
  cpuCount?: number
  memTotal?: number
  memUsed?: number
  memAvailable?: number
  diskTotal?: number
  diskUsed?: number
  diskAvailable?: number
  error?: string
}

// ---- SFTP ----

export interface SftpEntry {
  name: string
  path: string
  type: 'file' | 'directory' | 'symlink' | 'other'
  size: number
  mtime: number
  mode: number
  owner: number
  group: number
}

// ---- File transfer engine ----

export type TransferDirection = 'upload' | 'download'

export type TransferStatus =
  | 'queued'
  | 'scanning'
  | 'running'
  | 'waiting-conflict'
  | 'done'
  | 'error'
  | 'canceled'
  | 'interrupted'

export interface TransferTask {
  id: string
  serverId: string
  direction: TransferDirection
  /** Display name (file or folder name). */
  name: string
  localPath: string
  remotePath: string
  isDir: boolean
  /** Total bytes across all files in the task (0 until scanned). */
  size: number
  transferred: number
  status: TransferStatus
  error?: string
  startedAt?: number
  finishedAt?: number
}

export type ConflictAction = 'resume' | 'overwrite' | 'skip' | 'rename'

export interface TransferConflict {
  taskId: string
  direction: TransferDirection
  /** Entry name colliding at the destination. */
  name: string
  sourceSize: number
  targetSize: number
  /** Resume is only meaningful when part of the file already exists. */
  canResume: boolean
}

export interface TransferRequest {
  serverId: string
  direction: TransferDirection
  localPath: string
  remotePath: string
  isDir: boolean
}

// ---- Auto-update ----

export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface UpdateStatus {
  phase: UpdatePhase
  version?: string
  releaseNotes?: string
  percent?: number
  error?: string
  manualOnly?: boolean // update must be installed manually (e.g. unsigned macOS)
}

// ---- Database manager ----

export type DbType = 'postgres' | 'mysql' | 'redis'

export interface DbConnection {
  id: string
  name: string
  type: DbType
  host: string
  port: number
  username?: string
  password?: string
  database?: string
  /** Tunnel the DB connection through this server's SSH (null = direct). */
  sshServerId?: string | null
  color?: string
  createdAt: number
  updatedAt: number
}

export interface DbQueryResult {
  columns: string[]
  rows: Record<string, unknown>[]
  rowCount: number
  durationMs: number
  notice?: string
}

// ---- SSH key generation ----

export type KeyType = 'ed25519' | 'rsa'

export interface GeneratedKey {
  type: KeyType
  privateKey: string // OpenSSH PEM
  publicKey: string // single-line authorized_keys format
}

// ---- SSH config import ----

export interface ParsedSshHost {
  name: string
  host: string
  port: number
  username: string
  privateKey?: string // contents of IdentityFile if readable
  authMethod: AuthMethod
}

// ---- IPC channel result envelope ----

export interface IpcResult<T = unknown> {
  ok: boolean
  data?: T
  error?: string
}
