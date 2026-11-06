import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { formatBlockRow, type DateFormat } from '../date-display'
import { buildDefaultReminder, withDefaultReminder } from '../default-reminder'
import { isUpcoming, toLocalDate } from '../due-dates'
import {
  DEFAULT_LENGTH_MINUTES,
  DEFAULT_PLANNER_HOURS,
  MAX_BLOCK_MINUTES,
  blockChangesForDue,
  blockOf,
  clockMinutes,
  clockText,
  fitTasks,
  freeMinutes,
  isTimeBlock,
  nextFreeSlot,
  placeBlock,
  readDefaultLength,
  readPlannerHours,
  removeTime,
  remindersWithoutBlock,
  splitToday,
  withDueChangeRules,
  type BlockChanges,
  type BusyRange,
  type PlannerHours,
} from '../time-blocks'

/**
 * The `timeBlocks` vectors of test-fixtures/cross-app-semantics-v1.json (contract section 16). Times
 * are local wall-clock times, converted in the process time zone; the zone wrappers
 * (time-blocks*.test.ts) set `process.env.TZ` first. Vicu mobile runs the same block
 * (`TimeBlocksFixtureTest`). Nothing here may build a Date at module scope.
 */

type Clock = string
interface TodayTask {
  id: number
  due: string | null
  start: string | null
  end: string | null
  done: boolean
}
interface Vectors {
  defaultLengthMinutes: number
  maxBlockMinutes: number
  defaultHours: PlannerHours
  isBlock: Array<{ name: string; start: string | null; end: string | null; block: boolean; day?: string; minutes?: number }>
  placing: Array<{ name: string; due: string | null; start: string; minutes: number; expectDue: string; expectEnd: string }>
  dueChange: Array<{
    name: string
    today: string
    oldDue: string | null
    start: string
    end: string
    newDue: string | null
    expectStart: string | null
    expectEnd: string | null
  }>
  removeTime: Array<{ name: string; reminders: Array<Record<string, unknown>>; expect: Array<Record<string, unknown>> }>
  today: { now: string; tasks: TodayTask[]; overdue: number[]; todaySection: number[]; upcoming: number[] }
  defaultReminder: Array<{
    name: string
    offset: number
    relativeTo: 'due_date' | 'start_date' | 'end_date'
    due: string | null
    start: string | null
    end: string | null
    expect: { reminder: string; relative_period: number; relative_to: string } | null
  }>
  nextFree: Array<{ name: string; now: string; day: string; hours: PlannerHours; minutes: number; busy: [Clock, Clock][]; expect: string | null }>
  freeMinutes: Array<{ name: string; now: string; day: string; hours: PlannerHours; busy: [Clock, Clock][]; expect: number }>
  fit: Array<{
    name: string
    now: string
    day: string
    hours: PlannerHours
    minutes: number
    busy: [Clock, Clock][]
    tasks: Array<{ id: number; due: string | null; priority: number }>
    expect: Array<{ id: number; start: string; end: string }>
  }>
  display: Array<{ name: string; now: string; start: string; end: string; locale: string; hour12: boolean; text: string }>
  prefs: { defaultLength: Array<{ value: unknown; expect: number }>; hours: Array<{ value: unknown; expect: PlannerHours }> }
}

function loadVectors(): Vectors {
  return (JSON.parse(readFileSync(join(process.cwd(), 'test-fixtures', 'cross-app-semantics-v1.json'), 'utf8')) as { timeBlocks: Vectors }).timeBlocks
}

/** `2026-10-06T10:00:00` as a Date in the process time zone. */
function local(value: string): Date {
  const [datePart, timePart = '00:00:00'] = value.split('T')
  const [y, m, d] = datePart.split('-').map(Number)
  const [h, mi, s = 0] = timePart.split(':').map(Number)
  return new Date(y, m - 1, d, h, mi, s)
}

