import { randomBytes, scryptSync, createCipheriv, createDecipheriv, timingSafeEqual } from 'crypto'

// Encrypted vault file format (single portable file, Postman-collection style):
// {
//   "magic": "JANUS-VAULT",
//   "version": 1,
//   "kdf": { "salt": <hex>, "N": 16384, "r": 8, "p": 1, "keylen": 32 },
//   "cipher": "aes-256-gcm",
//   "iv": <hex>,
//   "tag": <hex>,
//   "data": <base64 ciphertext>
// }

export const VAULT_MAGIC = 'JANUS-VAULT'

const KDF = { N: 16384, r: 8, p: 1, keylen: 32 } as const

export interface EncryptedFile {
  magic: string
  version: number
  kdf: { salt: string; N: number; r: number; p: number; keylen: number }
  cipher: 'aes-256-gcm'
  iv: string
  tag: string
  data: string
}

function deriveKey(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, KDF.keylen, { N: KDF.N, r: KDF.r, p: KDF.p, maxmem: 64 * 1024 * 1024 })
}

/** Encrypt a UTF-8 plaintext string with a master password. */
export function encryptVault(plaintext: string, password: string): EncryptedFile {
  const salt = randomBytes(16)
  const key = deriveKey(password, salt)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    magic: VAULT_MAGIC,
    version: 1,
    kdf: { salt: salt.toString('hex'), ...KDF },
    cipher: 'aes-256-gcm',
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    data: enc.toString('base64')
  }
}

/** Decrypt an encrypted vault file. Throws on wrong password / tampering. */
export function decryptVault(file: EncryptedFile, password: string): string {
  if (file.magic !== VAULT_MAGIC) throw new Error('Invalid vault file (signature mismatch).')
  const salt = Buffer.from(file.kdf.salt, 'hex')
  const key = scryptSync(password, salt, file.kdf.keylen, {
    N: file.kdf.N,
    r: file.kdf.r,
    p: file.kdf.p,
    maxmem: 64 * 1024 * 1024
  })
  const iv = Buffer.from(file.iv, 'hex')
  const tag = Buffer.from(file.tag, 'hex')
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  try {
    const dec = Buffer.concat([decipher.update(Buffer.from(file.data, 'base64')), decipher.final()])
    return dec.toString('utf8')
  } catch {
    throw new Error('Incorrect master password or corrupted file.')
  }
}

/** Constant-time string compare helper. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}
