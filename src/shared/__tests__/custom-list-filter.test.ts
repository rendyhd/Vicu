import { afterEach, describe, expect, it } from 'vitest'
import {
  buildCustomListServerFilter,
  filterCustomList,
  inDateWindow,
  matchesCustomList,
  windowHonorsIncludeOverdue,
  type CustomListFilterInput,
  type CustomListTask,
} from '../custom-list-filter'
import { compileServerFilter, type ServerFilterTask } from './server-filter-eval'

// The fixture-driven vectors live in cross-app-semantics-suite.ts. This file covers the pieces
// the vectors don't: odd inputs, the server filter strings, and the superset property.

const originalTz = process.env.TZ
afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ
  else process.env.TZ = originalTz
})

const NULL_DATE = '0001-01-01T00:00:00Z'
const TODAY = '2026-10-06' // a Tuesday

function task(overrides: Partial<CustomListTask> & { due?: string | null }): CustomListTask {
  const { due, ...rest } = overrides
  return {
    project_id: 10,
    done: false,
    due_date: due === undefined || due === null ? NULL_DATE : new Date(due).toISOString(),
    priority: 0,
    labels: [],
    ...rest,
  }
}

describe('inDateWindow', () => {
  it('treats an unknown or missing window as no date condition', () => {
    expect(inDateWindow('2026-10-01', undefined, true, TODAY)).toBe(true)
    expect(inDateWindow('', 'someday', true, TODAY)).toBe(true)
  })

  it('ignores include_overdue for overdue, has_due_date, no_due_date and all', () => {
    for (const includeOverdue of [true, false]) {
      expect(inDateWindow('2026-10-01', 'overdue', includeOverdue, TODAY)).toBe(true)
      expect(inDateWindow('2026-10-06', 'overdue', includeOverdue, TODAY)).toBe(false)
      expect(inDateWindow('2026-10-01', 'has_due_date', includeOverdue, TODAY)).toBe(true)
      expect(inDateWindow('', 'has_due_date', includeOverdue, TODAY)).toBe(false)
      expect(inDateWindow('', 'no_due_date', includeOverdue, TODAY)).toBe(true)
      expect(inDateWindow('2026-10-01', 'no_due_date', includeOverdue, TODAY)).toBe(false)
      expect(inDateWindow('', 'all', includeOverdue, TODAY)).toBe(true)
    }
  })

  it('never puts a task without a due date in today, this week or this month', () => {
    for (const window of ['today', 'this_week', 'this_month']) {
      expect(inDateWindow('', window, true, TODAY)).toBe(false)
      expect(inDateWindow('', window, false, TODAY)).toBe(false)
    }
  })

  it('ends this week on Sunday, and on a Sunday it is today only', () => {
    expect(inDateWindow('2026-10-11', 'this_week', false, TODAY)).toBe(true)
    expect(inDateWindow('2026-10-12', 'this_week', false, TODAY)).toBe(false)
    expect(inDateWindow('2026-10-11', 'this_week', false, '2026-10-11')).toBe(true)
    expect(inDateWindow('2026-10-12', 'this_week', false, '2026-10-11')).toBe(false)
  })

  it('says which windows the include overdue option applies to', () => {
    expect(['today', 'this_week', 'this_month'].every(windowHonorsIncludeOverdue)).toBe(true)
    expect(['all', 'overdue', 'has_due_date', 'no_due_date', 'whatever', undefined].some(windowHonorsIncludeOverdue)).toBe(false)
  })
})

