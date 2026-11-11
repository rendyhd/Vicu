// The last good copy of each calendar on disk (contract 20.9: an error never empties a calendar; the
// app starts with its calendars offline). userData/calendar-cache/<calendar id>.bin, mode 600.
//
// What is in it is already reduced (ics.ts reduceIcs): times, rules, state, and title and place
// only where Busy only is off. It is still encrypted with safeStorage, like the links: a personal
// calendar's titles are as private as its address, and the copy sits next to it. A copy that cannot
// be decrypted (another user, a new keychain) is simply dropped; the next read makes a new one.

import { app } from 'electron'
import { promises as fsp } from 'fs'
import { join } from 'path'
import { writeFileAtomicAsync } from '../atomic-file'
import { openSecret, sealSecret } from '../safe-storage'
import type { CalendarCopy } from './sources/types'

const SAFE_ID = /^[A-Za-z0-9-]{1,64}$/

function dir(): string {
  return join(app.getPath('userData'), 'calendar-cache')
}

function pathOf(calendarId: string): string | null {
  return SAFE_ID.test(calendarId) ? join(dir(), `${calendarId}.bin`) : null
}

export function copyFromJson(json: unknown): CalendarCopy | null {
  const value = json as Partial<CalendarCopy> | null
  if (!value || !Array.isArray(value.documents) || typeof value.fetchedAt !== 'number') return null
  const documents = value.documents.filter((doc) => typeof doc?.key === 'string' && typeof doc.ics === 'string')
  const validators: Record<string, string | number> = {}
  for (const [key, v] of Object.entries(value.validators ?? {})) if (typeof v === 'string' || typeof v === 'number') validators[key] = v
  return { documents, validators, fetchedAt: value.fetchedAt, busyOnly: value.busyOnly === true }
}

export async function loadCopy(calendarId: string): Promise<CalendarCopy | null> {
  const path = pathOf(calendarId)
  if (!path) return null
  let sealed: string
  try {
    sealed = await fsp.readFile(path, 'utf8')
  } catch {
    return null
  }
  const text = await openSecret(sealed.trim())
  if (text === null) {
    await dropCopy(calendarId)
    return null
  }
  try {
    return copyFromJson(JSON.parse(text))
  } catch {
    await dropCopy(calendarId)
    return null
  }
}

export async function saveCopy(calendarId: string, copy: CalendarCopy): Promise<void> {
  const path = pathOf(calendarId)
  if (!path) return
  try {
    await fsp.mkdir(dir(), { recursive: true })
    await writeFileAtomicAsync(path, await sealSecret(JSON.stringify(copy)), { mode: 0o600 })
  } catch (error) {
    console.warn('[Calendar] Could not keep a copy:', (error as NodeJS.ErrnoException).code ?? 'error')
  }
}

export async function dropCopy(calendarId: string): Promise<void> {
  const path = pathOf(calendarId)
  if (!path) return
  await fsp.rm(path, { force: true }).catch(() => {})
}
