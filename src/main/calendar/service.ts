// Connected calendars on the Plan screen (contract 20.9 to 20.11), read by this device only.
//
// The parts:
//   sources/types.ts   what a kind of source implements, and how to add one (read it first)
//   sources/*.ts       the kinds: a calendar link (ics-link.ts), a CalDAV account (caldav.ts), the
//                      Mac's calendars (eventkit.ts, through ../eventkit.ts and its helper)
//   store.ts           the connections and their calendars' choices, configs sealed (calendar-feeds.json)
//   cache.ts           the last good copy of each calendar, encrypted (calendar-cache/)
//   ics.ts             iCalendar into occurrences, VFREEBUSY, reducing a copy to what may be kept
//   timezones.ts       zones a file names without defining them (Windows names)
//   http.ts            the read-only HTTP every kind uses (net.fetch, limits, the sign-in, messages)
//
// This file is what is the same for every kind:
// - Calendars are read when a window asks for days and the last attempt is older than 5 minutes
//   (20.9), at once on a manual refresh, and when a CalDAV window does not hold the days yet. A
//   calendar with a copy answers at once from it and reads in the background; the windows hear
//   `calendar-changed` when something new came in.
// - Busy only (20.8): a copy is reduced before it is kept, in memory or on disk; turning it on
//   reduces the copy at once, turning it off reads the calendar again in full.
// - A calendar that cannot be read keeps its last good copy and says why (20.9).
// - Secrets never reach a window, a log line or the config: the windows get CalendarSourcesView.
// - Nothing leaves the device: no Vikunja, no synced preferences, no assistant (it gets free time).

import { BrowserWindow, net } from 'electron'
import { randomUUID } from 'crypto'
import { handleTrusted } from '../secure-ipc'
import { isPlainSecret, openSecret, sealSecret, secretStorageLevel } from '../safe-storage'
import {
  busyOnlyEvent,
  type CalendarEvent,
  type CalendarEventsResult,
  type CalendarFeedView,
} from '../../shared/calendar-events'
import type {
  AddCalendarLinkInput,
  CaldavDiscoverInput,
  CaldavDraft,
  CaldavSaveInput,
  CalendarConnectionView,
  CalendarSourceKind,
  CalendarSourcesView,
} from '../../shared/calendar-sources'
import { calendarHttp, CalendarReadError } from './http'
import { occurrencesBetween, parseIcsDocuments, reduceIcs, type ParsedFeed } from './ics'
import { dropCopy, loadCopy, saveCopy } from './cache'
import {
  readCalendarStore,
  takeColor,
  writeCalendarStore,
  type CalendarStoreState,
  type StoredCalendar,
  type StoredConnection,
} from './store'
import { caldavSource } from './sources/caldav'
import { icsLinkSource } from './sources/ics-link'
import { eventKitHelper, eventKitHelperIfAny, eventkitSource, eventKitStatus, openCalendarPrivacySettings } from './eventkit'
import { foundCalendars } from './sources/eventkit'
import { EVENTKIT_DENIED_MESSAGE, type EventKitSaveInput } from '../../shared/calendar-eventkit'
import { isMac } from '../platform'
import type { CalendarCopy, CalendarSource, ConnectResult, ReadOutcome, RemoteCalendar, SourceContext } from './sources/types'

/** Every kind this app has built. A new kind is registered here (see sources/types.ts). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- each kind has its own config type
const SOURCES: Record<CalendarSourceKind, CalendarSource<any>> = {
  ics: icsLinkSource,
  caldav: caldavSource,
  eventkit: eventkitSource,
}

/** A calendar is read at most this often unless a refresh asks (20.9). */
export const FRESH_MS = 5 * 60_000
/** Events of one calendar handed to a window per request at most. */
export const MAX_RANGE_EVENTS = 2000
/** A copy that only got "not modified" is written again at most this often (for "Not updated since"). */
const COPY_REWRITE_MS = 60 * 60_000
/** A signed-in CalDAV account waits this long for the user's pick. */
const DRAFT_MS = 10 * 60_000
const DAY = 24 * 3600_000

