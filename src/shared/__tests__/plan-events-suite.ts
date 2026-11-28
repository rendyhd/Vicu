import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CALENDAR_COLORS,
  allDayEventsOn,
  busyOnlyEvent,
  calendarCounts,
  eventBusyOfDay,
  timedEventsOn,
  type CalendarEvent,
} from '../calendar-events'
import {
  EVENT_KEY_PREFIX,
  MAX_EVENT_MINUTES,
  MY_EVENTS_CALENDAR_ID,
  MY_EVENTS_COLOR,
  changeEvent,
  choiceIndex,
  deleteEvent,
  encodePlanEvent,
  eventDaysBetween,
  isBusy,
  planEventOccurrences,
  readPlanEvent,
  readPlanEvents,
  readRepeat,
  repeatChoiceDay,
  repeatChoices,
  repeatText,
  skipEventDay,
  undoEventWrites,
  type EventEdit,
  type EventRepeat,
  type EventScope,
  type EventWrites,
  type ListedEvent,
} from '../plan-events'
import { clockMinutes, freeMinutes, nextFreeSlot, type BusyRange, type PlannerHours } from '../time-blocks'

/**
 * The `planEvents`, `eventBusy` and `eventChanges` vectors of test-fixtures/cross-app-semantics-v1.json
 * (contract section 20). Times are local wall-clock times, converted in the process time zone; the
 * zone wrappers (plan-events*.test.ts) set `process.env.TZ` first. Vicu mobile runs the same blocks.
 * Nothing here may build a Date at module scope. `icsImport` needs a calendar parser and runs in
 * src/main/__tests__/ics-import-suite.ts.
 */

type Stored = Record<string, unknown>
interface Occurrence {
  day: string
  start: string
  end: string
  allDay: boolean
  busy: boolean
}
interface PlanEventVectors {
  keyPrefix: string
  myEventsCalendarId: string
  myEventsColor: string
  maxMinutes: number
  read: Array<{ name: string; value: unknown; expect: Stored | null; busy?: boolean }>
  list: { values: Record<string, unknown>; expect: string[] }
  days: Array<{ name: string; event: Stored; from: string; to: string; expect: string[] }>
  times: Array<{ name: string; event: Stored; days: string[]; expect: Occurrence[] }>
  choices: Array<{ day: string; expect: Array<{ label: string; repeat: Stored }> }>
  choiceDays: Array<{ name: string; event: Stored; day: string; scope: EventScope; expect: string | null }>
  text: Array<{ repeat: Stored; text: string }>
}
interface FixtureEvent {
  id: string
  calendar: string
  start: string
  end: string
  allDay: boolean
  busy: boolean
  tentative: boolean
}
interface EventBusyVectors {
  calendars: Array<{ id: string; shown: boolean; countsAsBusy: boolean }>
  events: FixtureEvent[]
  days: Array<{ day: string; timed: Array<{ id: string; from: number; to: number }>; allDay: string[]; busy: Array<[number, number]> }>
  free: {
    now: string
    day: string
    hours: PlannerHours
    blocks: Array<[string, string]>
    freeMinutes: number
    nextFree: Array<{ minutes: number; expect: string | null }>
  }
  busyOnly: Array<{ name: string; event: { title: string; location?: string; busy: boolean }; expect: { title: string } }>
}
interface EventChangeVectors {
  cases: Array<{
    name: string
    entries: Record<string, Stored>
    id: string
    day: string
    action: 'change' | 'skip' | 'delete'
    scope?: EventScope
    edit?: EventEdit
    newId?: string
    expect: Record<string, Stored | null>
    undo: Record<string, Stored | null>
  }>
}

function loadVectors(): { planEvents: PlanEventVectors; eventBusy: EventBusyVectors; eventChanges: EventChangeVectors } {
  return JSON.parse(readFileSync(join(process.cwd(), 'test-fixtures', 'cross-app-semantics-v1.json'), 'utf8'))
}

