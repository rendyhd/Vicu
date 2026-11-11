import { spawn } from 'child_process'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { busyOnlyEvent } from '../../shared/calendar-events'
import { EVENTKIT_DENIED_MESSAGE, groupByAccount } from '../../shared/calendar-eventkit'
import { EventKitHelper, type HelperEvent } from '../calendar/eventkit-helper'
import { CalendarReadError } from '../calendar/http'
import { occurrencesBetween, parseIcsDocuments, reduceIcs } from '../calendar/ics'
import { createEventKitSource, eventToIcs, foundCalendars } from '../calendar/sources/eventkit'
import type { CalendarCopy, SourceContext } from '../calendar/sources/types'

// The Mac's calendars (EventKit, docs/calendar-plan.md 2d) against a fake helper: a Node script
// speaking the helper's protocol (fake-eventkit-helper.mjs), started as a real process.

const FAKE = join(__dirname, 'fake-eventkit-helper.mjs')
const ctx = { now: () => Date.now() } as unknown as SourceContext
const H = 3600_000

const helpers: EventKitHelper[] = []
const dirs: string[] = []
afterEach(() => {
  for (const helper of helpers.splice(0)) helper.close()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function logFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'vicu-eventkit-'))
  dirs.push(dir)
  return join(dir, 'log.txt')
}

function fakeHelper(config: Record<string, unknown>, options: { log?: string; idleMs?: number; requestTimeoutMs?: number; restartDelaysMs?: number[] } = {}): EventKitHelper {
  const helper = new EventKitHelper({
    spawn: () => spawn(process.execPath, [FAKE], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, FAKE_EVENTKIT: JSON.stringify(config), FAKE_EVENTKIT_LOG: options.log ?? '' },
    }),
    idleMs: options.idleMs,
    requestTimeoutMs: options.requestTimeoutMs,
    restartDelaysMs: options.restartDelaysMs,
  })
  helpers.push(helper)
  return helper
}