describe('matchesCustomList', () => {
  it('reads the local date of an instant, not its UTC date', () => {
    process.env.TZ = 'America/New_York'
    // 2026-10-06 21:00 in New York is already 2026-10-07 in UTC.
    const evening = new Date(2026, 9, 6, 21, 0)
    const dueTonight = task({ due: new Date(2026, 9, 6, 20, 0).toISOString() })
    expect(matchesCustomList(dueTonight, { due_date_filter: 'today', include_overdue: false }, evening)).toBe(true)
    expect(matchesCustomList(dueTonight, { due_date_filter: 'today', include_overdue: false }, TODAY)).toBe(true)
    expect(matchesCustomList(dueTonight, { due_date_filter: 'overdue' }, evening)).toBe(false)
  })

  it('treats a missing priority as 0 and missing labels as none', () => {
    const bare: CustomListTask = { project_id: 10 }
    expect(matchesCustomList(bare, { priority_filter: [0] }, TODAY)).toBe(true)
    expect(matchesCustomList(bare, { priority_filter: [3] }, TODAY)).toBe(false)
    expect(matchesCustomList(bare, { label_ids: [7] }, TODAY)).toBe(false)
    expect(matchesCustomList({ ...bare, labels: null }, { label_ids: [7] }, TODAY)).toBe(false)
  })

  it('keeps tasks with any of the labels', () => {
    const labelled = task({ labels: [{ id: 5 }, { id: 7 }] })
    expect(matchesCustomList(labelled, { label_ids: [7, 99] }, TODAY)).toBe(true)
    expect(matchesCustomList(labelled, { label_ids: [99] }, TODAY)).toBe(false)
  })

  it('does not apply conditions that are empty', () => {
    expect(matchesCustomList(task({}), { project_ids: [], priority_filter: [], label_ids: [] }, TODAY)).toBe(true)
    expect(matchesCustomList(task({}), { project_ids: null, priority_filter: null, label_ids: null }, TODAY)).toBe(true)
  })

  it('ignores include_today_all_projects without projects', () => {
    const elsewhere = task({ project_id: 99, due: '2026-10-20T23:59:59' })
    expect(matchesCustomList(elsewhere, { due_date_filter: 'all', include_today_all_projects: true }, TODAY)).toBe(true)
    expect(matchesCustomList(elsewhere, { due_date_filter: 'all', project_ids: [10] }, TODAY)).toBe(false)
  })

  it('still applies the date window to tasks the union brought in', () => {
    // Due today in another project passes the project condition, but not a window that excludes it.
    const dueToday = task({ project_id: 99, due: '2026-10-06T23:59:59' })
    const filter: CustomListFilterInput = {
      due_date_filter: 'no_due_date',
      project_ids: [10],
      include_today_all_projects: true,
    }
    expect(matchesCustomList(dueToday, filter, TODAY)).toBe(false)
  })

  it('brings excluded-project tasks due today back when the union is on', () => {
    const excludedToday = task({ project_id: 10, due: '2026-10-06T08:00:00' })
    const excludedLater = task({ project_id: 10, due: '2026-10-09T23:59:59' })
    const filter: CustomListFilterInput = {
      due_date_filter: 'all',
      project_ids: [10],
      project_filter_mode: 'exclude',
      include_today_all_projects: true,
    }
    expect(matchesCustomList(excludedToday, filter, TODAY)).toBe(true)
    expect(matchesCustomList(excludedLater, filter, TODAY)).toBe(false)
  })

  it('honors include_overdue in the union leg', () => {
    const overdueElsewhere = task({ project_id: 99, due: '2026-10-01T23:59:59' })
    const filter: CustomListFilterInput = { due_date_filter: 'all', project_ids: [10], include_today_all_projects: true }
    expect(matchesCustomList(overdueElsewhere, filter, TODAY)).toBe(true)
    expect(matchesCustomList(overdueElsewhere, { ...filter, include_overdue: false }, TODAY)).toBe(false)
  })

  it('returns the matching tasks in their original order', () => {
    const tasks = [task({ priority: 4 }), task({ priority: 1 }), task({ priority: 3 })]
    expect(filterCustomList(tasks, { priority_filter: [3, 4] }, TODAY)).toEqual([tasks[0], tasks[2]])
  })
})

