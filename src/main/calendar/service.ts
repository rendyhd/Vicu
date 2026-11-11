// Calendars on the Plan screen (proof of concept): secret ICS links read by this device only.
//
// - The links are secrets (anyone with one reads the calendar), so they live in
//   userData/calendar-feeds.json encrypted with safeStorage (a `plain:` value only where the OS
//   offers no encryption), file mode 600. The windows never get them back.
// - Nothing leaves the device: no Vikunja, no synced preferences, no assistant request (it only gets
//   free time). The settings belong to this device and survive signing out.
// - Read-only: Vicu never writes to a calendar.
// - A feed is read again when it is older than FRESH_MS and a window asks for events, through
//   Electron's net.fetch, which follows the system proxy.

import { app, net, safeStorage } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { readFileWithBackup, writeFileAtomic } from '../atomic-file'
import { handleTrusted } from '../secure-ipc'
import {
  CALENDAR_COLORS,
  normaliseFeedUrl,
  type CalendarEvent,
  type CalendarEventsResult,
  type CalendarFeedView,
} from '../../shared/calendar-events'
import { occurrencesBetween, parseIcs, type ParsedFeed } from './ics'

const FRESH_MS = 5 * 60_000
const FETCH_TIMEOUT_MS = 20_000
const MAX_FEED_BYTES = 15 * 1024 * 1024
const PLAIN_PREFIX = 'plain:'

interface StoredFeed {
  id: string
  name: string
  color: string
  enabled: boolean
  busyOnly: boolean
  countsAsBusy: boolean
  /** Encrypted link. */
  url: string
}

interface FeedState {
  parsed?: ParsedFeed
  fetchedAt?: number
  error?: string
  inFlight?: Promise<void>
}

let feeds: StoredFeed[] | null = null
const states = new Map<string, FeedState>()

function filePath(): string {
  return join(app.getPath('userData'), 'calendar-feeds.json')
}

function encrypt(value: string): string {
  try {
    if (!safeStorage.isEncryptionAvailable()) return PLAIN_PREFIX + value
    return safeStorage.encryptString(value).toString('base64')
  } catch {
    return PLAIN_PREFIX + value
  }
}

function decrypt(encoded: string): string | null {
  if (encoded.startsWith(PLAIN_PREFIX)) return encoded.slice(PLAIN_PREFIX.length)
  try {
    return safeStorage.decryptString(Buffer.from(encoded, 'base64'))
  } catch {
    return null
  }
}

function readFeeds(): StoredFeed[] {
  if (feeds) return feeds
  feeds = []
  const path = filePath()
  if (existsSync(path)) {
    const result = readFileWithBackup(path, (raw) => JSON.parse(raw) as { feeds?: unknown })
    const list = Array.isArray(result?.value?.feeds) ? (result.value.feeds as Partial<StoredFeed>[]) : []
    feeds = list
      .filter((feed): feed is StoredFeed => typeof feed?.id === 'string' && typeof feed.url === 'string')
      .map((feed) => ({
        id: feed.id,
        name: typeof feed.name === 'string' && feed.name ? feed.name : 'Calendar',
        color: typeof feed.color === 'string' ? feed.color : CALENDAR_COLORS[0],
        enabled: feed.enabled !== false,
        busyOnly: feed.busyOnly === true,
        countsAsBusy: feed.countsAsBusy !== false,
        url: feed.url,
      }))
  }
  return feeds
}

function writeFeeds(next: StoredFeed[]): void {
  feeds = next
  writeFileAtomic(filePath(), JSON.stringify({ feeds: next }), { backup: true, mode: 0o600 })
}

function viewOf(feed: StoredFeed): CalendarFeedView {
  const state = states.get(feed.id)
  return {
    id: feed.id,
    name: feed.name,
    color: feed.color,
    enabled: feed.enabled,
    busyOnly: feed.busyOnly,
    countsAsBusy: feed.countsAsBusy,
    fetchedAt: state?.fetchedAt ? new Date(state.fetchedAt).toISOString() : undefined,
    error: state?.error,
  }
}

async function download(url: string): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await net.fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'text/calendar, */*;q=0.5' },
      // Never send the app's cookies to a calendar host.
      credentials: 'omit',
    })
    if (!response.ok) throw new Error(`The calendar answered ${response.status}.`)
    const body = await response.arrayBuffer()
    if (body.byteLength > MAX_FEED_BYTES) throw new Error('The calendar is too large to read.')
    const text = Buffer.from(body).toString('utf8')
    if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('That link does not give a calendar (no BEGIN:VCALENDAR).')
    return text
  } catch (error) {
    if (controller.signal.aborted) throw new Error('The calendar took too long to answer.')
    throw error instanceof Error ? error : new Error(String(error))
  } finally {
    clearTimeout(timer)
  }
}

