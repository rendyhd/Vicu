// The connected calendars of this device (contract 20.9, 20.11): userData/calendar-feeds.json,
// file mode 600, never synced, kept through signing out. One entry per connection (a calendar link,
// a CalDAV, Microsoft 365 or Google account) with its calendars and their choices. Each connection's
// config (the link; the server, user name and password; the OAuth client and tokens) is one value
// sealed with safeStorage (../safe-storage.ts);
// nothing else in the file is a secret. Version 1 (the proof of concept: one link per entry) is
// read and written back as version 2.

import { app } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { readFileWithBackup, writeFileAtomicAsync } from '../atomic-file'
import { CALENDAR_COLORS } from '../../shared/calendar-events'
import type { CalendarSourceKind } from '../../shared/calendar-sources'

export interface StoredCalendar {
  id: string
  remoteId: string
  name: string
  color: string
  enabled: boolean
  busyOnly: boolean
  countsAsBusy: boolean
}

export interface StoredConnection {
  id: string
  kind: CalendarSourceKind
  name: string
  /** The kind's config as JSON, sealed (safe-storage.ts). Version 1 sealed the bare link. */
  sealed: string
  calendars: StoredCalendar[]
}

export interface CalendarStoreState {
  version: 2
  /** Calendars ever added: the next default colour (20.9, "in the order calendars were added"). */
  colorIndex: number
  connections: StoredConnection[]
}

const KINDS: readonly CalendarSourceKind[] = ['ics', 'caldav', 'microsoft', 'google', 'eventkit', 'ics-file', 'outlook']
const COLOR = /^#[0-9a-f]{6}$/i

export function emptyStore(): CalendarStoreState {
  return { version: 2, colorIndex: 0, connections: [] }
}

function calendarOf(value: unknown, fallbackName: string): StoredCalendar | null {
  const c = value as Partial<StoredCalendar> | null
  if (!c || typeof c.id !== 'string' || typeof c.remoteId !== 'string') return null
  return {
    id: c.id,
    remoteId: c.remoteId,
    name: typeof c.name === 'string' && c.name.trim() ? c.name : fallbackName,
    color: typeof c.color === 'string' && COLOR.test(c.color) ? c.color : CALENDAR_COLORS[0],
    enabled: c.enabled !== false,
    busyOnly: c.busyOnly === true,
    countsAsBusy: c.countsAsBusy !== false,
  }
}

/** Read the file's JSON, version 1 or 2, into the current shape. Throws when it is not a store. */
export function parseCalendarStore(json: unknown): CalendarStoreState {
  const value = json as { version?: unknown; feeds?: unknown; connections?: unknown; colorIndex?: unknown } | null
  if (!value || typeof value !== 'object') throw new Error('not a calendar store')
  if (Array.isArray(value.feeds) && !Array.isArray(value.connections)) {
    // Version 1: { feeds: [{ id, name, color, enabled, busyOnly, countsAsBusy, url }] }, url sealed.
    const connections: StoredConnection[] = []
    for (const raw of value.feeds as Record<string, unknown>[]) {
      if (typeof raw?.id !== 'string' || typeof raw.url !== 'string') continue
      const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name : 'Calendar'
      const calendar = calendarOf({ ...raw, remoteId: 'feed' }, name)
      if (!calendar) continue
      connections.push({ id: raw.id, kind: 'ics', name, sealed: raw.url, calendars: [calendar] })
    }
    return { version: 2, colorIndex: connections.length, connections }
  }
  const connections: StoredConnection[] = []
  for (const raw of Array.isArray(value.connections) ? (value.connections as Record<string, unknown>[]) : []) {
    if (typeof raw?.id !== 'string' || typeof raw.sealed !== 'string' || !KINDS.includes(raw.kind as CalendarSourceKind)) continue
    const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name : 'Calendar'
    const calendars = (Array.isArray(raw.calendars) ? raw.calendars : [])
      .map((c: unknown) => calendarOf(c, name))
      .filter((c): c is StoredCalendar => c !== null)
    connections.push({ id: raw.id, kind: raw.kind as CalendarSourceKind, name, sealed: raw.sealed, calendars })
  }
  const colorIndex = typeof value.colorIndex === 'number' && value.colorIndex >= 0 ? Math.floor(value.colorIndex) : connections.reduce((n, c) => n + c.calendars.length, 0)
  return { version: 2, colorIndex, connections }
}

/** The next default colour, and the state with it taken. */
export function takeColor(state: CalendarStoreState): { color: string; state: CalendarStoreState } {
  return { color: CALENDAR_COLORS[state.colorIndex % CALENDAR_COLORS.length], state: { ...state, colorIndex: state.colorIndex + 1 } }
}

function storePath(): string {
  return join(app.getPath('userData'), 'calendar-feeds.json')
}

let state: CalendarStoreState | null = null
let writing: Promise<void> = Promise.resolve()

export function readCalendarStore(): CalendarStoreState {
  if (state) return state
  state = emptyStore()
  const path = storePath()
  if (existsSync(path)) {
    const result = readFileWithBackup(path, (raw) => parseCalendarStore(JSON.parse(raw)))
    if (result) state = result.value
  }
  return state
}

/** Replace the state and write it (atomic, mode 600, one write at a time). */
export function writeCalendarStore(next: CalendarStoreState): Promise<void> {
  state = next
  const data = JSON.stringify(next)
  writing = writing
    .catch(() => {})
    .then(() => writeFileAtomicAsync(storePath(), data, { backup: true, mode: 0o600 }))
  return writing
}