describe('buildCustomListServerFilter', () => {
  // Tue 2026-10-06 21:00 in New York (Wed 2026-10-07 01:00 UTC); EDT is UTC-4 until Nov 1.
  const eveningInNewYork = () => new Date(2026, 9, 6, 21, 0)
  const nullClause = `due_date != '${NULL_DATE}'`

  it('has nothing to say about an open-ended list that includes done tasks', () => {
    expect(buildCustomListServerFilter({ include_done: true, due_date_filter: 'all' })).toBeUndefined()
  })

  it('only asks for open tasks unless the list includes done ones', () => {
    expect(buildCustomListServerFilter({ due_date_filter: 'all' })).toBe('done = false')
    expect(buildCustomListServerFilter({ due_date_filter: 'has_due_date', include_done: true })).toBe(nullClause)
  })

  it('bounds the today window by the start of local tomorrow, not 23:59:59 today', () => {
    process.env.TZ = 'America/New_York'
    expect(buildCustomListServerFilter({ due_date_filter: 'today' }, eveningInNewYork())).toBe(
      `done = false && due_date < '2026-10-07T04:00:00.000Z' && ${nullClause}`,
    )
  })

  it('bounds this week by the start of the day after Sunday', () => {
    process.env.TZ = 'America/New_York'
    // Sunday 2026-10-11 ends at the start of Monday 2026-10-12, 04:00Z.
    expect(buildCustomListServerFilter({ due_date_filter: 'this_week' }, eveningInNewYork())).toBe(
      `done = false && due_date < '2026-10-12T04:00:00.000Z' && ${nullClause}`,
    )
  })

  it('bounds this month by the start of the next month, across a DST change', () => {
    process.env.TZ = 'America/New_York'
    // The clocks go back on Nov 1: the start of Nov 1 is still UTC-4.
    expect(buildCustomListServerFilter({ due_date_filter: 'this_month' }, eveningInNewYork())).toBe(
      `done = false && due_date < '2026-11-01T04:00:00.000Z' && ${nullClause}`,
    )
  })

  it('adds a lower bound when overdue tasks are left out', () => {
    process.env.TZ = 'America/New_York'
    expect(buildCustomListServerFilter({ due_date_filter: 'today', include_overdue: false }, eveningInNewYork())).toBe(
      "done = false && due_date >= '2026-10-06T04:00:00.000Z' && due_date < '2026-10-07T04:00:00.000Z'",
    )
  })

  it('ends the overdue window at the start of local today', () => {
    process.env.TZ = 'America/New_York'
    expect(buildCustomListServerFilter({ due_date_filter: 'overdue', include_overdue: false }, eveningInNewYork())).toBe(
      `done = false && due_date < '2026-10-06T04:00:00.000Z' && ${nullClause}`,
    )
  })

  it('follows the local date in a zone ahead of UTC', () => {
    process.env.TZ = 'Pacific/Auckland'
    // Tue 2026-10-06 00:30 in Auckland is still Mon 2026-10-05 in UTC; tomorrow starts 2026-10-06 11:00Z.
    expect(buildCustomListServerFilter({ due_date_filter: 'today' }, new Date(2026, 9, 6, 0, 30))).toContain(
      "due_date < '2026-10-06T11:00:00.000Z'",
    )
  })

  it('asks for the null date explicitly for no_due_date', () => {
    expect(buildCustomListServerFilter({ due_date_filter: 'no_due_date' })).toBe(`done = false && due_date = '${NULL_DATE}'`)
  })

  it('adds the project for include mode only', () => {
    expect(buildCustomListServerFilter({ project_ids: [10], due_date_filter: 'all' })).toBe('done = false && project_id = 10')
    expect(buildCustomListServerFilter({ project_ids: [10, 11], due_date_filter: 'all' })).toBe(
      'done = false && (project_id = 10 || project_id = 11)',
    )
    expect(buildCustomListServerFilter({ project_ids: [10], project_filter_mode: 'exclude', due_date_filter: 'all' })).toBe('done = false')
  })

  it('widens the project clause with the today window for "today from all projects"', () => {
    process.env.TZ = 'America/New_York'
    expect(buildCustomListServerFilter(
      { project_ids: [10], include_today_all_projects: true, include_overdue: false, due_date_filter: 'all' },
      eveningInNewYork(),
    )).toBe(
      "done = false && (project_id = 10 || (due_date >= '2026-10-06T04:00:00.000Z' && due_date < '2026-10-07T04:00:00.000Z'))",
    )
  })
})

