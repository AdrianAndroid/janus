import { create } from 'zustand'
import { v4 as uuid } from 'uuid'
import type {
  Vault,
  ServerProfile,
  Group,
  Snippet,
  TunnelRule,
  AppSettings,
  SessionStatus,
  DbConnection,
  ConflictAction,
  TransferConflict,
  TransferDirection,
  TransferRequest,
  TransferTask
} from '@shared/types'

// --- Lightweight UI-preference persistence (localStorage). NEVER store the
// vault here — only non-sensitive UI state so the app remembers where you were.
const LS_KEY = 'janus.ui'
function loadPrefs(): {
  sidePanel?: UIState['sidePanel']
  selectedServerId?: string | null
  notesOpen?: boolean
  copilotOpen?: boolean
} {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || '{}')
  } catch {
    return {}
  }
}
function savePrefs(patch: Record<string, unknown>): void {
  try {
    const cur = loadPrefs()
    localStorage.setItem(LS_KEY, JSON.stringify({ ...cur, ...patch }))
  } catch {
    /* ignore quota / private mode */
  }
}
const prefs = loadPrefs()

export type TabKind = 'terminal' | 'sftp' | 'docker' | 'logs' | 'vnc' | 'db'

export interface Tab {
  id: string
  kind: TabKind
  serverId: string
  title: string
  status: SessionStatus
}

interface UIState {
  // vault
  vault: Vault | null
  locked: boolean
  hasVault: boolean
  loading: boolean
  error: string | null

  // selection / navigation
  selectedServerId: string | null
  search: string
  activeTagFilter: string | null
  sidePanel: 'servers' | 'dashboard' | 'broadcast' | 'databases' | 'snippets' | 'tunnels' | 'settings'

  // modals
  editingServer: ServerProfile | null
  serverFormOpen: boolean
  groupFormOpen: boolean
  editingGroup: Group | null

  // tabs / sessions
  tabs: Tab[]
  activeTabId: string | null

  // command palette
  paletteOpen: boolean

  // floating notes
  notesOpen: boolean

  // mini ssh panel mode
  miniMode: boolean

  // AI copilot right dock
  copilotOpen: boolean

  // file transfers
  transfers: TransferTask[]
  conflicts: TransferConflict[]
  rememberedActions: Partial<Record<TransferDirection, ConflictAction>>
}

interface Actions {
  init: () => Promise<void>
  createVault: (password: string, remember?: boolean) => Promise<void>
  unlock: (password: string, remember?: boolean) => Promise<void>
  lock: () => Promise<void>
  persist: () => Promise<void>

  // server CRUD
  upsertServer: (server: ServerProfile) => Promise<void>
  deleteServer: (id: string) => Promise<void>
  duplicateServer: (id: string) => Promise<void>
  markConnected: (id: string) => Promise<void>

  // group CRUD
  upsertGroup: (group: Group) => Promise<void>
  deleteGroup: (id: string) => Promise<void>
  toggleGroup: (id: string) => Promise<void>

  // drag & drop
  moveServerToGroup: (serverId: string, groupId: string | null) => Promise<void>
  moveGroupToParent: (groupId: string, parentId: string | null) => Promise<void>

  // snippet CRUD
  upsertSnippet: (s: Snippet) => Promise<void>
  deleteSnippet: (id: string) => Promise<void>

  // tunnel CRUD
  upsertTunnel: (t: TunnelRule) => Promise<void>
  deleteTunnel: (id: string) => Promise<void>

  // database CRUD
  upsertDatabase: (d: DbConnection) => Promise<void>
  deleteDatabase: (id: string) => Promise<void>
  openDb: (connId: string) => void

  // settings
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>

  // integrations
  notify: (title: string, body: string) => void
  importSshConfig: () => Promise<{ added: number; skipped: number }>

  // ui
  setSearch: (q: string) => void
  setTagFilter: (t: string | null) => void
  setSidePanel: (p: UIState['sidePanel']) => void
  selectServer: (id: string | null) => void
  openServerForm: (server?: ServerProfile) => void
  closeServerForm: () => void
  openGroupForm: (group?: Group) => void
  closeGroupForm: () => void

