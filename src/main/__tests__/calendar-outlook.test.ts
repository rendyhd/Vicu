import { execFileSync } from 'child_process'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => process.cwd() } }))

import { OUTLOOK_CLOSED_MESSAGE, OUTLOOK_MISSING_MESSAGE } from '../../shared/calendar-sources'
import { CalendarReadError } from '../calendar/http'
import { occurrencesBetween, parseIcsDocuments } from '../calendar/ics'
import { parseAnswer } from '../calendar/outlook'
import {
  asHelperEvent,
  createOutlookSource,
  MAX_OUTLOOK_EVENTS,
  outlookCalendars,
  outlookItemToIcs,
  outlookState,
  type OutlookItem,
  type OutlookRunner,
} from '../calendar/sources/outlook'
import type { CalendarCopy, SourceContext } from '../calendar/sources/types'

// Classic Outlook (contract 20.9) against a fake script: what is shown and how (show as, cancelled,
// your own answer), the calendars' names, the window, and the sentences for a closed or missing
// Outlook. The real script is run once on Windows for its status, which never starts Outlook.

const ctx = { now: () => Date.now() } as unknown as SourceContext
const H = 3600_000
const base = Date.UTC(2026, 10, 16, 9, 0, 0)

const item = (over: Partial<OutlookItem> = {}): OutlookItem => ({ key: 'uid-1/1', calendarId: 'cal-1', title: 'Weekly sync', start: base, end: base + H, busy: 2, meeting: 0, response: 0, ...over })

function fakeRunner(answers: Partial<Record<'status' | 'calendars' | 'events', unknown>>, calls: unknown[] = []): OutlookRunner {
  return async (command, args) => {
    calls.push({ command, args })
    const answer = answers[command]
    if (answer instanceof Error) throw answer
    return answer
  }
}

async function errorOf(promise: Promise<unknown>): Promise<CalendarReadError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof CalendarReadError) return error
    throw error
  }
  throw new Error('expected a CalendarReadError')
}

describe('an Outlook appointment as iCalendar', () => {
  it('reads show as like Microsoft 365: free and working elsewhere are free', () => {
    expect(asHelperEvent(item({ busy: 0 })).availability).toBe('free')
    expect(asHelperEvent(item({ busy: 4 })).availability).toBe('free')
    expect(asHelperEvent(item({ busy: 1 })).availability).toBe('tentative')
    expect(asHelperEvent(item({ busy: 2 })).availability).toBe('busy')
    expect(asHelperEvent(item({ busy: 3 })).availability).toBe('unavailable')
    expect(outlookItemToIcs(item({ busy: 0 }))).toContain('TRANSP:TRANSPARENT')
    expect(outlookItemToIcs(item({ busy: 2 }))).not.toContain('TRANSP')
  })

  it('leaves out a cancelled meeting and one you declined', () => {
    expect(outlookItemToIcs(item({ meeting: 5 }))).toBeNull()
    expect(outlookItemToIcs(item({ meeting: 7 }))).toBeNull()
    expect(outlookItemToIcs(item({ response: 4 }))).toBeNull()
  })

  it('makes tentative what you answered tentative or have not answered yet', () => {
    expect(outlookItemToIcs(item({ response: 2 }))).toContain('STATUS:TENTATIVE')
    expect(outlookItemToIcs(item({ response: 5 }))).toContain('STATUS:TENTATIVE')
    expect(outlookItemToIcs(item({ response: 3 }))).not.toContain('STATUS:TENTATIVE')
    expect(outlookItemToIcs(item({ busy: 1 }))).toContain('STATUS:TENTATIVE')
  })

  it('keeps the title and place, and names itself', () => {
    const text = outlookItemToIcs(item({ title: 'Plan, review; ship', location: 'Room 4' }))!
    expect(text).toContain('PRODID:-//Vicu//Classic Outlook//EN')
    expect(text).toContain('SUMMARY:Plan\\, review\\; ship')
    expect(text).toContain('LOCATION:Room 4')
  })

  it('shows an all-day appointment on its local days', () => {
    const start = new Date(2026, 10, 16).getTime()
    const end = new Date(2026, 10, 18).getTime()
    const text = outlookItemToIcs(item({ allDay: true, start, end }))!
    expect(text).toContain('DTSTART;VALUE=DATE:20261116')
    expect(text).toContain('DTEND;VALUE=DATE:20261118')
  })
})