const iso = (value: string | null): string | null => (value ? local(value).toISOString() : null)
const pad = (n: number) => String(n).padStart(2, '0')
const wall = (value: string | null | undefined): string | null => {
  if (!value) return null
  const d = new Date(value)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
const busyOf = (busy: [Clock, Clock][]): BusyRange[] => busy.map(([a, b]) => [clockMinutes(a), clockMinutes(b)])

export function runTimeBlocksSuite(options: { zone: string; expectedOffsetMinutesInOctober?: number }): void {
  const vectors = loadVectors()

  describe(`time blocks in ${options.zone}`, () => {
    it('is running in the requested time zone', () => {
      expect(MAX_BLOCK_MINUTES).toBe(vectors.maxBlockMinutes)
      expect(DEFAULT_LENGTH_MINUTES).toBe(vectors.defaultLengthMinutes)
      expect(DEFAULT_PLANNER_HOURS).toEqual(vectors.defaultHours)
      if (options.expectedOffsetMinutesInOctober !== undefined) {
        expect(new Date(2026, 9, 6).getTimezoneOffset()).toBe(options.expectedOffsetMinutesInOctober)
      }
    })

    describe('isBlock', () => {
      for (const vector of vectors.isBlock) {
        it(vector.name, () => {
          expect(isTimeBlock(iso(vector.start), iso(vector.end))).toBe(vector.block)
          const block = blockOf({ start_date: iso(vector.start), end_date: iso(vector.end) })
          expect(block !== null).toBe(vector.block)
          if (block && vector.day) expect(block.day).toBe(vector.day)
          if (block && vector.minutes !== undefined) expect(block.minutes).toBe(vector.minutes)
        })
      }
    })

    describe('placing', () => {
      for (const vector of vectors.placing) {
        it(vector.name, () => {
          const changes = placeBlock(iso(vector.due), local(vector.start), vector.minutes)
          expect(wall(changes.due_date)).toBe(vector.expectDue)
          expect(wall(changes.start_date)).toBe(vector.start)
          expect(wall(changes.end_date)).toBe(vector.expectEnd)
        })
      }
    })

    describe('dueChange', () => {
      for (const vector of vectors.dueChange) {
        it(vector.name, () => {
          const now = local(`${vector.today}T10:00:00`)
          const task = { due_date: iso(vector.oldDue), start_date: iso(vector.start), end_date: iso(vector.end) }
          const changes: BlockChanges = withDueChangeRules(task, { due_date: iso(vector.newDue) }, now)
          const start = changes.start_date === undefined ? task.start_date : changes.start_date
          const end = changes.end_date === undefined ? task.end_date : changes.end_date
          expect(wall(start)).toBe(vector.expectStart)
          expect(wall(end)).toBe(vector.expectEnd)
        })
      }

      it('a change that writes the block itself is left alone', () => {
        const now = local('2026-10-06T10:00:00')
        const task = { due_date: iso('2026-10-06T23:59:59'), start_date: iso('2026-10-06T15:00:00'), end_date: iso('2026-10-06T15:30:00') }
        const changes = { due_date: iso('2026-10-08T23:59:59'), start_date: iso('2026-10-08T09:00:00'), end_date: iso('2026-10-08T09:30:00') }
        expect(withDueChangeRules(task, changes, now)).toEqual(changes)
      })

      it('removing the time because of the due date also takes the reminders on the block', () => {
        const now = local('2026-10-06T10:00:00')
        const task = {
          due_date: iso('2026-10-06T23:59:59'),
          start_date: iso('2026-10-06T15:00:00'),
          end_date: iso('2026-10-06T15:30:00'),
          reminders: [{ relative_to: 'start_date', relative_period: -3600 }, { reminder: 'x' }],
        }
        expect(blockChangesForDue(task, null, now)).toEqual({ start_date: null, end_date: null, reminders: [{ reminder: 'x' }] })
      })
    })

    describe('removeTime', () => {
      for (const vector of vectors.removeTime) {
        it(vector.name, () => {
          expect(remindersWithoutBlock(vector.reminders)).toEqual(vector.expect)
          const changes = removeTime({ reminders: vector.reminders })
          expect(changes.start_date).toBeNull()
          expect(changes.end_date).toBeNull()
          if (vector.expect.length !== vector.reminders.length) expect(changes.reminders).toEqual(vector.expect)
          else expect(changes.reminders).toBeUndefined()
        })
      }
    })

    describe('today', () => {
      const build = () => {
        const { today } = vectors
        const now = local(today.now)
        const tasks = today.tasks.map((t) => ({
          id: t.id,
          done: t.done,
          due_date: iso(t.due),
          start_date: iso(t.start),
          end_date: iso(t.end),
        }))
        return { now, tasks, expected: today }
      }

      it('splits Overdue and the Today section', () => {
        const { now, tasks, expected } = build()
        const split = splitToday(tasks.filter((t) => !t.done), now)
        expect(split.overdue.map((t) => t.id)).toEqual(expected.overdue)
        expect(split.today.map((t) => t.id)).toEqual(expected.todaySection)
      })

      it('Upcoming reads the due date only', () => {
        const { now, tasks, expected } = build()
        expect(tasks.filter((t) => !t.done && isUpcoming(t.due_date, now)).map((t) => t.id)).toEqual(expected.upcoming)
      })
    })

    describe('defaultReminder', () => {
      for (const vector of vectors.defaultReminder) {
        const expected = () => vector.expect && { ...vector.expect, reminder: iso(vector.expect.reminder) }

        it(vector.name, () => {
          const start = iso(vector.start)
          const end = iso(vector.end)
          const block = start && end && isTimeBlock(start, end) ? { start, end } : null
          expect(buildDefaultReminder(iso(vector.due), vector.offset, vector.relativeTo, block)).toEqual(expected())
        })

        it(`${vector.name}, on a new task`, () => {
          const value = expected()
          const payload = withDefaultReminder(
            { title: 'x', due_date: iso(vector.due) ?? undefined, start_date: iso(vector.start) ?? undefined, end_date: iso(vector.end) ?? undefined },
            { notifications_default_reminder_offset: vector.offset, notifications_default_reminder_relative_to: vector.relativeTo },
          ) as { reminders?: unknown[] }
          expect(payload.reminders ?? null).toEqual(value ? [value] : null)
        })
      }
    })

    describe('nextFree', () => {
      for (const vector of vectors.nextFree) {
        it(vector.name, () => {
          const slot = nextFreeSlot(local(vector.now), vector.day, vector.hours, vector.minutes, busyOf(vector.busy))
          expect(slot === null ? null : clockText(slot)).toBe(vector.expect)
        })
      }
    })

    describe('freeMinutes', () => {
      for (const vector of vectors.freeMinutes) {
        it(vector.name, () => {
          expect(freeMinutes(local(vector.now), vector.day, vector.hours, busyOf(vector.busy))).toBe(vector.expect)
        })
      }
    })

    describe('fit', () => {
      for (const vector of vectors.fit) {
        it(vector.name, () => {
          const fitted = fitTasks(
            vector.tasks.map((t) => ({ id: t.id, priority: t.priority, due_date: iso(t.due) })),
            {
              now: local(vector.now),
              day: vector.day,
              hours: vector.hours,
              busy: busyOf(vector.busy),
              lengthOf: () => vector.minutes,
            },
          )
          expect(fitted.map((f) => ({ id: f.task.id, start: clockText(f.start), end: clockText(f.end) }))).toEqual(vector.expect)
        })
      }
    })

    describe('display', () => {
      for (const vector of vectors.display) {
        it(vector.name, () => {
          const fmt: DateFormat = { locale: vector.locale, hour12: vector.hour12 } as DateFormat
          expect(formatBlockRow(local(vector.start), local(vector.end), local(vector.now), fmt)).toBe(vector.text)
        })
      }
    })

    describe('prefs', () => {
      for (const { value, expect: want } of vectors.prefs.defaultLength) {
        it(`default length ${JSON.stringify(value)}`, () => {
          expect(readDefaultLength(value)).toBe(want)
        })
      }
      for (const { value, expect: want } of vectors.prefs.hours) {
        it(`hours ${JSON.stringify(value)}`, () => {
          expect(readPlannerHours(value)).toEqual(want)
        })
      }
    })

    it('a block day is its local date', () => {
      expect(toLocalDate(local('2026-10-06T23:30:00'))).toBe('2026-10-06')
    })
  })
}
