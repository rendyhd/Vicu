// Secrets kept on this device through Electron's safeStorage, in a form that works before and after
// Electron 45. Electron 45 deprecates the synchronous `isEncryptionAvailable()` (46 removes it) in
// favour of the asynchronous encryptor: `isAsyncEncryptionAvailable()`, `encryptStringAsync()` and
// `decryptStringAsync()`. This helper uses the asynchronous calls when they are there and falls back
// to the synchronous ones, so callers never touch either directly.
//
// Stored forms:
//   plain:<text>   safeStorage offered no encryption when it was written (file mode 600 only).
//   a1:<base64>    written by encryptStringAsync.
//   <base64>       written by the synchronous encryptString (older values, still read).
//
// Used by the calendar store (src/main/calendar/). The AI key store (ai/settings-store.ts) and the
// sign-in token store (auth/token-store.ts) still call the synchronous API: their callers are
// synchronous, so moving them is a separate change before the upgrade past Electron 45.

import { safeStorage } from 'electron'
import { classifySecretStorage, type SecretStorageLevel } from './auth/secret-storage'

export const PLAIN_PREFIX = 'plain:'
const ASYNC_PREFIX = 'a1:'

/** The parts of safeStorage used here; every method may be missing on one Electron or another. */
export interface SafeStorageLike {
  isEncryptionAvailable?: () => boolean
  isAsyncEncryptionAvailable?: () => Promise<boolean>
  encryptString?: (plainText: string) => Buffer
  decryptString?: (encrypted: Buffer) => string
  encryptStringAsync?: (plainText: string) => Promise<Buffer>
  decryptStringAsync?: (encrypted: Buffer) => Promise<{ result: string; shouldReEncrypt?: boolean } | string>
  getSelectedStorageBackend?: () => string
}

let fakeStorage: SafeStorageLike | null = null

/** Tests swap in a fake. */
export function setSafeStorageForTests(fake: SafeStorageLike | null): void {
  fakeStorage = fake
}

/** Read when used, not when this module loads (a test's electron mock may have no safeStorage). */
function store(): SafeStorageLike {
  return fakeStorage ?? (safeStorage as unknown as SafeStorageLike)
}

/** Whether values can be encrypted now: the asynchronous check when Electron has it. */
export async function isEncryptionReady(): Promise<boolean> {
  const storage = store()
  try {
    if (typeof storage.isAsyncEncryptionAvailable === 'function') return await storage.isAsyncEncryptionAvailable()
    if (typeof storage.isEncryptionAvailable === 'function') return storage.isEncryptionAvailable()
  } catch {
    // Treated as unavailable.
  }
  return false
}

/** Encrypt a value for a file; `plain:` only where the system offers no encryption. */
export async function sealSecret(value: string): Promise<string> {
  if (!(await isEncryptionReady())) return PLAIN_PREFIX + value
  const storage = store()
  try {
    if (typeof storage.encryptStringAsync === 'function') {
      return ASYNC_PREFIX + (await storage.encryptStringAsync(value)).toString('base64')
    }
    if (typeof storage.encryptString === 'function') return storage.encryptString(value).toString('base64')
  } catch {
    // Fall through to plain: the value must still be kept.
  }
  return PLAIN_PREFIX + value
}

/** The value of `sealSecret`, or null when it cannot be decrypted (another user, a new keychain). */
export async function openSecret(encoded: string): Promise<string | null> {
  if (encoded.startsWith(PLAIN_PREFIX)) return encoded.slice(PLAIN_PREFIX.length)
  const storage = store()
  const isAsync = encoded.startsWith(ASYNC_PREFIX)
  const buffer = Buffer.from(isAsync ? encoded.slice(ASYNC_PREFIX.length) : encoded, 'base64')
  const viaAsync = async (): Promise<string | null> => {
    if (typeof storage.decryptStringAsync !== 'function') return null
    const answer = await storage.decryptStringAsync(buffer)
    return typeof answer === 'string' ? answer : answer.result
  }
  try {
    if (isAsync) return await viaAsync()
    // An older value: the synchronous call while it exists, else the asynchronous decryptor, which
    // reads the same format.
    if (typeof storage.decryptString === 'function') return storage.decryptString(buffer)
    return await viaAsync()
  } catch {
    return null
  }
}

/** Whether a stored value was written without encryption. */
export function isPlainSecret(encoded: string | undefined): boolean {
  return typeof encoded === 'string' && encoded.startsWith(PLAIN_PREFIX)
}

/**
 * How the secrets of a store are protected (auth/secret-storage.ts): `obfuscated` on Linux without a
 * keyring (the `basic_text` backend the app pins), `plaintext` without encryption.
 */
export async function secretStorageLevel(hasPlainSecrets: boolean, platform: NodeJS.Platform = process.platform): Promise<SecretStorageLevel> {
  const encryptionAvailable = await isEncryptionReady()
  let backend: string | undefined
  if (platform === 'linux') {
    try {
      backend = store().getSelectedStorageBackend?.()
    } catch {
      backend = undefined
    }
  }
  return classifySecretStorage({ encryptionAvailable, platform, backend, hasPlainSecrets })
}