const until = async (check: () => boolean, ms = 3000) => {
  const end = Date.now() + ms
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

const day = Date.UTC(2026, 10, 10)
const calendars = [
  { id: 'cal-work', title: 'Calendar', color: '#1BADF8', source: 'Exchange', sourceType: 'exchange', type: 'exchange' },
  { id: 'cal-home', title: 'Calendar', color: '#63DA38', source: 'iCloud', sourceType: 'icloud', type: 'caldav' },
  { id: 'cal-gym', title: 'Gym', source: 'iCloud', sourceType: 'icloud', type: 'caldav' },
  { id: 'cal-bday', title: 'Birthdays', source: 'Other', sourceType: 'birthdays', type: 'birthday' },
]
const event = (over: Partial<HelperEvent>): HelperEvent => ({
  key: 'e1|0', calendarId: 'cal-work', title: 'Standup', start: day + 9 * H, end: day + 10 * H, allDay: false,
  availability: 'busy', status: 'confirmed', ...over,
})
const events: HelperEvent[] = [
  event({ key: 'busy|1', title: 'Standup; daily, with Sam', location: 'Room 1\nFloor 2' }),
  event({ key: 'free|1', title: 'Lunch', start: day + 12 * H, end: day + 13 * H, availability: 'free' }),
  event({ key: 'tent|1', title: 'Maybe', start: day + 14 * H, end: day + 15 * H, availability: 'tentative' }),
  event({ key: 'pending|1', title: 'Invite', start: day + 15 * H, end: day + 16 * H, self: 'pending' }),
  event({ key: 'cancel|1', title: 'Cancelled', start: day + 16 * H, end: day + 17 * H, status: 'canceled' }),
  event({ key: 'declined|1', title: 'Declined', start: day + 17 * H, end: day + 18 * H, self: 'declined' }),
  event({ key: 'other|1', calendarId: 'cal-home', title: 'Home thing' }),
]

describe('the helper protocol', () => {
  it('reads the access, the calendars and the events, skipping lines that are not the protocol', async () => {
    const helper = fakeHelper({ access: 'full', calendars, events })
    expect(await helper.status()).toBe('full')
    const list = await helper.calendars()
    expect(list.map((c) => [c.id, c.title, c.color, c.source])).toEqual([
      ['cal-work', 'Calendar', '#1badf8', 'Exchange'],
      ['cal-home', 'Calendar', '#63da38', 'iCloud'],
      ['cal-gym', 'Gym', undefined, 'iCloud'],
      ['cal-bday', 'Birthdays', undefined, 'Other'],
    ])
    const answer = await helper.events(['cal-work', 'gone'], day, day + 24 * H)
    expect(answer.events.map((e) => e.key)).toEqual(['busy|1', 'free|1', 'tent|1', 'pending|1', 'cancel|1', 'declined|1'])
    expect(answer.missing).toEqual(['gone'])
  })

  it('asks for the permission once and reports what macOS answered', async () => {
    const helper = fakeHelper({ access: 'not-determined', grant: 'full', calendars })
    expect(await helper.status()).toBe('not-determined')
    expect(await helper.request()).toBe('full')
    expect(await helper.calendars()).toHaveLength(4)
  })

  it('says plainly when Vicu may not read the calendars', async () => {
    const helper = fakeHelper({ access: 'denied', calendars })
    await expect(helper.calendars()).rejects.toThrow(EVENTKIT_DENIED_MESSAGE)
    const source = createEventKitSource(() => helper)
    await expect(source.connect(undefined, ctx)).rejects.toThrow(EVENTKIT_DENIED_MESSAGE)
  })

  it('fails the waiting request when the helper stops, and starts it again for the next', async () => {
    const log = logFile()
    const helper = fakeHelper({ crashOn: 'events', calendars }, { log })
    await expect(helper.events(['cal-work'], day, day + H)).rejects.toThrow('the calendar helper stopped')
    expect(await helper.status()).toBe('full')
    expect(readFileSync(log, 'utf8').match(/start/g)).toHaveLength(2)
  })

  it('gives up on a request that gets no answer', async () => {
    const helper = fakeHelper({ hangOn: 'calendars' }, { requestTimeoutMs: 150 })
    await expect(helper.calendars()).rejects.toMatchObject({ code: 'timeout' })
  })

  it('lets an idle helper go when nothing watches', async () => {
    const log = logFile()
    const helper = fakeHelper({}, { log, idleMs: 50 })
    await helper.status()
    await until(() => readFileSync(log, 'utf8').includes('end'))
  })
})

describe('watching the Mac for changes', () => {
  it('passes every change notice on and keeps the helper running', async () => {
    const log = logFile()
    const helper = fakeHelper({ changes: 2 }, { log, idleMs: 20 })
    let changes = 0
    helper.watch(() => changes++)
    await until(() => changes === 2)
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(readFileSync(log, 'utf8')).not.toContain('end')
    helper.unwatch()
    await until(() => readFileSync(log, 'utf8').includes('end'))
  })

  it('starts a watched helper that stopped again, with one notice for what it may have missed', async () => {
    const log = logFile()
    const helper = fakeHelper({ exitAfterWatch: 50 }, { log, restartDelaysMs: [30] })
    let changes = 0
    helper.watch(() => changes++)
    await until(() => changes === 1)
    const lines = readFileSync(log, 'utf8')
    expect(lines.match(/start/g)).toHaveLength(2)
    expect(lines.match(/watch/g)).toHaveLength(2)
  })
})

describe('the eventkit source', () => {
  const read = async (source: ReturnType<typeof createEventKitSource>, remoteId: string, previous?: CalendarCopy) =>
    source.read({ accounts: [] }, remoteId, { from: new Date(day), to: new Date(day + 24 * H), previous }, ctx)

  it('lists the calendars by account, unique names, Birthdays not ticked', async () => {
    const helper = fakeHelper({ calendars })
    const found = foundCalendars(await helper.calendars())
    expect(found.map((c) => [c.name, c.account, c.suggested])).toEqual([
      ['Calendar (Exchange)', 'Exchange', true],
      ['Calendar (iCloud)', 'iCloud', true],
      ['Gym', 'iCloud', true],
      ['Birthdays', 'Other', false],
    ])
    expect(groupByAccount(found).map((g) => [g.account, g.calendars.length])).toEqual([['Exchange', 1], ['iCloud', 2], ['Other', 1]])
    const source = createEventKitSource(() => helper)
    const connected = await source.connect(undefined, ctx)
    expect(connected.name).toBe('Mac calendars')
    expect(source.describe(connected.config)).toBe('On this Mac: Exchange, iCloud, Other')
    expect(connected.calendars.map((c) => c.remoteId)).toEqual(['cal-work', 'cal-home', 'cal-gym', 'cal-bday'])
  })

  it('reads one calendar: busy, free and tentative kept, cancelled and declined left out', async () => {
    const source = createEventKitSource(() => fakeHelper({ calendars, events }))
    const outcome = await read(source, 'cal-work')
    expect(outcome.status).toBe('changed')
    if (outcome.status !== 'changed') return
    expect(outcome.documents.map((d) => d.key)).toEqual(['busy|1', 'free|1', 'tent|1', 'pending|1'])
    const found = occurrencesBetween(parseIcsDocuments(outcome.documents.map((d) => d.ics)), 'c', new Date(day), new Date(day + 24 * H))
    expect(found.map((e) => [e.title, e.start, e.end, e.busy, e.tentative])).toEqual([
      ['Standup; daily, with Sam', '2026-11-10T09:00:00.000Z', '2026-11-10T10:00:00.000Z', true, false],
      ['Lunch', '2026-11-10T12:00:00.000Z', '2026-11-10T13:00:00.000Z', false, false],
      ['Maybe', '2026-11-10T14:00:00.000Z', '2026-11-10T15:00:00.000Z', true, true],
      ['Invite', '2026-11-10T15:00:00.000Z', '2026-11-10T16:00:00.000Z', true, true],
    ])
    expect(found[0].location).toBe('Room 1\nFloor 2')
  })

  it('reads the same window again as unchanged while nothing changed', async () => {
    const source = createEventKitSource(() => fakeHelper({ calendars, events }))
    const first = await read(source, 'cal-work')
    if (first.status !== 'changed') throw new Error('expected a read')
    const copy: CalendarCopy = { documents: first.documents, validators: first.validators, fetchedAt: Date.now(), busyOnly: false }
    expect(source.covers(copy, new Date(day), new Date(day + 24 * H))).toBe(true)
    expect((await read(source, 'cal-work', copy)).status).toBe('unchanged')
  })

  it('keeps no title or place once Busy only reduces the copy', async () => {
    const source = createEventKitSource(() => fakeHelper({ calendars, events }))
    const outcome = await read(source, 'cal-work')
    if (outcome.status !== 'changed') throw new Error('expected a read')
    // What the service keeps for a Busy only calendar (service.ts reduceDocuments).
    const kept = outcome.documents.map((d) => reduceIcs(d.ics, true))
    for (const ics of kept) {
      expect(ics).not.toMatch(/SUMMARY|LOCATION|Standup|Room 1/)
    }
    const shown = occurrencesBetween(parseIcsDocuments(kept), 'c', new Date(day), new Date(day + 24 * H)).map(busyOnlyEvent)
    expect(shown.map((e) => e.title)).toEqual(['Busy', 'Free', 'Busy', 'Busy'])
  })

  it('says when a calendar is no longer on the Mac', async () => {
    const source = createEventKitSource(() => fakeHelper({ calendars, events }))
    await expect(read(source, 'gone')).rejects.toThrow('This calendar is no longer on this Mac.')
  })

  it('says plainly when the helper is missing', async () => {
    const missing = 'The calendar helper is not built. Run npm run calendar:helper, then start Vicu again.'
    const source = createEventKitSource(() => { throw new CalendarReadError(missing) })
    await expect(read(source, 'cal-work')).rejects.toThrow(missing)
    await expect(source.connect(undefined, ctx)).rejects.toThrow(missing)
    // Through a helper whose binary is gone between two starts.
    const helper = new EventKitHelper({ spawn: () => { throw new CalendarReadError(missing) } })
    await expect(helper.status()).rejects.toThrow(missing)
  })
})

describe('one occurrence as iCalendar', () => {
  const local = (y: number, m: number, d: number, h = 0, min = 0, s = 0) => new Date(y, m - 1, d, h, min, s).getTime()

  it('writes an all-day event as local dates, ending the day after its last day', () => {
    // EventKit ends an all-day event at 23:59:59 of its last day.
    const ics = eventToIcs(event({ allDay: true, start: local(2026, 11, 10), end: local(2026, 11, 11, 23, 59, 59) }))!
    expect(ics).toContain('DTSTART;VALUE=DATE:20261110')
    expect(ics).toContain('DTEND;VALUE=DATE:20261112')
    // Some accounts end it at the next midnight instead.
    const midnight = eventToIcs(event({ allDay: true, start: local(2026, 11, 10), end: local(2026, 11, 11) }))!
    expect(midnight).toContain('DTEND;VALUE=DATE:20261111')
    const [occurrence] = occurrencesBetween(parseIcsDocuments([ics]), 'c', new Date(local(2026, 11, 9)), new Date(local(2026, 11, 14)))
    expect(occurrence.allDay).toBe(true)
    expect(occurrence.start).toBe(new Date(local(2026, 11, 10)).toISOString())
    expect(occurrence.end).toBe(new Date(local(2026, 11, 12)).toISOString())
  })

  it('escapes text and leaves cancelled and declined events out', () => {
    expect(eventToIcs(event({ title: 'a,b;c\\d' }))).toContain('SUMMARY:a\\,b\\;c\\\\d')
    expect(eventToIcs(event({ status: 'canceled' }))).toBeNull()
    expect(eventToIcs(event({ self: 'declined' }))).toBeNull()
    expect(eventToIcs(event({ self: 'accepted' }))).not.toContain('TENTATIVE')
  })
})

it('the fake helper is where the tests expect it', () => {
  expect(existsSync(FAKE)).toBe(true)
})