/** `2026-10-06T10:00:00` as a Date in the process time zone. */
function local(value: string): Date {
  const [datePart, timePart = '00:00:00'] = value.split('T')
  const [y, m, d] = datePart.split('-').map(Number)
  const [h, mi, s = 0] = timePart.split(':').map(Number)
  return new Date(y, m - 1, d, h, mi, s)
}

const pad = (n: number) => String(n).padStart(2, '0')
const wall = (iso: string): string => {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function eventOf(stored: Stored, id = 'x'): ListedEvent {
  const event = readPlanEvent(stored)
  if (!event) throw new Error(`not an Event: ${JSON.stringify(stored)}`)
  return { ...event, id }
}

function calendarEvent(event: FixtureEvent): CalendarEvent {
  return {
    id: event.id,
    calendarId: event.calendar,
    title: event.id,
    start: local(event.start).toISOString(),
    end: local(event.end).toISOString(),
    allDay: event.allDay,
    busy: event.busy,
    tentative: event.tentative,
  }
}

const byRange = <T extends { id: string; from: number; to: number }>(a: T, b: T) => a.from - b.from || a.to - b.to || (a.id < b.id ? -1 : 1)

export function runPlanEventsSuite(options: { zone: string; expectedOffsetMinutesInOctober?: number }): void {
  const { planEvents, eventBusy, eventChanges } = loadVectors()

  describe(`Events and calendars in ${options.zone}`, () => {
    it('is running in the requested time zone, with the contract constants', () => {
      if (options.expectedOffsetMinutesInOctober !== undefined) {
        expect(new Date(2026, 9, 6).getTimezoneOffset()).toBe(options.expectedOffsetMinutesInOctober)
      }
      expect(EVENT_KEY_PREFIX).toBe(planEvents.keyPrefix)
      expect(MY_EVENTS_CALENDAR_ID).toBe(planEvents.myEventsCalendarId)
      expect(MY_EVENTS_COLOR).toBe(planEvents.myEventsColor)
      expect(MAX_EVENT_MINUTES).toBe(planEvents.maxMinutes)
      expect(CALENDAR_COLORS).toContain(MY_EVENTS_COLOR)
    })

    describe('planEvents.read', () => {
      for (const vector of planEvents.read) {
        it(vector.name, () => {
          const event = readPlanEvent(vector.value)
          if (vector.expect === null) {
            expect(event).toBeNull()
            return
          }
          expect(event).not.toBeNull()
          expect(encodePlanEvent(event!)).toEqual(vector.expect)
          expect(isBusy(event!)).toBe(vector.busy)
          // Reading what is written gives the same Event.
          expect(encodePlanEvent(readPlanEvent(encodePlanEvent(event!))!)).toEqual(vector.expect)
        })
      }
    })

    it('planEvents.list', () => {
      expect(readPlanEvents(planEvents.list.values).map((event) => event.id)).toEqual(planEvents.list.expect)
    })

    describe('planEvents.days', () => {
      for (const vector of planEvents.days) {
        it(vector.name, () => {
          expect(eventDaysBetween(eventOf(vector.event), vector.from, vector.to)).toEqual(vector.expect)
        })
      }
    })

    describe('planEvents.times', () => {
      for (const vector of planEvents.times) {
        it(vector.name, () => {
          const occurrences = planEventOccurrences([eventOf(vector.event, 'e')], vector.days)
          expect(
            occurrences.map((o) => ({ day: o.day, start: wall(o.start), end: wall(o.end), allDay: o.allDay, busy: o.busy })),
          ).toEqual(vector.expect)
          for (const o of occurrences) {
            expect(o.calendarId).toBe(MY_EVENTS_CALENDAR_ID)
            expect(o.planEventId).toBe('e')
            expect(o.tentative).toBe(false)
          }
        })
      }
    })

    describe('planEvents.choices', () => {
      for (const vector of planEvents.choices) {
        it(vector.day, () => {
          const choices = repeatChoices(vector.day)
          expect(choices.map((c) => ({ label: c.label, repeat: c.repeat }))).toEqual(vector.expect)
          for (const [index, choice] of choices.entries()) {
            // Each choice happens on the day it was offered for, and reads as its label.
            const event = eventOf({ title: 'x', start: vector.day, repeat: choice.repeat })
            expect(eventDaysBetween(event, vector.day, vector.day)).toEqual([vector.day])
            expect(choiceIndex(choices, choice.repeat)).toBe(index)
            if (choice.repeat.kind !== 'yearly') expect(repeatText(choice.repeat)).toBe(choice.label)
          }
        })
      }
    })

    describe('planEvents.choiceDays', () => {
      for (const vector of planEvents.choiceDays) {
        it(vector.name, () => {
          expect(repeatChoiceDay(eventOf(vector.event), vector.day, vector.scope)).toBe(vector.expect)
        })
      }
    })

    describe('planEvents.text', () => {
      for (const vector of planEvents.text) {
        it(vector.text, () => {
          expect(repeatText(readRepeat(vector.repeat) as EventRepeat)).toBe(vector.text)
        })
      }
    })

    describe('eventBusy', () => {
      const events = eventBusy.events.map(calendarEvent)
      const counts = calendarCounts(eventBusy.calendars.map((c) => ({ id: c.id, enabled: c.shown, countsAsBusy: c.countsAsBusy })))

      for (const vector of eventBusy.days) {
        it(vector.day, () => {
          const timed = timedEventsOn(events, vector.day)
            .map(({ event, startMinute, endMinute }) => ({ id: event.id, from: startMinute, to: endMinute }))
            .sort(byRange)
          expect(timed).toEqual(vector.timed)
          expect(allDayEventsOn(events, vector.day).map((event) => event.id)).toEqual(vector.allDay)
          const busy = eventBusyOfDay(events, vector.day, counts)
            .map(([from, to]) => [from, to])
            .sort((a, b) => a[0] - b[0] || a[1] - b[1])
          expect(busy).toEqual(vector.busy)
        })
      }

      it('free time and the next free slot count events and blocks once', () => {
        const { free } = eventBusy
        const busy: BusyRange[] = [
          ...free.blocks.map(([a, b]) => [clockMinutes(a), clockMinutes(b)] as const),
          ...eventBusyOfDay(events, free.day, counts),
        ]
        const now = local(free.now)
        expect(freeMinutes(now, free.day, free.hours, busy)).toBe(free.freeMinutes)
        for (const vector of free.nextFree) {
          const slot = nextFreeSlot(now, free.day, free.hours, vector.minutes, busy)
          expect(slot === null ? null : `${pad(Math.floor(slot / 60))}:${pad(slot % 60)}`).toBe(vector.expect)
        }
      })

      for (const vector of eventBusy.busyOnly) {
        it(`busy only: ${vector.name}`, () => {
          const event: CalendarEvent = { id: 'x', calendarId: 'work', start: '', end: '', allDay: false, tentative: false, ...vector.event }
          const shown = busyOnlyEvent(event)
          expect(shown.title).toBe(vector.expect.title)
          expect('location' in shown).toBe(false)
        })
      }
    })

    describe('eventChanges', () => {
      for (const vector of eventChanges.cases) {
        it(vector.name, () => {
          const event = eventOf(vector.entries[`${EVENT_KEY_PREFIX}${vector.id}`], vector.id)
          let writes: EventWrites
          if (vector.action === 'skip') writes = skipEventDay(event, vector.day)
          else if (vector.action === 'delete') writes = deleteEvent(event)
          else writes = changeEvent(event, vector.day, vector.edit ?? {}, vector.scope ?? 'all', vector.newId ?? 'new')
          expect(writes).toEqual(vector.expect)
          expect(undoEventWrites(writes, vector.entries)).toEqual(vector.undo)
          // What is written reads back as an Event.
          for (const value of Object.values(writes)) {
            if (value !== null) expect(readPlanEvent(value)).not.toBeNull()
          }
        })
      }
    })
  })
}