interface CalendarState {
  copy?: CalendarCopy
  parsed?: ParsedFeed
  loaded?: Promise<void>
  attemptedAt?: number
  savedAt?: number
  error?: string
  warning?: string
  inFlight?: Promise<boolean>
  lastRange?: { from: Date; to: Date }
}

const states = new Map<string, CalendarState>()
/** Unsealed configs, in this process's memory only. */
const configs = new Map<string, unknown>()
const connectionErrors = new Map<string, string>()
const drafts = new Map<string, { result: ConnectResult<unknown>; expires: number }>()

const ctx: SourceContext = {
  http: (options) => calendarHttp({ base: (url, init) => net.fetch(url, init), ...options }),
  now: () => Date.now(),
}

function messageOf(error: unknown): string {
  return error instanceof CalendarReadError ? error.message : 'The calendar could not be read.'
}

function stateOf(calendarId: string): CalendarState {
  let state = states.get(calendarId)
  if (!state) {
    state = {}
    states.set(calendarId, state)
  }
  return state
}

let changedTimer: ReturnType<typeof setTimeout> | null = null
/** Tell the windows to ask again: a background read brought something new. */
function announceChanged(): void {
  if (changedTimer) return
  changedTimer = setTimeout(() => {
    changedTimer = null
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('calendar-changed')
    }
  }, 150)
}

// --- Configs (sealed in the store) ----------------------------------------------------------------

async function configOf(connection: StoredConnection): Promise<unknown | null> {
  if (configs.has(connection.id)) return configs.get(connection.id)!
  const text = await openSecret(connection.sealed)
  let config: unknown = null
  if (text !== null) {
    let value: unknown = text
    try {
      value = JSON.parse(text)
    } catch {
      // Version 1 sealed the bare link.
    }
    config = SOURCES[connection.kind].parseConfig(value)
  }
  if (!config) {
    connectionErrors.set(connection.id, 'The saved address or sign-in could not be read on this computer. Remove it and add it again.')
    return null
  }
  configs.set(connection.id, config)
  return config
}

async function sealConfig(connectionId: string, config: unknown): Promise<string> {
  configs.set(connectionId, config)
  return sealSecret(JSON.stringify(config))
}

// --- Copies ---------------------------------------------------------------------------------------

/** Keep a copy as the calendar's current one; Busy only reduces it first. */
function setCopy(calendar: StoredCalendar, state: CalendarState, copy: CalendarCopy): void {
  let kept = copy
  if (calendar.busyOnly && !copy.busyOnly) {
    kept = { ...copy, busyOnly: true, documents: reduceDocuments(copy.documents, true, new Set()) }
  }
  state.copy = kept
  try {
    state.parsed = parseIcsDocuments(kept.documents.map((doc) => doc.ics))
  } catch {
    state.parsed = undefined
    state.error = 'The calendar could not be read: it is not a valid calendar file.'
  }
}

/** Reduce documents (ics.ts reduceIcs), except those already kept; one that does not parse is left out. */
function reduceDocuments(documents: CalendarCopy['documents'], busyOnly: boolean, kept: ReadonlySet<unknown>) {
  const out: CalendarCopy['documents'] = []
  for (const doc of documents) {
    if (kept.has(doc)) {
      out.push(doc)
      continue
    }
    try {
      out.push({ ...doc, ics: reduceIcs(doc.ics, busyOnly) })
    } catch {
      // Not iCalendar: nothing of it can be shown.
    }
  }
  return out
}

function ensureLoaded(calendar: StoredCalendar): Promise<void> {
  const state = stateOf(calendar.id)
  if (!state.loaded) {
    state.loaded = loadCopy(calendar.id).then((copy) => {
      if (copy && !state.copy) {
        setCopy(calendar, state, copy)
        state.savedAt = copy.fetchedAt
      }
    })
  }
  return state.loaded
}

