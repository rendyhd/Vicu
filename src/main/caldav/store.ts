import { app, safeStorage } from 'electron'
import { join } from 'path'
import { readFileWithBackup, writeFileAtomic } from '../atomic-file'
import type { CalDavConnection, CalDavConnectionInput } from '../../shared/caldav-types'

interface StoredConnection extends CalDavConnection { protectedSecret: string }
let memory: { path: string; connections: StoredConnection[] } | undefined

function state() {
  const path = join(app.getPath('userData'), 'caldav.json')
  if (memory?.path !== path) {
    const saved = readFileWithBackup(path, (raw) => {
      const value: unknown = JSON.parse(raw)
      if (!Array.isArray(value)) throw new Error('Invalid CalDAV settings')
      return value.map((entry: unknown): StoredConnection => {
        if (!entry || typeof entry !== 'object') throw new Error('Invalid CalDAV connection')
        const item = entry as StoredConnection
        validateConnection(item)
        if (typeof item.protectedSecret !== 'string' || !Array.isArray(item.calendars)) throw new Error('Invalid CalDAV settings')
        const calendars = item.calendars.map((calendar) => {
          if (!calendar || typeof calendar.url !== 'string' || typeof calendar.name !== 'string'
            || !/^#[0-9a-f]{6}$/i.test(calendar.color) || typeof calendar.enabled !== 'boolean') throw new Error('Invalid CalDAV calendar')
          const url = new URL(calendar.url)
          if (url.origin !== new URL(item.url).origin || url.username || url.password) throw new Error('Invalid CalDAV calendar URL')
          return { url: calendar.url, name: calendar.name, color: calendar.color, enabled: calendar.enabled,
            ...(typeof calendar.readOnly === 'boolean' ? { readOnly: calendar.readOnly } : {}) }
        })
        return { id: item.id, name: item.name, url: item.url, username: item.username, authMethod: item.authMethod,
          hasSecret: Boolean(item.protectedSecret), protectedSecret: item.protectedSecret, calendars }
      })
    })
    memory = { path, connections: saved?.value ?? [] }
  }
  return memory
}

export function connections(): CalDavConnection[] {
  return state().connections.map(({ protectedSecret: _, ...connection }) => structuredClone(connection))
}

export function secretFor(id: string): string {
  const value = state().connections.find((connection) => connection.id === id)?.protectedSecret ?? ''
  if (!value) return ''
  if (value.startsWith('plain:')) return value.slice(6)
  return safeStorage.decryptString(Buffer.from(value, 'base64'))
}

export function validateConnection(input: CalDavConnectionInput): void {
  if (!input || typeof input.id !== 'string' || !/^[\w-]{1,100}$/.test(input.id)
    || typeof input.name !== 'string' || typeof input.username !== 'string'
    || !['Basic', 'Digest', 'Bearer', 'None'].includes(input.authMethod)
    || (input.secret !== undefined && typeof input.secret !== 'string')) throw new Error('Invalid CalDAV connection')
  const url = new URL(input.url)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new Error('Use an HTTP(S) URL without embedded credentials')
  }
}

export function saveConnection(connection: CalDavConnection, secret?: string): void {
  const current = state()
  const previous = current.connections.find((item) => item.id === connection.id)
  const protectedSecret = secret === undefined ? previous?.protectedSecret ?? '' : !secret ? ''
    : safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(secret).toString('base64') : `plain:${secret}`
  const next = [...current.connections.filter((item) => item.id !== connection.id), {
    ...connection, hasSecret: Boolean(protectedSecret), protectedSecret,
  }]
  writeFileAtomic(current.path, JSON.stringify(next), { backup: true, mode: 0o600 })
  memory = { path: current.path, connections: next }
}

export function removeConnection(id: string): void {
  const current = state()
  const next = current.connections.filter((item) => item.id !== id)
  writeFileAtomic(current.path, JSON.stringify(next), { backup: true, mode: 0o600 })
  memory = { path: current.path, connections: next }
}