// --- The superset property --------------------------------------------------------------

const WINDOWS = ['all', 'overdue', 'today', 'this_week', 'this_month', 'has_due_date', 'no_due_date', 'a-future-window']
const OVERDUE_FLAGS: Array<boolean | undefined> = [undefined, true, false]
const PROJECT_SETUPS: Array<Pick<CustomListFilterInput, 'project_ids' | 'project_filter_mode'>> = [
  {},
  { project_ids: [10] },
  { project_ids: [10, 11] },
  { project_ids: [10], project_filter_mode: 'exclude' },
]

/** Reference days chosen around weekends, month ends and the November DST change. */
const REFERENCE_DAYS = ['2026-10-06T10:00:00', '2026-10-11T23:59:30', '2026-10-31T22:00:00', '2026-11-01T12:00:00', '2026-12-31T08:00:00']

/** Days around today, the week end, the month end and the previous month. */
const DAY_OFFSETS = [-40, -31, -30, -29, ...Array.from({ length: 17 }, (_, i) => i - 8), 19, 20, 21, 24, 25, 26, 29, 30, 31]

/** Due times that matter: legacy midnight, a date-only 23:59:59, a morning near today, the null date. */
function dueDateSamples(reference: Date): string[] {
  const samples: string[] = [NULL_DATE]
  for (const offset of DAY_OFFSETS) {
    const times = Math.abs(offset) <= 2 ? [[0, 0, 0], [8, 0, 0], [23, 59, 59]] : [[0, 0, 0], [23, 59, 59]]
    for (const [h, m, s] of times) {
      samples.push(new Date(reference.getFullYear(), reference.getMonth(), reference.getDate() + offset, h, m, s).toISOString())
    }
  }
  return samples
}

type Candidate = ServerFilterTask & CustomListTask

describe.each(['America/New_York', 'Pacific/Auckland', 'Europe/Berlin'])('server filter is a superset of the evaluator in %s', (zone) => {
  it('never drops a task the evaluator accepts', () => {
    process.env.TZ = zone
    let accepted = 0
    let rejectedByServer = 0

    for (const referenceText of REFERENCE_DAYS) {
      const now = new Date(referenceText)
      const dues = dueDateSamples(now)
      const tasks: Candidate[] = []
      for (const due of dues) {
        for (const projectId of [10, 11, 12]) {
          for (const done of [false, true]) tasks.push({ project_id: projectId, done, due_date: due })
        }
      }

      for (const window of WINDOWS) {
        for (const includeOverdue of OVERDUE_FLAGS) {
          for (const projects of PROJECT_SETUPS) {
            for (const union of [false, true]) {
              for (const includeDone of [false, true]) {
                const filter: CustomListFilterInput = {
                  due_date_filter: window,
                  include_overdue: includeOverdue,
                  include_done: includeDone,
                  include_today_all_projects: union,
                  ...projects,
                }
                const serverFilter = buildCustomListServerFilter(filter, now)
                const passesServerFilter = compileServerFilter(serverFilter)
                for (const candidate of tasks) {
                  if (matchesCustomList(candidate, filter, now)) {
                    accepted++
                    if (!passesServerFilter(candidate)) {
                      throw new Error(
                        `Server filter dropped ${JSON.stringify(candidate)} for ${JSON.stringify(filter)} on ${referenceText}: ${serverFilter}`,
                      )
                    }
                  } else if (!passesServerFilter(candidate)) {
                    rejectedByServer++
                  }
                }
              }
            }
          }
        }
      }
    }

    // Not vacuous: plenty of tasks were accepted, and the server filter also narrows the fetch.
    expect(accepted).toBeGreaterThan(10_000)
    expect(rejectedByServer).toBeGreaterThan(10_000)
  })
})