function keepCopy(calendarId: string, state: CalendarState): void {
  if (!state.copy) return
  state.savedAt = Date.now()
  void saveCopy(calendarId, state.copy)
}

function defaultRange(): { from: Date; to: Date } {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  return { from: start, to: new Date(start.getTime() + 7 * DAY) }
}

/**
 * Read one calendar when it is due (or `force`), sharing a read already running. Resolves true
 * when the copy changed.
 */
async function refreshCalendar(connection: StoredConnection, calendar: StoredCalendar, range: { from: Date; to: Date } | null, force: boolean): Promise<boolean> {
  const source = SOURCES[connection.kind]
  await ensureLoaded(calendar)
  const state = stateOf(calendar.id)
  if (state.inFlight) return state.inFlight
  const { from, to } = range ?? state.lastRange ?? defaultRange()
  state.lastRange = { from, to }
  const covered = state.copy ? source.covers(state.copy, from, to) : false
  const now = Date.now()
  if (!force && covered && state.attemptedAt !== undefined && now - state.attemptedAt < FRESH_MS) return false
  state.attemptedAt = now
  // Set before anything waits, so a second caller shares this read.
  const run = (async (): Promise<boolean> => {
    const config = await configOf(connection)
    if (!config) return false
    // A copy reduced for Busy only cannot be the base once titles are wanted again.
    const previous = state.copy && !(state.copy.busyOnly && !calendar.busyOnly) ? state.copy : undefined
    try {
      const outcome: ReadOutcome = await source.read(config, calendar.remoteId, { from, to, previous }, ctx)
      // The choices as they are now: Busy only may have been turned on, or the calendar removed, meanwhile.
      const current = findCalendar(calendar.id)
      if (!current || states.get(calendar.id) !== state) return false
      if (outcome.config) await updateConnection(connection.id, async (c) => ({ ...c, sealed: await sealConfig(c.id, outcome.config) }))
      state.error = undefined
      connectionErrors.delete(connection.id)
      if (outcome.status === 'unchanged' && state.copy) {
        state.copy = { ...state.copy, validators: { ...state.copy.validators, ...(outcome.validators ?? {}) }, fetchedAt: Date.now() }
        if (Date.now() - (state.savedAt ?? 0) > COPY_REWRITE_MS) keepCopy(calendar.id, state)
        return false
      }
      if (outcome.status !== 'changed') return false
      const kept = new Set<unknown>(previous?.busyOnly === current.busyOnly ? previous.documents : [])
      const documents = reduceDocuments(outcome.documents, current.busyOnly, kept)
      if (connection.kind === 'ics' && outcome.documents.length > 0 && documents.length === 0) {
        throw new CalendarReadError('The calendar could not be read: it is not a valid calendar file.', 'format')
      }
      setCopy(current, state, { documents, validators: outcome.validators, fetchedAt: Date.now(), busyOnly: current.busyOnly })
      keepCopy(calendar.id, state)
      return true
    } catch (error) {
      // The last good copy stays on screen; the error says why it is not newer.
      state.error = messageOf(error)
      console.warn(`[Calendar] ${calendar.name}: ${state.error}`)
      return false
    }
  })().finally(() => {
    state.inFlight = undefined
  })
  state.inFlight = run
  return run
}

function findCalendar(calendarId: string): StoredCalendar | undefined {
  for (const connection of readCalendarStore().connections) {
    const found = connection.calendars.find((calendar) => calendar.id === calendarId)
    if (found) return found
  }
  return undefined
}

// --- Views ----------------------------------------------------------------------------------------

function feedView(connection: StoredConnection, calendar: StoredCalendar): CalendarFeedView {
  const state = states.get(calendar.id)
  return {
    id: calendar.id,
    connectionId: connection.id,
    name: calendar.name,
    color: calendar.color,
    enabled: calendar.enabled,
    busyOnly: calendar.busyOnly,
    countsAsBusy: calendar.countsAsBusy,
    fetchedAt: state?.copy ? new Date(state.copy.fetchedAt).toISOString() : undefined,
    error: state?.error ?? connectionErrors.get(connection.id),
    warning: state?.warning,
  }
}

