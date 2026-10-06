import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  addLocalDays,
  dateOnlyDue,
  dueNextWeek,
  dueToday,
  dueTomorrow,
  endOfMonth,
  endOfWeek,
  isDateOnly,
  isDueToday,
  isOverdue,
  isUpcoming,
  nextWeekStart,
  postponeDays,
} from '../due-dates'
import { buildCustomListServerFilter, filterCustomList, type CustomListFilterInput } from '../custom-list-filter'
import { computeStatus, type ReviewMetadata } from '../../renderer/lib/review-metadata'
import { evaluateServerFilter } from './server-filter-eval'

/**
 * Runs every vector of test-fixtures/cross-app-semantics-v1.json that the desktop app owns
 * (due dates, weeks, smart lists, review) against the real helpers.
 *
 * The fixture writes times as local wall-clock times without an offset, so every test below
 * converts them with `new Date(y, m - 1, d, h, mi, s)` in the process time zone. The zone
 * wrappers (cross-app-semantics*.test.ts) set `process.env.TZ` before calling this, and pass
 * the offset they expect so a silently ignored TZ cannot turn the suite into a no-op.
 *
 * Nothing here may build a Date at module scope: the zone is switched after this file loads.
 */

interface DisplayVector { local: string; dateOnly: boolean }
interface SetterVector {
  reference: string
  action: 'today' | 'tomorrow' | 'nextWeek' | 'pickDate' | 'bang' | 'postponeDays'
  date?: string
  days?: number
  from?: string
  expect: string
}
interface WeekVector { today: string; thisWeekEnd: string; thisMonthEnd: string; nextWeekStart: string }
interface FixtureTask {
  id: number
  projectId: number
  due: string | null
  done: boolean
  priority: number
  labelIds: number[]
}
interface CustomListVector {
  name: string
  today: string
  filter: CustomListFilterInput
  expect: number[]
}
interface SmartListVector { today: string; todayOverdue: number[]; todayToday: number[]; upcoming: number[] }
interface ReviewVector {
  name: string
  today: string
  defaultCadence: number
  meta: { state: ReviewMetadata['state']; lastReviewedAt?: string; cadenceDaysOverride?: number }
  expect: { isOverdue: boolean; daysSince: number | null; daysUntil: number | null; next: string | null }
}
interface Fixture {
  contractVersion: number
  dueDates: { display: DisplayVector[]; setters: SetterVector[] }
  weeks: WeekVector[]
  tasks: FixtureTask[]
  smartLists: SmartListVector[]
  customLists: CustomListVector[]
  review: ReviewVector[]
}

function loadFixture(): Fixture {
  return JSON.parse(
    readFileSync(join(process.cwd(), 'test-fixtures', 'cross-app-semantics-v1.json'), 'utf8'),
  ) as Fixture
}

/** `2026-10-06T10:00:00` (or a bare `2026-10-06`) as a Date in the process time zone. */
function local(value: string): Date {
  const [datePart, timePart = '00:00:00'] = value.split('T')
  const [y, m, d] = datePart.split('-').map(Number)
  const [h, mi, s] = timePart.split(':').map(Number)
  return new Date(y, m - 1, d, h, mi, s)
}

const pad = (n: number) => String(n).padStart(2, '0')