/** Read a feed again when it is stale (or `force`); concurrent callers share one request. */
function refresh(feed: StoredFeed, force = false): Promise<void> {
  const state = states.get(feed.id) ?? {}
  states.set(feed.id, state)
  if (state.inFlight) return state.inFlight
  if (!force && state.fetchedAt && Date.now() - state.fetchedAt < FRESH_MS) return Promise.resolve()
  const url = decrypt(feed.url)
  if (!url) {
    state.error = 'The saved link could not be decrypted. Remove the calendar and add it again.'
    return Promise.resolve()
  }
  state.inFlight = download(url)
    .then((text) => {
      state.parsed = parseIcs(text)
      state.fetchedAt = Date.now()
      state.error = undefined
    })
    .catch((error: Error) => {
      // The last good copy stays on screen; the error says why it is not newer.
      state.error = error.message
      console.warn(`[Calendar] ${feed.name}: ${error.message}`)
    })
    .finally(() => {
      state.inFlight = undefined
    })
  return state.inFlight
}

async function eventsBetween(from: Date, to: Date): Promise<CalendarEventsResult> {
  const list = readFeeds()
  const enabled = list.filter((feed) => feed.enabled)
  await Promise.all(enabled.map((feed) => refresh(feed)))
  const events: CalendarEvent[] = []
  for (const feed of enabled) {
    const parsed = states.get(feed.id)?.parsed
    if (!parsed) continue
    try {
      for (const event of occurrencesBetween(parsed, feed.id, from, to)) {
        // Busy only: the title and place never reach a window.
        events.push(feed.busyOnly ? { ...event, title: event.busy ? 'Busy' : 'Free', location: undefined } : event)
      }
    } catch (error) {
      states.get(feed.id)!.error = `The calendar could not be read: ${(error as Error).message}`
    }
  }
  return { events, feeds: list.map(viewOf) }
}

type FeedPatch = Partial<Pick<StoredFeed, 'name' | 'color' | 'enabled' | 'busyOnly' | 'countsAsBusy'>>

export function registerCalendarIpc(): void {
  handleTrusted('calendar:list', () => readFeeds().map(viewOf))

  handleTrusted('calendar:events', (_event, range: { from: string; to: string }) => {
    const from = new Date(range?.from)
    const to = new Date(range?.to)
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) return { events: [], feeds: readFeeds().map(viewOf) }
    return eventsBetween(from, to)
  })

  handleTrusted('calendar:add', async (_event, input: { name?: string; url?: string; busyOnly?: boolean }) => {
    const url = normaliseFeedUrl(String(input?.url ?? ''))
    if (!url) return { success: false, error: 'Paste a calendar link that starts with https:// or webcal://.' }
    // Read it once before saving, so a wrong link is said at once.
    let parsed: ParsedFeed
    try {
      parsed = parseIcs(await download(url))
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
    const list = readFeeds()
    const feed: StoredFeed = {
      id: randomUUID(),
      name: String(input?.name ?? '').trim() || 'Calendar',
      color: CALENDAR_COLORS[list.length % CALENDAR_COLORS.length],
      enabled: true,
      busyOnly: input?.busyOnly === true,
      countsAsBusy: true,
      url: encrypt(url),
    }
    states.set(feed.id, { parsed, fetchedAt: Date.now() })
    writeFeeds([...list, feed])
    return { success: true, data: viewOf(feed) }
  })

  handleTrusted('calendar:update', (_event, id: string, patch: FeedPatch) => {
    const next = readFeeds().map((feed) => {
      if (feed.id !== id) return feed
      const changed = { ...feed }
      if (typeof patch?.name === 'string' && patch.name.trim()) changed.name = patch.name.trim()
      if (typeof patch?.color === 'string' && /^#[0-9a-f]{6}$/i.test(patch.color)) changed.color = patch.color
      if (typeof patch?.enabled === 'boolean') changed.enabled = patch.enabled
      if (typeof patch?.busyOnly === 'boolean') changed.busyOnly = patch.busyOnly
      if (typeof patch?.countsAsBusy === 'boolean') changed.countsAsBusy = patch.countsAsBusy
      return changed
    })
    writeFeeds(next)
    return next.map(viewOf)
  })

  handleTrusted('calendar:remove', (_event, id: string) => {
    states.delete(id)
    writeFeeds(readFeeds().filter((feed) => feed.id !== id))
    return readFeeds().map(viewOf)
  })

  handleTrusted('calendar:refresh', async () => {
    await Promise.all(readFeeds().filter((feed) => feed.enabled).map((feed) => refresh(feed, true)))
    return readFeeds().map(viewOf)
  })
}
