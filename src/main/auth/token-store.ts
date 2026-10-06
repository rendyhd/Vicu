import { app, safeStorage } from 'electron'

/** Expiry far in the future for user-provided API tokens with no inherent expiry */
export const API_TOKEN_NO_EXPIRY = 4102444800 // 2100-01-01T00:00:00Z

// Returns true if the token store can persist a value — either via real
// safeStorage encryption or via the plaintext fallback. Callers that gate on
// "should we save tokens at all?" want this to always be true; callers that
// want to know specifically whether on-disk encryption is in effect should
// call safeStorage.isEncryptionAvailable() directly.
export function isEncryptionAvailable(): boolean {
  return true
}
import { join } from 'path'
import { readFileWithBackup, removeFileAndBackup, writeFileAtomic } from '../atomic-file'

interface AuthStore {
  jwt?: string
  jwt_exp?: number
  api_token?: string
  api_token_exp?: number
  /** Server-side id of the backup API token Vicu created (absent for user-provided tokens). */
  api_token_id?: number
  /** Server the backup token was created on, so its id is never used against another server. */
  api_token_url?: string
  provider_key?: string
  refresh_token?: string
}

const AUTH_FILENAME = 'auth.json'

function getAuthPath(): string {
  return join(app.getPath('userData'), AUTH_FILENAME)
}

function parseAuthStore(raw: string): AuthStore {
  const parsed: unknown = JSON.parse(raw)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('auth.json does not contain an object')
  }
  return parsed as AuthStore
}

function readStore(): AuthStore {
  // Falls back to auth.json.bak (and logs it) when the file does not parse, so a
  // torn write does not log the user out.
  return readFileWithBackup(getAuthPath(), parseAuthStore)?.value ?? {}
}

function writeStore(data: AuthStore): void {
  writeFileAtomic(getAuthPath(), JSON.stringify(data, null, 2), { backup: true, mode: 0o600 })
}

// Tokens stored while safeStorage is unavailable get a "plain:" prefix so the
// reader can tell them apart from base64-encoded ciphertext. Without this, a
// keyring appearing after the first launch would leave the reader trying to
// decrypt raw plaintext as base64 and permanently wedge auth until the user
// logged in again. On Linux without a usable keyring, the fallback stores
// tokens in cleartext under ~/.config/vicu/auth.json — the same effective
// posture as every other Electron app in this situation (VS Code, Slack,
// Signal, etc. all degrade to basic obfuscation when no keyring is available).
const PLAIN_PREFIX = 'plain:'

function encrypt(value: string): string {
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      return PLAIN_PREFIX + value
    }
    const buffer = safeStorage.encryptString(value)
    return buffer.toString('base64')
  } catch (err) {
    console.warn('[Auth] safeStorage.encryptString failed, falling back to plaintext:',
      err instanceof Error ? err.message : err)
    return PLAIN_PREFIX + value
  }
}

function decrypt(encoded: string): string | null {
  if (encoded.startsWith(PLAIN_PREFIX)) {
    return encoded.slice(PLAIN_PREFIX.length)
  }
  try {
    const buffer = Buffer.from(encoded, 'base64')
    return safeStorage.decryptString(buffer)
  } catch (err) {
    console.warn('[Auth] Failed to decrypt stored token:', err instanceof Error ? err.message : err)
    return null
  }
}

export function extractJWTExp(jwt: string): number | null {
  try {
    const parts = jwt.split('.')
    if (parts.length !== 3) return null
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString())
    if (typeof payload.exp === 'number') return payload.exp
    return null
  } catch {
    return null
  }
}

export function storeJWT(jwt: string): void {
  const store = readStore()
  store.jwt = encrypt(jwt)
  const exp = extractJWTExp(jwt)
  store.jwt_exp = exp ?? undefined
  writeStore(store)
}

export function getJWT(): string | null {
  const store = readStore()
  if (!store.jwt) return null
  return decrypt(store.jwt)
}

export function isJWTExpired(bufferSeconds = 0): boolean {
  const store = readStore()
  if (store.jwt_exp == null) return true
  return Date.now() / 1000 + bufferSeconds >= store.jwt_exp
}

export interface BackupTokenMeta {
  id: number
  baseUrl: string
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '')
}

/**
 * Store the API token. Pass `meta` only for the backup token Vicu itself created
 * on the server: the id is what lets logout revoke it. A token without `meta`
 * (user-provided, or a long-lived JWT kept as fallback) clears any stored id, so
 * logout never tries to delete something Vicu did not create.
 */
export function storeAPIToken(token: string, expiresAt: number, meta?: BackupTokenMeta): void {
  const store = readStore()
  store.api_token = encrypt(token)
  store.api_token_exp = expiresAt
  if (meta) {
    store.api_token_id = meta.id
    store.api_token_url = normalizeBaseUrl(meta.baseUrl)
  } else {
    delete store.api_token_id
    delete store.api_token_url
  }
  writeStore(store)
}

/** The server-side id of the stored backup token, when Vicu created it. */
export function getAPITokenMeta(): BackupTokenMeta | null {
  const store = readStore()
  if (typeof store.api_token_id !== 'number' || typeof store.api_token_url !== 'string') return null
  return { id: store.api_token_id, baseUrl: store.api_token_url }
}

/** Record the id of an already-stored backup token (found by lookup after an upgrade). */
export function setAPITokenMeta(meta: BackupTokenMeta): void {
  const store = readStore()
  if (!store.api_token) return
  store.api_token_id = meta.id
  store.api_token_url = normalizeBaseUrl(meta.baseUrl)
  writeStore(store)
}

export function getAPIToken(): string | null {
  const store = readStore()
  if (!store.api_token) return null
  return decrypt(store.api_token)
}

export function isAPITokenExpired(): boolean {
  const store = readStore()
  if (store.api_token_exp == null) return true
  return Date.now() / 1000 >= store.api_token_exp
}

export function hasAPIToken(): boolean {
  const store = readStore()
  return !!store.api_token
}

export function getAPITokenExpiry(): number | null {
  const store = readStore()
  return store.api_token_exp ?? null
}

export function storeProviderKey(key: string): void {
  const store = readStore()
  store.provider_key = key
  writeStore(store)
}

export function getProviderKey(): string | null {
  const store = readStore()
  return store.provider_key ?? null
}

export function storeRefreshToken(token: string): void {
  const store = readStore()
  store.refresh_token = encrypt(token)
  writeStore(store)
}

export function getRefreshToken(): string | null {
  const store = readStore()
  if (!store.refresh_token) return null
  return decrypt(store.refresh_token)
}

export function hasRefreshToken(): boolean {
  const store = readStore()
  return !!store.refresh_token
}

export function getBestToken(): string | null {
  if (!isJWTExpired()) {
    const jwt = getJWT()
    if (jwt) return jwt
  }
  if (!isAPITokenExpired()) {
    const apiToken = getAPIToken()
    if (apiToken) return apiToken
  }
  return null
}

export function clear(): void {
  // The backup copy must go too, or it would restore the session after logout.
  removeFileAndBackup(getAuthPath())
}