  // tabs
  openTerminal: (serverId: string) => void
  openSftp: (serverId: string) => void
  openDocker: (serverId: string) => void
  openLogs: (serverId: string) => void
  openVnc: (serverId: string) => void
  closeTab: (tabId: string) => void
  closeActiveTab: () => void
  closeOtherTabs: (tabId: string) => void
  closeAllTabs: () => void
  reorderTab: (fromId: string, toId: string) => void
  setActiveTab: (tabId: string) => void
  setTabStatus: (tabId: string, status: SessionStatus) => void

  // command palette
  setPalette: (open: boolean) => void

  // notes
  toggleNotes: () => void
  setNotes: (text: string) => void

  // mini mode
  setMini: (on: boolean) => void

  // copilot dock
  toggleCopilot: () => void

  // file transfers
  initTransferListeners: () => void
  startTransfer: (req: TransferRequest) => Promise<void>
  cancelTransfer: (id: string) => Promise<void>
  resumeTransfer: (id: string) => Promise<void>
  clearFinishedTransfers: () => Promise<void>
  resolveConflict: (taskId: string, action: ConflictAction, remember: boolean, newName?: string) => Promise<void>
}

export const useStore = create<UIState & Actions>((set, get) => ({
  vault: null,
  locked: true,
  hasVault: false,
  loading: true,
  error: null,

  selectedServerId: prefs.selectedServerId ?? null,
  search: '',
  activeTagFilter: null,
  sidePanel: prefs.sidePanel ?? 'servers',

  editingServer: null,
  serverFormOpen: false,
  groupFormOpen: false,
  editingGroup: null,

  tabs: [],
  activeTabId: null,
  paletteOpen: false,
  notesOpen: prefs.notesOpen ?? false,
  miniMode: false,
  copilotOpen: prefs.copilotOpen ?? false,

  transfers: [],
  conflicts: [],
  rememberedActions: {},

  async init() {
    set({ loading: true })
    const status = await window.janus.vault.status()
    // Already unlocked in the main process (e.g. a dev reload) — load the vault
    // so the sidebar isn't empty. (Fixes "no servers until lock/unlock".)
    if (status.unlocked) {
      try {
        const vault = await window.janus.vault.read()
        set({ vault, hasVault: true, locked: false, loading: false })
        return
      } catch {
        /* fall through */
      }
    }
    // Auto-unlock when the master password is remembered on this device.
    if (status.exists && status.hasRemembered) {
      try {
        const vault = await window.janus.vault.autoUnlock()
        set({ vault, hasVault: true, locked: false, loading: false })
        return
      } catch {
        /* stored credential invalid → show the lock screen */
      }
    }
    set({ hasVault: status.exists, locked: !status.unlocked, loading: false })
  },

  async createVault(password, remember = false) {
    const vault = await window.janus.vault.create(password)
    if (remember) await window.janus.vault.remember(password).catch(() => undefined)
    set({ vault, locked: false, hasVault: true, error: null })
  },

  async unlock(password, remember = false) {
    try {
      const vault = await window.janus.vault.unlock(password)
      if (remember) await window.janus.vault.remember(password).catch(() => undefined)
      set({ vault, locked: false, error: null })
    } catch (e) {
      set({ error: (e as Error).message })
      throw e
    }
  },

  async lock() {
    await window.janus.vault.lock()
    set({ vault: null, locked: true, tabs: [], activeTabId: null, selectedServerId: null })
  },

  async persist() {
    const v = get().vault
    if (v) await window.janus.vault.write(v)
  },

  async upsertServer(server) {
    const v = get().vault
    if (!v) return
    const now = Date.now()
    const idx = v.servers.findIndex((s) => s.id === server.id)
    const next = { ...server, updatedAt: now }
    const servers = idx >= 0 ? v.servers.map((s) => (s.id === server.id ? next : s)) : [...v.servers, { ...next, createdAt: now }]
    set({ vault: { ...v, servers } })
    await get().persist()
  },

  async deleteServer(id) {
    const v = get().vault
    if (!v) return
    set({
      vault: { ...v, servers: v.servers.filter((s) => s.id !== id) },
      selectedServerId: get().selectedServerId === id ? null : get().selectedServerId
    })
    await get().persist()
  },

  async duplicateServer(id) {
    const v = get().vault
    if (!v) return
    const src = v.servers.find((s) => s.id === id)
    if (!src) return
    const now = Date.now()
    const copy: ServerProfile = { ...src, id: uuid(), name: `${src.name} (copy)`, createdAt: now, updatedAt: now }
    set({ vault: { ...v, servers: [...v.servers, copy] } })
    await get().persist()
  },

  async markConnected(id) {
    const v = get().vault
    if (!v) return
    set({ vault: { ...v, servers: v.servers.map((s) => (s.id === id ? { ...s, lastConnectedAt: Date.now() } : s)) } })
    await get().persist()
  },

  async upsertGroup(group) {
    const v = get().vault
    if (!v) return
    const idx = v.groups.findIndex((g) => g.id === group.id)
    const groups = idx >= 0 ? v.groups.map((g) => (g.id === group.id ? group : g)) : [...v.groups, group]
    set({ vault: { ...v, groups } })
    await get().persist()
  },

  async deleteGroup(id) {
    const v = get().vault
    if (!v) return
    // Move children groups & servers to root.
    const groups = v.groups.filter((g) => g.id !== id).map((g) => (g.parentId === id ? { ...g, parentId: null } : g))
    const servers = v.servers.map((s) => (s.groupId === id ? { ...s, groupId: null } : s))
    set({ vault: { ...v, groups, servers } })
    await get().persist()
  },

  async toggleGroup(id) {
    const v = get().vault
    if (!v) return
    set({ vault: { ...v, groups: v.groups.map((g) => (g.id === id ? { ...g, collapsed: !g.collapsed } : g)) } })
    await get().persist()
  },

  async moveServerToGroup(serverId, groupId) {
    const v = get().vault
    if (!v) return
    const srv = v.servers.find((s) => s.id === serverId)
    if (!srv || srv.groupId === groupId) return
    set({
      vault: {
        ...v,
        servers: v.servers.map((s) => (s.id === serverId ? { ...s, groupId, updatedAt: Date.now() } : s))
      }
    })
    await get().persist()
  },

  async moveGroupToParent(groupId, parentId) {
    const v = get().vault
    if (!v) return
    if (groupId === parentId) return
    // Prevent cycles: parentId must not be a descendant of groupId.
    let p: string | null = parentId
    while (p) {
      if (p === groupId) return // would create a loop
      p = v.groups.find((g) => g.id === p)?.parentId ?? null
    }
    set({ vault: { ...v, groups: v.groups.map((g) => (g.id === groupId ? { ...g, parentId } : g)) } })
    await get().persist()
  },

  async upsertSnippet(s) {
    const v = get().vault
    if (!v) return
    const idx = v.snippets.findIndex((x) => x.id === s.id)
    const snippets = idx >= 0 ? v.snippets.map((x) => (x.id === s.id ? s : x)) : [...v.snippets, s]
    set({ vault: { ...v, snippets } })
    await get().persist()
  },

  async deleteSnippet(id) {
    const v = get().vault
    if (!v) return
    set({ vault: { ...v, snippets: v.snippets.filter((s) => s.id !== id) } })
    await get().persist()
  },

  async upsertTunnel(t) {
    const v = get().vault
    if (!v) return
    const idx = v.tunnels.findIndex((x) => x.id === t.id)
    const tunnels = idx >= 0 ? v.tunnels.map((x) => (x.id === t.id ? t : x)) : [...v.tunnels, t]
    set({ vault: { ...v, tunnels } })
    await get().persist()
  },

  async deleteTunnel(id) {
    const v = get().vault
    if (!v) return
    set({ vault: { ...v, tunnels: v.tunnels.filter((t) => t.id !== id) } })
    await get().persist()
  },

  async upsertDatabase(d) {
    const v = get().vault
    if (!v) return
    const list = v.databases ?? []
    const idx = list.findIndex((x) => x.id === d.id)
    const databases = idx >= 0 ? list.map((x) => (x.id === d.id ? d : x)) : [...list, d]
    set({ vault: { ...v, databases } })
    await get().persist()
  },

  async deleteDatabase(id) {
    const v = get().vault
    if (!v) return
    set({ vault: { ...v, databases: (v.databases ?? []).filter((d) => d.id !== id) } })
    await get().persist()
  },

  openDb(connId) {
    const v = get().vault
    const conn = (v?.databases ?? []).find((d) => d.id === connId)
    if (!conn) return
    const tab: Tab = { id: uuid(), kind: 'db', serverId: connId, title: `${conn.name}`, status: 'connecting' }
    set({ tabs: [...get().tabs, tab], activeTabId: tab.id })
  },

  async updateSettings(patch) {
    const v = get().vault
    if (!v) return
    set({ vault: { ...v, settings: { ...v.settings, ...patch } } })
    await get().persist()
  },

  notify(title, body) {
    if (get().vault?.settings.notifications === false) return
    window.janus.notify(title, body)
  },

  async importSshConfig() {
    const v = get().vault
    if (!v) return { added: 0, skipped: 0 }
    const entries = await window.janus.sshConfig.import()
    const now = Date.now()
    let added = 0
    let skipped = 0
    const servers = [...v.servers]
    for (const e of entries) {
      if (servers.some((s) => s.host === e.host && s.username === e.username)) {
        skipped++
        continue
      }
      servers.push({
        id: uuid(),
        name: e.name,
        host: e.host,
        port: e.port,
        username: e.username,
        authMethod: e.authMethod,
        password: '',
        privateKey: e.privateKey || '',
        passphrase: '',
        groupId: null,
        tags: ['imported'],
        color: '#6366f1',
        notes: '',
        jumpHostId: null,
        keepaliveInterval: 20,
        createdAt: now,
        updatedAt: now
      })
      added++
    }
    set({ vault: { ...v, servers } })
    await get().persist()
    return { added, skipped }
  },

  setSearch: (q) => set({ search: q }),
  setTagFilter: (t) => set({ activeTagFilter: t }),
  setSidePanel: (p) => {
    savePrefs({ sidePanel: p })
    set({ sidePanel: p })
  },
  selectServer: (id) => {
    savePrefs({ selectedServerId: id })
    set({ selectedServerId: id })
  },
  openServerForm: (server) => set({ serverFormOpen: true, editingServer: server ?? null }),
  closeServerForm: () => set({ serverFormOpen: false, editingServer: null }),
  openGroupForm: (group) => set({ groupFormOpen: true, editingGroup: group ?? null }),
  closeGroupForm: () => set({ groupFormOpen: false, editingGroup: null }),

  openTerminal(serverId) {
    const v = get().vault
    const server = v?.servers.find((s) => s.id === serverId)
    if (!server) return
    const tab: Tab = { id: uuid(), kind: 'terminal', serverId, title: server.name, status: 'connecting' }
    set({ tabs: [...get().tabs, tab], activeTabId: tab.id })
    get().markConnected(serverId)
  },

  openSftp(serverId) {
    const v = get().vault
    const server = v?.servers.find((s) => s.id === serverId)
    if (!server) return
    const tab: Tab = { id: uuid(), kind: 'sftp', serverId, title: `Files · ${server.name}`, status: 'connecting' }
    set({ tabs: [...get().tabs, tab], activeTabId: tab.id })
  },

  openDocker(serverId) {
    const v = get().vault
    const server = v?.servers.find((s) => s.id === serverId)
    if (!server) return
    const tab: Tab = { id: uuid(), kind: 'docker', serverId, title: `Services · ${server.name}`, status: 'connecting' }
    set({ tabs: [...get().tabs, tab], activeTabId: tab.id })
  },

  openLogs(serverId) {
    const v = get().vault
    const server = v?.servers.find((s) => s.id === serverId)
    if (!server) return
    const tab: Tab = { id: uuid(), kind: 'logs', serverId, title: `Logs · ${server.name}`, status: 'connecting' }
    set({ tabs: [...get().tabs, tab], activeTabId: tab.id })
  },

  openVnc(serverId) {
    const v = get().vault
    const server = v?.servers.find((s) => s.id === serverId)
    if (!server) return
    const tab: Tab = { id: uuid(), kind: 'vnc', serverId, title: `Desktop · ${server.name}`, status: 'connecting' }
    set({ tabs: [...get().tabs, tab], activeTabId: tab.id })
  },

  closeTab(tabId) {
    const tabs = get().tabs.filter((t) => t.id !== tabId)
    let active = get().activeTabId
    if (active === tabId) active = tabs.length ? tabs[tabs.length - 1].id : null
    set({ tabs, activeTabId: active })
  },

  closeActiveTab() {
    const id = get().activeTabId
    if (id) get().closeTab(id)
  },

  closeOtherTabs(tabId) {
    set({ tabs: get().tabs.filter((t) => t.id === tabId), activeTabId: tabId })
  },

  closeAllTabs() {
    set({ tabs: [], activeTabId: null })
  },

  reorderTab(fromId, toId) {
    const tabs = [...get().tabs]
    const from = tabs.findIndex((t) => t.id === fromId)
    const to = tabs.findIndex((t) => t.id === toId)
    if (from < 0 || to < 0 || from === to) return
    const [moved] = tabs.splice(from, 1)
    tabs.splice(to, 0, moved)
    set({ tabs })
  },

  setActiveTab: (tabId) => set({ activeTabId: tabId }),
  setTabStatus: (tabId, status) =>
    set({ tabs: get().tabs.map((t) => (t.id === tabId ? { ...t, status } : t)) }),

  setPalette: (open) => set({ paletteOpen: open }),

  // ---- file transfers ----

  initTransferListeners() {
    if (transferListenersReady) return
    transferListenersReady = true
    window.janus.transfer.onProgress((task) => {
      const list = get().transfers
      const idx = list.findIndex((t) => t.id === task.id)
      set({ transfers: idx >= 0 ? list.map((t) => (t.id === task.id ? task : t)) : [...list, task] })
    })
    window.janus.transfer.onConflict((conflict) => {
      const remembered = get().rememberedActions[conflict.direction]
      if (remembered) {
        void window.janus.transfer.resolve(conflict.taskId, remembered)
        return
      }
      if (!get().conflicts.some((c) => c.taskId === conflict.taskId)) {
        set({ conflicts: [...get().conflicts, conflict] })
      }
    })
  },

  async startTransfer(req) {
    await window.janus.transfer.start(req)
  },

  async cancelTransfer(id) {
    await window.janus.transfer.cancel(id)
  },

  async resumeTransfer(id) {
    await window.janus.transfer.resume(id)
  },

  async clearFinishedTransfers() {
    await window.janus.transfer.clear()
    set({ transfers: get().transfers.filter((t) => !['done', 'error', 'canceled'].includes(t.status)) })
  },

  async resolveConflict(taskId, action, remember, newName) {
    const conflict = get().conflicts.find((c) => c.taskId === taskId)
    await window.janus.transfer.resolve(taskId, action, newName)
    if (remember && conflict && action !== 'rename') {
      set({ rememberedActions: { ...get().rememberedActions, [conflict.direction]: action } })
    }
    set({ conflicts: get().conflicts.filter((c) => c.taskId !== taskId) })
  },

  toggleNotes() {
    const open = !get().notesOpen
    savePrefs({ notesOpen: open })
    set({ notesOpen: open })
  },

  setNotes(text) {
    const v = get().vault
    if (!v) return
    set({ vault: { ...v, notes: text } })
    clearTimeout(notesTimer)
    notesTimer = setTimeout(() => {
      get().persist()
    }, 600)
  },

  setMini(on) {
    window.janus.window.setMini(on)
    // Ensure the tab content (terminal) is what shows in mini mode.
    set(on ? { miniMode: true, sidePanel: 'servers' } : { miniMode: false })
  },

  toggleCopilot() {
    const open = !get().copilotOpen
    savePrefs({ copilotOpen: open })
    set({ copilotOpen: open })
  }
}))

let notesTimer: ReturnType<typeof setTimeout> | undefined
let transferListenersReady = false