function allFeeds(store: CalendarStoreState): CalendarFeedView[] {
  return store.connections.flatMap((connection) => connection.calendars.map((calendar) => feedView(connection, calendar)))
}

async function connectionView(connection: StoredConnection): Promise<CalendarConnectionView> {
  const config = await configOf(connection)
  await Promise.all(connection.calendars.map(ensureLoaded))
  return {
    id: connection.id,
    kind: connection.kind,
    name: connection.name,
    detail: config ? SOURCES[connection.kind].describe(config) : '',
    calendars: connection.calendars.map((calendar) => feedView(connection, calendar)),
    error: connectionErrors.get(connection.id),
  }
}

async function sourcesView(): Promise<CalendarSourcesView> {
  const store = readCalendarStore()
  return {
    connections: await Promise.all(store.connections.map(connectionView)),
    storage: await secretStorageLevel(store.connections.some((connection) => isPlainSecret(connection.sealed))),
  }
}

// --- Changes --------------------------------------------------------------------------------------

async function updateConnection(id: string, change: (connection: StoredConnection) => Promise<StoredConnection>): Promise<void> {
  const current = readCalendarStore().connections.find((c) => c.id === id)
  if (!current) return
  const changed = await change(current)
  const store = readCalendarStore()
  await writeCalendarStore({ ...store, connections: store.connections.map((c) => (c.id === id ? { ...c, sealed: changed.sealed, name: changed.name } : c)) })
}

/** Save a connection made by a kind's `connect`, with the calendars it found. */
async function addConnection(kind: CalendarSourceKind, result: ConnectResult<unknown>, shown: (calendar: RemoteCalendar) => boolean, busyOnly: boolean): Promise<StoredConnection> {
  const id = randomUUID()
  const sealed = await sealConfig(id, result.config)
  // From here on nothing waits, so no other change can come between reading the store and writing it.
  let store = readCalendarStore()
  const calendars: StoredCalendar[] = []
  for (const remote of result.calendars) {
    const taken = takeColor(store)
    store = taken.state
    calendars.push({
      id: randomUUID(),
      remoteId: remote.remoteId,
      name: remote.name || result.name,
      color: taken.color,
      enabled: shown(remote),
      busyOnly,
      countsAsBusy: true,
    })
  }
  const connection: StoredConnection = { id, kind, name: result.name, sealed, calendars }
  for (const calendar of calendars) {
    const first = result.firstReads?.[calendar.remoteId]
    if (first?.status !== 'changed') continue
    const state = stateOf(calendar.id)
    state.loaded = Promise.resolve()
    state.attemptedAt = Date.now()
    setCopy(calendar, state, {
      documents: reduceDocuments(first.documents, busyOnly, new Set()),
      validators: first.validators,
      fetchedAt: Date.now(),
      busyOnly,
    })
    keepCopy(calendar.id, state)
  }
  await writeCalendarStore({ ...store, connections: [...store.connections, connection] })
  return connection
}

type CalendarPatch = Partial<Pick<StoredCalendar, 'name' | 'color' | 'enabled' | 'busyOnly' | 'countsAsBusy'>>