describe('Outlook calendars', () => {
  it('names calendars with the account when two share a name', () => {
    expect(
      outlookCalendars([
        { id: 'a', name: 'Calendar', account: 'sam@work.com' },
        { id: 'b', name: 'Calendar', account: 'sam@home.net' },
        { id: 'c', name: 'Holidays', account: 'sam@work.com' },
      ]),
    ).toEqual([
      { remoteId: 'a', name: 'Calendar (sam@work.com)' },
      { remoteId: 'b', name: 'Calendar (sam@home.net)' },
      { remoteId: 'c', name: 'Holidays' },
    ])
  })

  it('connects to the open Outlook and lists its calendars', async () => {
    const source = createOutlookSource(() => fakeRunner({ calendars: { calendars: [{ id: 'a', name: 'Calendar', account: 'sam@work.com' }, { id: 'b', name: 'Team', account: 'sam@work.com' }] } }))
    const result = await source.connect(undefined, ctx)
    expect(result.name).toBe('Classic Outlook')
    expect(result.calendars.map((c) => c.name)).toEqual(['Calendar', 'Team'])
    expect(source.describe(result.config)).toBe('Classic Outlook on this PC: sam@work.com')
  })

  it('says to open Outlook when it is closed, and what to do when it is missing', async () => {
    const closed = createOutlookSource(() => fakeRunner({ calendars: { error: 'closed' } }))
    expect((await errorOf(closed.connect(undefined, ctx))).message).toBe(OUTLOOK_CLOSED_MESSAGE)
    const missing = createOutlookSource(() => fakeRunner({ calendars: { error: 'missing' } }))
    expect((await errorOf(missing.connect(undefined, ctx))).message).toBe(OUTLOOK_MISSING_MESSAGE)
    const failed = createOutlookSource(() => fakeRunner({ calendars: { error: 'failed', message: 'RPC busy' } }))
    expect((await errorOf(failed.connect(undefined, ctx))).message).toContain('Outlook could not be read')
  })

  it('reads its state without throwing', async () => {
    expect(await outlookState(fakeRunner({ status: { state: 'running' } }))).toBe('running')
    expect(await outlookState(fakeRunner({ status: { state: 'closed' } }))).toBe('closed')
    expect(await outlookState(fakeRunner({ status: new Error('no powershell') }))).toBe('missing')
  })
})

describe('reading an Outlook calendar', () => {
  const range = { from: new Date(base - 9 * H), to: new Date(base + 15 * H) }

  it('reads a window around the days and shows what Outlook has', async () => {
    const calls: { command: string; args?: Record<string, string | number> }[] = []
    const events = [item(), item({ key: 'uid-2/1', title: 'Declined', response: 4 }), item({ key: 'x/1', calendarId: 'other', title: 'Elsewhere' })]
    const source = createOutlookSource(() => fakeRunner({ events: { events, missing: [], truncated: false } }, calls))
    const outcome = await source.read({ accounts: [] }, 'cal-1', range, ctx)
    expect(outcome.status).toBe('changed')
    const args = calls[0].args!
    expect(args.Ids).toBe('cal-1')
    expect(Number(args.From)).toBeLessThan(range.from.getTime())
    expect(Number(args.To)).toBeGreaterThan(range.to.getTime())
    if (outcome.status !== 'changed') return
    const parsed = parseIcsDocuments(outcome.documents.map((doc) => doc.ics))
    expect(occurrencesBetween(parsed, 'cal', range.from, range.to, 10).map((event) => event.title)).toEqual(['Weekly sync'])
  })

  it('is unchanged when the same window holds the same events', async () => {
    const source = createOutlookSource(() => fakeRunner({ events: { events: [item()], missing: [], truncated: false } }))
    const first = await source.read({ accounts: [] }, 'cal-1', range, ctx)
    if (first.status !== 'changed') throw new Error('expected changed')
    const copy: CalendarCopy = { documents: first.documents, validators: first.validators, fetchedAt: Date.now(), busyOnly: false }
    expect(source.covers(copy, range.from, range.to)).toBe(true)
    expect((await source.read({ accounts: [] }, 'cal-1', { ...range, previous: copy }, ctx)).status).toBe('unchanged')
  })

  it('says when the calendar is gone or too large', async () => {
    const gone = createOutlookSource(() => fakeRunner({ events: { events: [], missing: ['cal-1'], truncated: false } }))
    expect((await errorOf(gone.read({ accounts: [] }, 'cal-1', range, ctx))).message).toBe('This calendar is no longer in Outlook.')
    const large = createOutlookSource(() => fakeRunner({ events: { events: [], missing: [], truncated: true } }))
    expect((await errorOf(large.read({ accounts: [] }, 'cal-1', range, ctx))).message).toContain(String(MAX_OUTLOOK_EVENTS))
    const closed = createOutlookSource(() => fakeRunner({ events: { error: 'closed' } }))
    expect((await errorOf(closed.read({ accounts: [] }, 'cal-1', range, ctx))).message).toBe(OUTLOOK_CLOSED_MESSAGE)
  })
})

describe('the script', () => {
  it('finds its JSON answer among other lines', () => {
    expect(parseAnswer('WARNING: something\r\n{"state":"closed"}\r\n')).toEqual({ state: 'closed' })
    expect(parseAnswer('nothing here')).toBeNull()
  })

  it.runIf(process.platform === 'win32')('answers its status on Windows without starting Outlook', () => {
    const script = join(process.cwd(), 'resources', 'outlook', 'outlook-calendar.ps1')
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Command', 'status'], { encoding: 'utf8', timeout: 30000, windowsHide: true })
    expect(['missing', 'closed', 'running']).toContain((parseAnswer(out) as { state: string }).state)
  }, 40000)
})
