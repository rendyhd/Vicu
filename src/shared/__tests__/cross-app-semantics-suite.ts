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
  isoWeekday,
  nextWeekDay,
  nextWeekStart,
  postponeDays,
  startOfWeek,
} from '../due-dates'
import { daysIntoWeek, readWeekStart } from '../week-start'
import {
  buildCustomListServerFilter,
  filterCustomList,
  hasCollaborationCondition,
  type CustomListContext,
  type CustomListFilterInput,
} from '../custom-list-filter'
import { computeStatus, type ReviewMetadata } from '../review-metadata'
import { compileRule, validateRule, type RuleTask } from '../custom-list-rule'
import { sortCustomListTasks } from '../custom-list-sort'
import { convertSavedFilter, type SavedFilterDto } from '../saved-filter-import'
import {
  activeLists,
  documentFromLists,
  dropDuplicateImports,
  mergeCustomListDocuments,
  normalizeWireList,
  type CustomListWire,
} from '../../main/custom-list-protocol'
import { evaluateServerFilter } from './server-filter-eval'

/**
 * Runs every vector of test-fixtures/cross-app-semantics-v1.json that the desktop app owns
 * (due dates, weeks, smart lists, custom lists, review) against the real helpers.
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
  /** The week start the vector runs with (section 2.1); Monday when absent. */
  weekStart?: string
  expect: string
}
interface WeekVector {
  today: string
  thisWeekEnd: string
  thisMonthEnd: string
  nextWeekStart: string
  /** The day "Next week" gives: the Monday in next week. */
  nextWeek: string
  weekStart?: string
}
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
  weekStart?: string
}
interface ActivityTask {
  id: number
  projectId: number
  due: string | null
  done: boolean
  assignees: number[]
  commentCount: number
  unread: boolean
  updated: string
}
interface ActivityVector extends CustomListVector { signedOut?: boolean }
interface ActivityBlock { me: number; shared: number[]; tasks: ActivityTask[]; vectors: ActivityVector[] }
interface SmartListVector { today: string; todayOverdue: number[]; todayToday: number[]; upcoming: number[] }
interface ReviewVector {
  name: string
  today: string
  defaultCadence: number
  meta: { state: ReviewMetadata['state']; lastReviewedAt?: string; cadenceDaysOverride?: number }
  expect: { isOverdue: boolean; daysSince: number | null; daysUntil: number | null; next: string | null }
}
interface RuleFixtureTask {
  id: number
  title: string
  description: string
  done: boolean
  doneAt: string | null
  priority: number
  percentDone: number
  projectId: number
  index: number
  hexColor: string
  repeatAfter: number
  due: string | null
  start: string | null
  end: string | null
  created: string
  updated: string
  labels: number[]
  assignees: string[]
  createdBy: string
  reminders: string[]
}
interface RuleBlock {
  tasks: RuleFixtureTask[]
  vectors: Array<{ name: string; now: string; rule: string; includeNulls: boolean; expect: number[]; weekStart?: string }>
  invalid: string[]
}
interface SortBlock {
  tasks: Array<{ id: number; title: string; done: boolean; priority: number; due: string | null; position: number }>
  vectors: Array<{ name: string; filter: { sort_by: string; order_by: string; then_by?: Array<{ sort_by: string; order_by: string }> }; expect: number[] }>
}
interface ImportBlock {
  filters: Array<{
    name: string
    savedFilter: SavedFilterDto
    list: { name: string; icon: string; savedFilterId: number; filter: Record<string, unknown> } | null
    status: string
    reasons: string[]
  }>
  duplicates: Array<{ name: string; lists: Array<{ id: string; savedFilterId?: number }>; kept: string[] }>
  union: Array<{ left: number[]; right: number[]; merged: number[] }>
}
interface Fixture {
  contractVersion: number
  customListRule: RuleBlock
  customListSort: SortBlock
  savedFilterImport: ImportBlock
  dueDates: { display: DisplayVector[]; setters: SetterVector[] }
  weeks: WeekVector[]
  tasks: FixtureTask[]
  smartLists: SmartListVector[]
  customLists: CustomListVector[]
  customListActivity: ActivityBlock
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
        const label = `${vector.action}${vector.days ? ` ${vector.days}d` : ''}${vector.date ? ` ${vector.date}` : ''} from ${vector.from ?? vector.reference}${vector.weekStart ? ` (weeks start on ${vector.weekStart})` : ''} -> ${vector.expect}`
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
              result = dueNextWeek(now, readWeekStart(vector.weekStart))
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
      it('has vectors for every week start', () => {
        expect(fixture.weeks.some((vector) => vector.weekStart === 'sunday')).toBe(true)
        expect(fixture.weeks.some((vector) => vector.weekStart === 'saturday')).toBe(true)
      })
      for (const vector of fixture.weeks) {
        const weekStart = readWeekStart(vector.weekStart)
        it(`week and month ends for ${vector.today}, weeks start on ${weekStart}`, () => {
          expect(endOfWeek(vector.today, weekStart)).toBe(vector.thisWeekEnd)
          expect(endOfMonth(vector.today)).toBe(vector.thisMonthEnd)
          expect(nextWeekStart(vector.today, weekStart)).toBe(vector.nextWeekStart)
          expect(nextWeekDay(vector.today, weekStart)).toBe(vector.nextWeek)
          expect(addLocalDays(vector.thisWeekEnd, 1)).toBe(vector.nextWeekStart)
          expect(daysIntoWeek(isoWeekday(startOfWeek(vector.today, weekStart)), weekStart)).toBe(0)
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
            const weekStart = readWeekStart(vector.weekStart)
            const context = { weekStart }

            expect(filterCustomList(tasks, vector.filter, now, context).map((task) => task.id)).toEqual(vector.expect)
            expect(filterCustomList(tasks, vector.filter, vector.today, context).map((task) => task.id)).toEqual(vector.expect)

            // The server filter is a superset: it never drops a task the list accepts.
            const serverFilter = buildCustomListServerFilter(vector.filter, now, weekStart)
            for (const task of filterCustomList(tasks, vector.filter, now, context)) {
              expect(evaluateServerFilter(serverFilter, task), `task ${task.id} vs ${serverFilter}`).toBe(true)
            }
          })
        }
      }
    })

    describe('customListActivity', () => {
      const block = fixture.customListActivity
      const asTask = (task: ActivityTask) => ({
        id: task.id,
        project_id: task.projectId,
        done: task.done,
        due_date: task.due === null ? '0001-01-01T00:00:00Z' : local(task.due).toISOString(),
        priority: 0,
        labels: [],
        assignees: task.assignees.map((id) => ({ id })),
        comment_count: task.commentCount,
        is_unread: task.unread,
        updated: local(task.updated).toISOString(),
      })

      it('has the activity vectors', () => {
        expect(block.vectors.length).toBeGreaterThanOrEqual(20)
      })

      for (const vector of block.vectors) {
        for (const clock of ['00:00:30', '10:00:00', '23:59:30']) {
          it(`${vector.name} at ${clock}`, () => {
            const now = local(`${vector.today}T${clock}`)
            const tasks = block.tasks.map(asTask)
            const context: CustomListContext = {
              me: vector.signedOut ? null : block.me,
              isShared: (projectId) => block.shared.includes(projectId),
            }

            expect(filterCustomList(tasks, vector.filter, now, context).map((task) => task.id)).toEqual(vector.expect)
            expect(filterCustomList(tasks, vector.filter, vector.today, context).map((task) => task.id)).toEqual(vector.expect)

            const serverFilter = buildCustomListServerFilter(vector.filter, now)
            const accepted = filterCustomList(tasks, vector.filter, now, context)
            for (const task of accepted) {
              expect(evaluateServerFilter(serverFilter, task), `task ${task.id} vs ${serverFilter}`).toBe(true)
            }
            // Without the client-only conditions, the server clause for "changed" is exact.
            if (!hasCollaborationCondition(vector.filter) && !vector.filter.project_ids && vector.filter.due_date_filter === 'all') {
              const fromServer = tasks.filter((task) => evaluateServerFilter(serverFilter, task)).map((task) => task.id)
              expect(fromServer, serverFilter).toEqual(vector.expect)
            }
          })
        }
      }
    })

    describe('customListRule (section 3.5)', () => {
      const iso = (value: string | null) => (value ? local(value).toISOString() : null)
      const ruleTasks = (): RuleTask[] => fixture.customListRule.tasks.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        done: t.done,
        done_at: iso(t.doneAt),
        priority: t.priority,
        percent_done: t.percentDone,
        project_id: t.projectId,
        index: t.index,
        hex_color: t.hexColor,
        repeat_after: t.repeatAfter,
        due_date: t.due ? local(t.due).toISOString() : '0001-01-01T00:00:00Z',
        start_date: iso(t.start),
        end_date: iso(t.end),
        created: iso(t.created),
        updated: iso(t.updated),
        labels: t.labels.map((id) => ({ id })),
        assignees: t.assignees.map((username) => ({ username })),
        created_by: { id: 1, username: t.createdBy },
        reminders: t.reminders.map((r) => ({ reminder: local(r).toISOString() })),
      }))
      for (const vector of fixture.customListRule.vectors) {
        it(vector.name, () => {
          expect(validateRule(vector.rule)).toBeNull()
          const weekStart = readWeekStart(vector.weekStart)
          const match = compileRule(vector.rule, vector.includeNulls, local(vector.now), weekStart)
          expect(ruleTasks().filter(match).map((task) => task.id), vector.rule).toEqual(vector.expect)
          const filter = { include_done: true, rule: vector.rule, rule_include_nulls: vector.includeNulls }
          const viaList = filterCustomList(ruleTasks() as unknown as Parameters<typeof filterCustomList>[0], filter, vector.now.slice(0, 10), { weekStart }, local(vector.now))
          expect(viaList.map((task) => task.id)).toEqual(vector.expect)
        })
      }
      for (const rule of fixture.customListRule.invalid) {
        it(`rejects "${rule}"`, () => {
          expect(validateRule(rule)).not.toBeNull()
          expect(ruleTasks().filter(compileRule(rule, false, local('2026-10-06T10:00:00')))).toEqual([])
        })
      }
    })

    describe('customListSort (section 3.6)', () => {
      for (const vector of fixture.customListSort.vectors) {
        it(vector.name, () => {
          const tasks = fixture.customListSort.tasks.map((t) => ({
            id: t.id,
            title: t.title,
            done: t.done,
            priority: t.priority,
            position: t.position,
            due_date: t.due ? local(t.due).toISOString() : '0001-01-01T00:00:00Z',
          }))
          const { sort_by: sortBy, order_by: orderBy, then_by: thenBy } = vector.filter
          expect(sortCustomListTasks(tasks, sortBy, orderBy, thenBy ?? []).map((task) => task.id)).toEqual(vector.expect)
        })
      }
    })

    describe('savedFilterImport (section 3.7)', () => {
      const defaults = normalizeWireList({ id: 'new', name: 'x', icon: '', filter: {} } as unknown as CustomListWire).filter
      for (const vector of fixture.savedFilterImport.filters) {
        it(vector.name, () => {
          const result = convertSavedFilter(vector.savedFilter, 'new')
          expect(result.status).toBe(vector.status)
          expect(result.reasons).toEqual(vector.reasons)
          if (vector.list === null) {
            expect(result.list).toBeNull()
            return
          }
          expect(result.list?.name).toBe(vector.list.name)
          expect(result.list?.icon).toBe(vector.list.icon)
          expect(result.list?.saved_filter_id).toBe(vector.list.savedFilterId)
          const made = normalizeWireList({ id: 'new', name: 'x', icon: '', filter: { ...result.list?.filter } } as unknown as CustomListWire).filter
          const want = normalizeWireList({ id: 'new', name: 'x', icon: '', filter: { ...defaults, ...vector.list.filter } } as unknown as CustomListWire).filter
          expect(made).toEqual(want)
        })
      }
      for (const vector of fixture.savedFilterImport.duplicates) {
        it(vector.name, () => {
          const lists = vector.lists.map((list) => ({
            id: list.id,
            name: list.id,
            icon: '',
            filter: { ...defaults },
            ...(list.savedFilterId !== undefined ? { saved_filter_id: list.savedFilterId } : {}),
          }) as CustomListWire)
          const document = documentFromLists(lists, 'device', 1000)
          expect(activeLists(document).map((list) => list.id)).toEqual(vector.kept)
          const cleaned = dropDuplicateImports(document, 'device', 2000)
          for (const id of vector.lists.map((list) => list.id).filter((id) => !vector.kept.includes(id))) {
            expect(cleaned.lists[id].value).toBeNull()
          }
        })
      }
      for (const vector of fixture.savedFilterImport.union) {
        it(`union of ${vector.left} and ${vector.right}`, () => {
          const revision = { wall_time_ms: 1, counter: 0, device_id: 'd' }
          const doc = (ids: number[]) => ({
            version: 1 as const,
            lists: {},
            order: { ids: [], revision },
            ...(ids.length ? { imported_saved_filters: ids } : {}),
          })
          expect(mergeCustomListDocuments(doc(vector.left), doc(vector.right)).imported_saved_filters).toEqual(vector.merged)
        })
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