async function updateCalendar(calendarId: string, patch: CalendarPatch): Promise<void> {
  const store = readCalendarStore()
  const connections = store.connections.map((connection) => ({
    ...connection,
    calendars: connection.calendars.map((calendar) => {
      if (calendar.id !== calendarId) return calendar
      const changed = { ...calendar }
      if (typeof patch?.name === 'string' && patch.name.trim()) changed.name = patch.name.trim().slice(0, 80)
      if (typeof patch?.color === 'string' && /^#[0-9a-f]{6}$/i.test(patch.color)) changed.color = patch.color.toLowerCase()
      if (typeof patch?.enabled === 'boolean') changed.enabled = patch.enabled
      if (typeof patch?.busyOnly === 'boolean') changed.busyOnly = patch.busyOnly
      if (typeof patch?.countsAsBusy === 'boolean') changed.countsAsBusy = patch.countsAsBusy
      const state = stateOf(calendar.id)
      if (changed.busyOnly && !calendar.busyOnly && state.copy) {
        // Busy only on: the titles go now, from memory and from disk.
        setCopy(changed, state, state.copy)
        keepCopy(calendar.id, state)
      }
      if ((!changed.busyOnly && calendar.busyOnly) || (changed.enabled && !calendar.enabled)) state.attemptedAt = undefined
      return changed
    }),
  }))
  await writeCalendarStore({ ...store, connections })
}

async function removeConnection(id: string): Promise<void> {
  const store = readCalendarStore()
  const connection = store.connections.find((c) => c.id === id || c.calendars.some((calendar) => calendar.id === id))
  if (!connection) return
  const config = configs.get(connection.id)
  if (config && SOURCES[connection.kind].disconnect) {
    await SOURCES[connection.kind].disconnect!(config, ctx).catch(() => {})
  }
  for (const calendar of connection.calendars) {
    states.delete(calendar.id)
    await dropCopy(calendar.id)
  }
  configs.delete(connection.id)
  connectionErrors.delete(connection.id)
  await writeCalendarStore({ ...readCalendarStore(), connections: readCalendarStore().connections.filter((c) => c.id !== connection.id) })
  syncEventKitWatch()
}

/** The calendars an account has now: new ones are added, not shown; gone ones are removed. */
async function relist(connection: StoredConnection): Promise<void> {
  const source = SOURCES[connection.kind]
  const config = await configOf(connection)
  if (!config || connection.kind === 'ics') return
  let listed: { config: unknown; calendars: RemoteCalendar[] }
  try {
    listed = await source.listCalendars(config, ctx)
  } catch (error) {
    connectionErrors.set(connection.id, messageOf(error))
    return
  }
  connectionErrors.delete(connection.id)
  const remoteIds = new Set(listed.calendars.map((c) => c.remoteId))
  for (const gone of connection.calendars.filter((c) => !remoteIds.has(c.remoteId))) {
    states.delete(gone.id)
    await dropCopy(gone.id)
  }
  const sealed = await sealConfig(connection.id, listed.config)
  // From here on nothing waits: read the store and write it in one go.
  let store = readCalendarStore()
  const current = store.connections.find((c) => c.id === connection.id)
  if (!current) return
  const kept = current.calendars.filter((c) => remoteIds.has(c.remoteId))
  const known = new Set(kept.map((c) => c.remoteId))
  const added: StoredCalendar[] = []
  for (const remote of listed.calendars.filter((c) => !known.has(c.remoteId))) {
    const taken = takeColor(store)
    store = taken.state
    added.push({ id: randomUUID(), remoteId: remote.remoteId, name: remote.name, color: taken.color, enabled: false, busyOnly: false, countsAsBusy: true })
  }
  await writeCalendarStore({
    ...store,
    connections: store.connections.map((c) => (c.id === connection.id ? { ...c, sealed, calendars: [...kept, ...added] } : c)),
  })
}

async function refreshAll(connectionId?: string): Promise<void> {
  const store = readCalendarStore()
  const chosen = store.connections.filter((c) => !connectionId || c.id === connectionId)
  await Promise.all(chosen.map(relist))
  const now = readCalendarStore()
  const reads: Promise<boolean>[] = []
  for (const connection of now.connections.filter((c) => !connectionId || c.id === connectionId)) {
    for (const calendar of connection.calendars.filter((c) => c.enabled)) reads.push(refreshCalendar(connection, calendar, null, true))
  }
  await Promise.all(reads)
}

async function eventsBetween(from: Date, to: Date): Promise<CalendarEventsResult> {
  const store = readCalendarStore()
  syncEventKitWatch()
  const shown = store.connections.flatMap((connection) => connection.calendars.filter((c) => c.enabled).map((calendar) => ({ connection, calendar })))
  await Promise.all(shown.map(({ calendar }) => ensureLoaded(calendar)))
  const waits: Promise<boolean>[] = []
  for (const { connection, calendar } of shown) {
    const state = stateOf(calendar.id)
    const holds = state.copy ? SOURCES[connection.kind].covers(state.copy, from, to) : false
    const read = refreshCalendar(connection, calendar, { from, to }, false)
    // With a copy that holds the days, answer now and let the read finish in the background.
    if (holds) void read.then((changed) => changed && announceChanged())
    else waits.push(read)
  }
  await Promise.all(waits)

  const events: CalendarEvent[] = []
  for (const { calendar } of shown) {
    const state = stateOf(calendar.id)
    if (!state.parsed) continue
    try {
      const found = occurrencesBetween(state.parsed, calendar.id, from, to, MAX_RANGE_EVENTS + 1)
      state.warning = found.length > MAX_RANGE_EVENTS ? `Shows the first ${MAX_RANGE_EVENTS} events of these days only.` : undefined
      for (const event of found.slice(0, MAX_RANGE_EVENTS)) {
        // Busy only: the title and place never reach a window.
        events.push(calendar.busyOnly ? busyOnlyEvent(event) : event)
      }
    } catch {
      state.error = 'The calendar could not be read: it is not a valid calendar file.'
    }
  }
  return { events, feeds: allFeeds(readCalendarStore()) }
}

function pruneDrafts(): void {
  const now = Date.now()
  for (const [id, draft] of drafts) if (draft.expires < now) drafts.delete(id)
}

// --- The Mac's calendars (EventKit) ---------------------------------------------------------------
// The Mac says when its calendars changed (20.9): while a Mac connection exists the helper watches,
// and a change reads every shown Mac calendar again at once, past the 5-minute rule. A calendar
// added or removed on the Mac updates the connection's list as a manual refresh would.

const EVENTKIT_SETTLE_MS = 1500
let eventKitChangeTimer: ReturnType<typeof setTimeout> | null = null

function syncEventKitWatch(): void {
  if (!isMac) return
  const watched = readCalendarStore().connections.some((connection) => connection.kind === 'eventkit')
  const helper = eventKitHelperIfAny()
  if (!helper) return
  if (watched && !helper.watching) helper.watch(onEventKitChanged)
  else if (!watched && helper.watching) helper.unwatch()
}

/** Changes come in bursts (a sync of an account): read once they settle. */
function onEventKitChanged(): void {
  if (eventKitChangeTimer) clearTimeout(eventKitChangeTimer)
  eventKitChangeTimer = setTimeout(() => {
    eventKitChangeTimer = null
    void rereadEventKit()
  }, EVENTKIT_SETTLE_MS)
}

async function rereadEventKit(): Promise<void> {
  let changed = false
  for (const connection of readCalendarStore().connections.filter((c) => c.kind === 'eventkit')) {
    try {
      const listed = await eventkitSource.listCalendars({ accounts: [] }, ctx)
      const now = new Set(listed.calendars.map((calendar) => calendar.remoteId))
      const known = new Set(connection.calendars.map((calendar) => calendar.remoteId))
      if (now.size !== known.size || [...now].some((id) => !known.has(id))) {
        await relist(connection)
        changed = true
      }
    } catch {
      // A read below says why.
    }
    const current = readCalendarStore().connections.find((c) => c.id === connection.id)
    if (!current) continue
    const reads = current.calendars.filter((c) => c.enabled).map((calendar) => refreshCalendar(current, calendar, null, true))
    if ((await Promise.all(reads)).some(Boolean)) changed = true
  }
  if (changed) announceChanged()
}

function registerEventKitIpc(): void {
  const added = () => readCalendarStore().connections.some((connection) => connection.kind === 'eventkit')

  handleTrusted('calendar:eventkit-status', () => eventKitStatus(added()))

  // Asks macOS for the permission when it has not been asked, then lists the calendars to pick.
  handleTrusted('calendar:eventkit-discover', async () => {
    try {
      if (added()) return { success: false, error: 'The calendars of this Mac are already added. Choose which to show in the list.' }
      const helper = eventKitHelper()
      const access = await helper.request()
      if (access !== 'full') return { success: false, error: (await eventKitStatus(false)).problem ?? EVENTKIT_DENIED_MESSAGE }
      const calendars = foundCalendars(await helper.calendars())
      if (calendars.length === 0) return { success: false, error: 'This Mac has no calendars with events. Add an account in System Settings, Internet Accounts.' }
      return { success: true, data: calendars }
    } catch (error) {
      return { success: false, error: messageOf(error) }
    }
  })

  handleTrusted('calendar:eventkit-save', async (_event, input: EventKitSaveInput) => {
    try {
      if (added()) return { success: false, error: 'The calendars of this Mac are already added.' }
      const result = await eventkitSource.connect(undefined, ctx)
      const shown = new Set(Array.isArray(input?.shown) ? input.shown.map(String) : [])
      const connection = await addConnection('eventkit', result, (calendar) => shown.has(calendar.remoteId), input?.busyOnly === true)
      syncEventKitWatch()
      announceChanged()
      return { success: true, data: await connectionView(connection) }
    } catch (error) {
      return { success: false, error: messageOf(error) }
    }
  })

  handleTrusted('calendar:eventkit-open-settings', () => openCalendarPrivacySettings())
}

// --- IPC ------------------------------------------------------------------------------------------

export function registerCalendarIpc(): void {
  handleTrusted('calendar:list', () => sourcesView())

  handleTrusted('calendar:events', (_event, range: { from: string; to: string }) => {
    const from = new Date(range?.from)
    const to = new Date(range?.to)
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) return { events: [], feeds: allFeeds(readCalendarStore()) }
    return eventsBetween(from, to)
  })

  handleTrusted('calendar:add', async (_event, input: AddCalendarLinkInput) => {
    try {
      const result = await icsLinkSource.connect(input, ctx)
      const connection = await addConnection('ics', result, () => true, input?.busyOnly === true)
      return { success: true, data: await connectionView(connection) }
    } catch (error) {
      return { success: false, error: messageOf(error) }
    }
  })

  handleTrusted('calendar:caldav-discover', async (_event, input: CaldavDiscoverInput) => {
    pruneDrafts()
    try {
      const result = await caldavSource.connect(input, ctx)
      const draftId = randomUUID()
      drafts.set(draftId, { result, expires: Date.now() + DRAFT_MS })
      const draft: CaldavDraft = { draftId, name: result.name, detail: caldavSource.describe(result.config), calendars: result.calendars }
      return { success: true, data: draft }
    } catch (error) {
      return { success: false, error: messageOf(error) }
    }
  })

  handleTrusted('calendar:caldav-save', async (_event, draftId: string, input: CaldavSaveInput) => {
    pruneDrafts()
    const draft = drafts.get(String(draftId))
    if (!draft) return { success: false, error: 'The sign-in has expired. Sign in again.' }
    drafts.delete(String(draftId))
    const shown = new Set(Array.isArray(input?.shown) ? input.shown.map(String) : [])
    const connection = await addConnection('caldav', draft.result, (calendar) => shown.has(calendar.remoteId), input?.busyOnly === true)
    announceChanged()
    return { success: true, data: await connectionView(connection) }
  })

  handleTrusted('calendar:caldav-cancel', (_event, draftId: string) => {
    drafts.delete(String(draftId))
  })

  handleTrusted('calendar:update', async (_event, calendarId: string, patch: CalendarPatch) => {
    await updateCalendar(String(calendarId), patch ?? {})
    return sourcesView()
  })

  handleTrusted('calendar:remove', async (_event, id: string) => {
    await removeConnection(String(id))
    return sourcesView()
  })

  handleTrusted('calendar:refresh', async (_event, connectionId?: string) => {
    await refreshAll(typeof connectionId === 'string' ? connectionId : undefined)
    return sourcesView()
  })

  registerEventKitIpc()
}