/** An instant back to `YYYY-MM-DDTHH:mm:ss` local wall-clock time. */
function wall(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export function runCrossAppSemanticsSuite(options: { zone: string; expectedOffsetMinutesInOctober?: number }): void {
  const fixture = loadFixture()

  describe(`cross-app semantics v1 in ${options.zone}`, () => {
    it('is running in the requested time zone', () => {
      expect(fixture.contractVersion).toBe(1)
      if (options.expectedOffsetMinutesInOctober !== undefined) {
        expect(new Date(2026, 9, 6).getTimezoneOffset()).toBe(options.expectedOffsetMinutesInOctober)
      }
    })

    describe('dueDates.display', () => {
      for (const vector of fixture.dueDates.display) {
        it(`${vector.local} is ${vector.dateOnly ? 'date-only' : 'an explicit time'}`, () => {
          expect(isDateOnly(local(vector.local).toISOString())).toBe(vector.dateOnly)
        })
      }
    })

    describe('dueDates.setters', () => {
      for (const vector of fixture.dueDates.setters) {
        const label = `${vector.action}${vector.days ? ` ${vector.days}d` : ''}${vector.date ? ` ${vector.date}` : ''} from ${vector.from ?? vector.reference} -> ${vector.expect}`
        it(label, () => {
          const now = local(vector.reference)
          let result: string
          switch (vector.action) {
            case 'today':
            case 'bang':
              result = dueToday(now)
              break
            case 'tomorrow':
              result = dueTomorrow(now)
              break
            case 'nextWeek':
              result = dueNextWeek(now)
              break
            case 'pickDate':
              result = dateOnlyDue(vector.date!)
              break
            case 'postponeDays':
              result = postponeDays(local(vector.from!).toISOString(), vector.days!, now)
              break
          }
          expect(wall(result)).toBe(vector.expect)
        })
      }
    })

    describe('weeks', () => {
      for (const vector of fixture.weeks) {
        it(`week and month ends for ${vector.today}`, () => {
          expect(endOfWeek(vector.today)).toBe(vector.thisWeekEnd)
          expect(endOfMonth(vector.today)).toBe(vector.thisMonthEnd)
          expect(nextWeekStart(vector.today)).toBe(vector.nextWeekStart)
          expect(addLocalDays(vector.thisWeekEnd, 1)).toBe(vector.nextWeekStart)
        })
      }
    })

    describe('smartLists', () => {
      const open = () => fixture.tasks.filter((task) => !task.done && task.due !== null)
      const dueIso = (task: FixtureTask) => local(task.due!).toISOString()

      for (const vector of fixture.smartLists) {
        // The result must not depend on the time of day "now" is read at.
        for (const clock of ['00:00:30', '10:00:00', '23:59:30']) {
          const now = () => local(`${vector.today}T${clock}`)

          it(`Today list for ${vector.today} at ${clock}`, () => {
            const overdue = open().filter((task) => isOverdue(dueIso(task), now())).map((task) => task.id)
            const today = open().filter((task) => isDueToday(dueIso(task), now())).map((task) => task.id)
            expect(overdue).toEqual(vector.todayOverdue)
            expect(today).toEqual(vector.todayToday)
          })

          it(`Upcoming list for ${vector.today} at ${clock}`, () => {
            const upcoming = open().filter((task) => isUpcoming(dueIso(task), now())).map((task) => task.id)
            expect(upcoming).toEqual(vector.upcoming)
          })
        }
      }
    })

    describe('customLists', () => {
      // The Vikunja shape of a fixture task, as the evaluator and the server filter see it.
      const asTask = (task: FixtureTask) => ({
        id: task.id,
        project_id: task.projectId,
        done: task.done,
        due_date: task.due === null ? '0001-01-01T00:00:00Z' : local(task.due).toISOString(),
        priority: task.priority,
        labels: task.labelIds.map((id) => ({ id })),
      })

      for (const vector of fixture.customLists) {
        // The result must not depend on the time of day "now" is read at, or on whether
        // the caller passes the local date or an instant.
        for (const clock of ['00:00:30', '10:00:00', '23:59:30']) {
          it(`${vector.name} at ${clock}`, () => {
            const now = local(`${vector.today}T${clock}`)
            const tasks = fixture.tasks.map(asTask)

            expect(filterCustomList(tasks, vector.filter, now).map((task) => task.id)).toEqual(vector.expect)
            expect(filterCustomList(tasks, vector.filter, vector.today).map((task) => task.id)).toEqual(vector.expect)

            // The server filter is a superset: it never drops a task the list accepts.
            const serverFilter = buildCustomListServerFilter(vector.filter, now)
            for (const task of filterCustomList(tasks, vector.filter, now)) {
              expect(evaluateServerFilter(serverFilter, task), `task ${task.id} vs ${serverFilter}`).toBe(true)
            }
          })
        }
      }
    })

    describe('review', () => {
      for (const vector of fixture.review) {
        for (const clock of ['00:30:00', '12:00:00', '23:30:00']) {
          it(`${vector.name} at ${clock}`, () => {
            const meta: ReviewMetadata = {
              state: vector.meta.state,
              lastReviewedAt: vector.meta.lastReviewedAt ?? null,
              cadenceDaysOverride: vector.meta.cadenceDaysOverride ?? null,
            }
            const status = computeStatus(meta, vector.defaultCadence, local(`${vector.today}T${clock}`))
            expect(status.isOverdue).toBe(vector.expect.isOverdue)
            expect(status.daysSinceReviewed).toBe(vector.expect.daysSince)
            expect(status.daysUntilDue).toBe(vector.expect.daysUntil)
            expect(status.nextReviewAt).toBe(vector.expect.next)
          })
        }
      }
    })
  })
}
