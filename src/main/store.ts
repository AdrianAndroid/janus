import { app, safeStorage } from 'electron'
import { readFile, writeFile, mkdir, access, rename, unlink } from 'fs/promises'
import { constants } from 'fs'
import { join, dirname } from 'path'
import { encryptVault, decryptVault, EncryptedFile } from './crypto'
import { Vault, emptyVault, DEFAULT_SETTINGS } from '@shared/types'

/**
 * VaultStore owns the single encrypted file that holds every server, group,
 * tag, snippet and tunnel. Mirrors the Postman "one collection file" idea but
 * encrypted with the user's master password (AES-256-GCM).
 */
class VaultStore {
  private password: string | null = null
  private cache: Vault | null = null

  /** Default location of the vault file. */
  get filePath(): string {
    return join(app.getPath('userData'), 'janus.vault.json')
  }

  /** Location of the per-device remembered master password (OS-encrypted). */
  private get credPath(): string {
    return join(app.getPath('userData'), 'janus.device.cred')
  }

  // ---- "Remember on this device" (OS keychain via safeStorage) ----

  async hasRemembered(): Promise<boolean> {
    try {
      await access(this.credPath, constants.F_OK)
      return safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  }

  /**
   * Persist a master password for this device, encrypted by the OS keychain.
   * If no password is given, remembers the currently-unlocked one.
   */
  async rememberPassword(password?: string): Promise<void> {
    const pw = password || this.password
    if (!pw) throw new Error('No password to remember (vault is locked).')
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure storage is not available on this device.')
    const enc = safeStorage.encryptString(pw)
    await writeFile(this.credPath, enc.toString('base64'), 'utf8')
  }

  /** Forget the remembered password for this device. */
  async forget(): Promise<void> {
    try {
      await unlink(this.credPath)
    } catch {
      /* already gone */
    }
  }

  /** Unlock using the remembered device password. Throws if none / invalid. */
  async autoUnlock(): Promise<Vault> {
    const b64 = await readFile(this.credPath, 'utf8')
    const password = safeStorage.decryptString(Buffer.from(b64, 'base64'))
    try {
      return await this.unlock(password)
    } catch (e) {
      // Stored password no longer valid (e.g. changed) — clear it.
      await this.forget()
      throw e
    }
  }

  get isUnlocked(): boolean {
    return this.cache !== null && this.password !== null
  }

  async exists(): Promise<boolean> {
    try {
      await access(this.filePath, constants.F_OK)
      return true
    } catch {
      return false
    }
  }

  private async readEncrypted(path: string): Promise<EncryptedFile> {
    const raw = await readFile(path, 'utf8')
    return JSON.parse(raw) as EncryptedFile
  }

  /** Create a brand new vault protected by the given master password. */
  async create(password: string): Promise<void> {
    if (await this.exists()) throw new Error('Vault already exists.')
    if (!password || password.length < 4) throw new Error('Master password must be at least 4 characters.')
    this.password = password
    this.cache = emptyVault()
    await this.flush()
  }

  /** Unlock the existing vault with the master password; loads it into memory. */
  async unlock(password: string): Promise<Vault> {
    const file = await this.readEncrypted(this.filePath)
    const json = decryptVault(file, password) // throws on bad password
    const vault = this.normalize(JSON.parse(json))
    this.password = password
    this.cache = vault
    return vault
  }

  /** Drop the decrypted vault and password from memory. */
  lock(): void {
    this.password = null
    this.cache = null
  }

  /** Return the in-memory vault (must be unlocked). */
  read(): Vault {
    if (!this.cache)     throw new Error('Vault is locked.')
    return this.cache
  }

  /** Replace the whole vault and persist. */
  async write(vault: Vault): Promise<void> {
    if (!this.password)     throw new Error('Vault is locked.')
    this.cache = this.normalize(vault)
    await this.flush()
  }

  async changePassword(oldPassword: string, newPassword: string): Promise<void> {
    if (!this.cache || !this.password)     throw new Error('Vault is locked.')
    if (this.password !== oldPassword) throw new Error('Current password is incorrect.')
    if (!newPassword || newPassword.length < 4) throw new Error('New password must be at least 4 characters.')
    this.password = newPassword
    await this.flush()
    // Keep the device credential in sync if it was being remembered.
    if (await this.hasRemembered()) await this.rememberPassword(newPassword)
  }

  /** Export the encrypted file to an arbitrary path (already-encrypted, portable). */
  async exportTo(path: string): Promise<void> {
    if (!this.cache || !this.password)     throw new Error('Vault is locked.')
    const file = encryptVault(JSON.stringify(this.cache), this.password)
    await writeFile(path, JSON.stringify(file, null, 2), 'utf8')
  }

  /** Import (and unlock) a vault file from an arbitrary path with its password. */
  async importFrom(path: string, password: string): Promise<Vault> {
    const file = await this.readEncrypted(path)
    const json = decryptVault(file, password)
    const vault = this.normalize(JSON.parse(json))
    // Adopt it as the active vault under the same password.
    this.password = password
    this.cache = vault
    await this.flush()
    return vault
  }

  /** Encrypt the in-memory vault and atomically write it to disk. */
  private async flush(): Promise<void> {
    if (!this.cache || !this.password) throw new Error('No vault to write.')
    const file = encryptVault(JSON.stringify(this.cache), this.password)
    const dir = dirname(this.filePath)
    await mkdir(dir, { recursive: true })
    // Write to a temp file then atomically rename over the real one. This way a
    // crash mid-write can never corrupt the existing vault.
    const tmp = `${this.filePath}.tmp`
    await writeFile(tmp, JSON.stringify(file, null, 2), 'utf8')
    await rename(tmp, this.filePath)
  }

  /** Ensure required arrays/fields exist (forward-compat for older files). */
  private normalize(v: Partial<Vault>): Vault {
    return {
      version: v.version ?? 1,
      servers: v.servers ?? [],
      groups: v.groups ?? [],
      snippets: v.snippets ?? [],
      tunnels: v.tunnels ?? [],
      settings: { ...DEFAULT_SETTINGS, ...(v.settings ?? {}) },
      notes: v.notes ?? '',
      databases: v.databases ?? []
    }
  }
}

export const vaultStore = new VaultStore()
