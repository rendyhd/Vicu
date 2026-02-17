import { app, safeStorage } from 'electron'
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'

interface AuthStore {
  jwt?: string
  jwt_exp?: number
  api_token?: string
  api_token_exp?: number
  provider_key?: string
}

const AUTH_FILENAME = 'auth.json'

function getAuthPath(): string {
  return join(app.getPath('userData'), AUTH_FILENAME)
}

function readStore(): AuthStore {
  const authPath = getAuthPath()
  if (!existsSync(authPath)) {
    return {}
  }
  try {
    const raw = readFileSync(authPath, 'utf-8')
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

function writeStore(data: AuthStore): void {
  const authPath = getAuthPath()
  const dir = dirname(authPath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  writeFileSync(authPath, JSON.stringify(data, null, 2), 'utf-8')
}

function encrypt(value: string): string {
  const buffer = safeStorage.encryptString(value)
  return buffer.toString('base64')
}

function decrypt(encoded: string): string | null {
  try {
    const buffer = Buffer.from(encoded, 'base64')
    return safeStorage.decryptString(buffer)
  } catch {
    return null
  }
}

function extractJWTExp(jwt: string): number | null {
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

export function storeAPIToken(token: string, expiresAt: number): void {
  const store = readStore()
  store.api_token = encrypt(token)
  store.api_token_exp = expiresAt
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

export function storeProviderKey(key: string): void {
  const store = readStore()
  store.provider_key = key
  writeStore(store)
}

export function getProviderKey(): string | null {
  const store = readStore()
  return store.provider_key ?? null
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
  const authPath = getAuthPath()
  if (existsSync(authPath)) {
    unlinkSync(authPath)
  }
}
