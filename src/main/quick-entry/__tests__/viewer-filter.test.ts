import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ViewerFilter } from '../../config'
import type { AppCustomList } from '../../custom-list-protocol'
import { buildViewerFilterParams } from '../filter-builder'
import { resolveViewerFilter, selectQuickViewTasks, selectViewerTasks } from '../viewer-filter'
import { compileServerFilter } from '../../../shared/__tests__/server-filter-eval'

const originalTz = process.env.TZ
afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ
  else process.env.TZ = originalTz
})

const NULL_DATE = '0001-01-01T00:00:00Z'
const INBOX = 5

const base: ViewerFilter = { project_ids: [], sort_by: 'due_date', order_by: 'asc', due_date_filter: 'all' }

interface Task {
  id: number
  project_id: number
  done: boolean
  due_date: string
  priority: number
  labels: Array<{ id: number }>
}

const task = (id: number, overrides: Partial<Task> & { due?: string } = {}): Task => {
  const { due, ...rest } = overrides
  return {
    id,
    project_id: 10,
    done: false,
    due_date: due ? new Date(due).toISOString() : NULL_DATE,
    priority: 0,
    labels: [],
    ...rest,
  }
}

const list = (filter: Partial<AppCustomList['filter']>): AppCustomList => ({
  id: 'list-1',
  name: 'A list',
  filter: { project_ids: [], sort_by: 'priority', order_by: 'desc', due_date_filter: 'all', ...filter },
})

// Tue 2026-10-06 and Sun 2026-10-11, local time.
const tuesday = () => new Date(2026, 9, 6, 10, 0)
const sunday = () => new Date(2026, 9, 11, 10, 0)

describe('resolveViewerFilter', () => {
  it('keeps a plain filter as it is', () => {
    const resolved = resolveViewerFilter({ ...base, project_ids: [3] }, [])
    expect(resolved).toEqual({ filter: { ...base, project_ids: [3] }, fromCustomList: false })
  })

  it('takes everything from the custom list the viewer points at', () => {
    const custom = list({
      project_ids: [3, 4],
      project_filter_mode: 'exclude',
      due_date_filter: 'this_week',
      include_overdue: false,
      include_done: true,
      include_today_all_projects: true,
      priority_filter: [3],
      label_ids: [7],
    })
    const resolved = resolveViewerFilter({ ...base, custom_list_id: 'list-1', project_ids: [9] }, [custom])
    expect(resolved.fromCustomList).toBe(true)
    expect(resolved.filter).toMatchObject({
      project_ids: [3, 4],
      project_filter_mode: 'exclude',
      due_date_filter: 'this_week',
      include_overdue: false,
      include_done: true,
      include_today_all_projects: true,
      priority_filter: [3],
      label_ids: [7],
      sort_by: 'priority',
      order_by: 'desc',
    })
    expect(resolved.filter.view_type).toBeUndefined()
  })

  it('falls back to the plain filter when the list no longer exists', () => {
    const resolved = resolveViewerFilter({ ...base, custom_list_id: 'gone' }, [list({})])
    expect(resolved.fromCustomList).toBe(false)
    expect(resolved.filter.project_ids).toEqual([])
  })

  it('leaves include_overdue unset for a list that never set it', () => {
    const resolved = resolveViewerFilter({ ...base, custom_list_id: 'list-1' }, [list({ due_date_filter: 'today' })])
    expect(resolved.filter.include_overdue).toBeUndefined()
  })

  it('keeps "today from all projects" of a plain filter to tasks due today, as before', () => {
    const resolved = resolveViewerFilter({ ...base, project_ids: [3], include_today_all_projects: true }, [])
    expect(resolved.filter.include_overdue).toBe(false)
    // Without the union the flag is not touched.
    expect(resolveViewerFilter({ ...base, project_ids: [3] }, []).filter.include_overdue).toBeUndefined()
  })
})

describe('selectViewerTasks (D-QV-1)', () => {
  it('leaves the inbox out of "anytime", like the main Anytime view', () => {
    const tasks = [task(1, { project_id: INBOX }), task(2, { project_id: 10 }), task(3, { project_id: INBOX, done: true })]
    const out = selectViewerTasks(tasks, { ...base, view_type: 'anytime' }, { now: tuesday(), inboxProjectId: INBOX })
    expect(out.map((t) => t.id)).toEqual([2])
  })

  it('keeps everything in "anytime" when no inbox is configured', () => {
    const tasks = [task(1, { project_id: INBOX }), task(2, { project_id: 10 })]
    expect(selectViewerTasks(tasks, { ...base, view_type: 'anytime' }, { now: tuesday() }).map((t) => t.id)).toEqual([1, 2])
    expect(selectViewerTasks(tasks, { ...base, view_type: 'anytime' }, { now: tuesday(), inboxProjectId: 0 }).map((t) => t.id)).toEqual([1, 2])
  })

  it('keeps the inbox in Today and Upcoming', () => {
    const tasks = [
      task(1, { project_id: INBOX, due: '2026-10-06T08:00:00' }),
      task(2, { project_id: INBOX, due: '2026-10-07T23:59:59' }),
      task(3, { project_id: 10, due: '2026-10-05T23:59:59' }),
    ]
    expect(selectViewerTasks(tasks, { ...base, view_type: 'today' }, { now: tuesday(), inboxProjectId: INBOX }).map((t) => t.id)).toEqual([1, 3])
    expect(selectViewerTasks(tasks, { ...base, view_type: 'upcoming' }, { now: tuesday(), inboxProjectId: INBOX }).map((t) => t.id)).toEqual([2])
  })

  it('honors include_done for a list, and shows only open tasks otherwise', () => {
    const tasks = [task(1), task(2, { done: true })]
    const withDone = resolveViewerFilter({ ...base, custom_list_id: 'list-1' }, [list({ include_done: true })]).filter
    const withoutDone = resolveViewerFilter({ ...base, custom_list_id: 'list-1' }, [list({})]).filter
    expect(selectViewerTasks(tasks, withDone, { now: tuesday() }).map((t) => t.id)).toEqual([1, 2])
    expect(selectViewerTasks(tasks, withoutDone, { now: tuesday() }).map((t) => t.id)).toEqual([1])
    // ...and the server filter does not ask for open tasks only.
    expect(buildViewerFilterParams(withDone, tuesday()).filter).toBeUndefined()
    expect(buildViewerFilterParams(withoutDone, tuesday()).filter).toBe('done = false')
  })

  it('applies exclude mode, priority and labels like the main window', () => {
    const tasks = [
      task(1, { project_id: 10, priority: 3, labels: [{ id: 7 }] }),
      task(2, { project_id: 11, priority: 3, labels: [{ id: 7 }] }),
      task(3, { project_id: 11, priority: 1, labels: [{ id: 7 }] }),
      task(4, { project_id: 11, priority: 3, labels: [] }),
    ]
    const filter = resolveViewerFilter(
      { ...base, custom_list_id: 'list-1' },
      [list({ project_ids: [10], project_filter_mode: 'exclude', priority_filter: [3], label_ids: [7] })],
    ).filter
    expect(selectViewerTasks(tasks, filter, { now: tuesday() }).map((t) => t.id)).toEqual([2])
  })
})

describe('selectQuickViewTasks (filter before hiding subtasks, X-16)', () => {
  interface Nested extends Task {
    description?: string
    related_tasks?: { parenttask?: Array<{ id: number; done?: boolean }>; subtask?: Array<{ id: number }> }
  }
  // Parent 1 has no label; its subtask 2 has label 7. Parent 3 and its subtask 4 both have it.
  const tasks = (): Nested[] => [
    { ...task(1), related_tasks: { subtask: [{ id: 2 }] } },
    { ...task(2, { labels: [{ id: 7 }] }), related_tasks: { parenttask: [{ id: 1 }] } },
    { ...task(3, { labels: [{ id: 7 }] }), related_tasks: { subtask: [{ id: 4 }] } },
    { ...task(4, { labels: [{ id: 7 }] }), related_tasks: { parenttask: [{ id: 3 }] } },
  ]
  const labelled = resolveViewerFilter({ ...base, custom_list_id: 'list-1' }, [list({ label_ids: [7] })])

  it('shows a matching subtask whose parent does not match, and nests one whose parent matches', () => {
    expect(selectQuickViewTasks(tasks(), labelled, { now: tuesday() }).map((t) => t.id)).toEqual([2, 3])
  })

  it('leaves plain filters alone: they arrive already de-nested from the fetch', () => {
    const plain = resolveViewerFilter(base, [])
    expect(selectQuickViewTasks(tasks(), plain, { now: tuesday() }).map((t) => t.id)).toEqual([1, 2, 3, 4])
  })

  it('applies the extra conditions before hiding subtasks', () => {
    // Parent 3 is dropped (say its project is archived), so its labeled subtask 4 is shown.
    const out = selectQuickViewTasks(tasks(), labelled, { now: tuesday(), keep: (t) => t.id !== 3 })
    expect(out.map((t) => t.id)).toEqual([2, 4])
  })
})

describe('"this week" ends on Sunday (D-WEEK-1)', () => {
  const week = { ...base, due_date_filter: 'this_week' }

  it('stops at the end of Sunday, and on a Sunday at the end of that day', () => {
    process.env.TZ = 'America/New_York'
    const tasks = [
      task(1, { due: '2026-10-11T23:59:59' }), // Sunday
      task(2, { due: '2026-10-12T00:00:00' }), // Monday
      task(3, { due: '2026-10-18T23:59:59' }), // the Sunday after
    ]
    expect(selectViewerTasks(tasks, week, { now: tuesday() }).map((t) => t.id)).toEqual([1])
    expect(selectViewerTasks(tasks, week, { now: sunday() }).map((t) => t.id)).toEqual([1])

    // The server filter covers the same window (Sunday ends at the start of Monday, 04:00Z).
    expect(buildViewerFilterParams(week, tuesday()).filter).toBe(
      `done = false && due_date < '2026-10-12T04:00:00.000Z' && due_date != '${NULL_DATE}'`,
    )
    expect(buildViewerFilterParams(week, sunday()).filter).toBe(
      `done = false && due_date < '2026-10-12T04:00:00.000Z' && due_date != '${NULL_DATE}'`,
    )
  })
})

// --- The Quick View runs the same vectors as the main window -----------------------------

interface FixtureTask { id: number; projectId: number; due: string | null; done: boolean; priority: number; labelIds: number[] }
interface Vector { name: string; today: string; filter: Partial<AppCustomList['filter']>; expect: number[] }
const fixture = JSON.parse(readFileSync(join(process.cwd(), 'test-fixtures', 'cross-app-semantics-v1.json'), 'utf8')) as {
  tasks: FixtureTask[]
  customLists: Vector[]
}

function local(value: string): Date {
  const [datePart, timePart = '00:00:00'] = value.split('T')
  const [y, m, d] = datePart.split('-').map(Number)
  const [h, mi, s] = timePart.split(':').map(Number)
  return new Date(y, m - 1, d, h, mi, s)
}

describe.each(['America/New_York', 'Pacific/Auckland'])('Quick View custom lists on the shared vectors in %s', (zone) => {
  it('selects the expected tasks, and the server filter never drops one of them', () => {
    process.env.TZ = zone
    const tasks = fixture.tasks.map((t) => ({
      id: t.id,
      project_id: t.projectId,
      done: t.done,
      due_date: t.due === null ? NULL_DATE : local(t.due).toISOString(),
      priority: t.priority,
      labels: t.labelIds.map((id) => ({ id })),
    }))

    for (const vector of fixture.customLists) {
      const now = local(`${vector.today}T10:00:00`)
      const custom: AppCustomList = {
        id: 'list-1',
        name: vector.name,
        filter: { project_ids: [], sort_by: 'due_date', order_by: 'asc', due_date_filter: 'all', ...vector.filter },
      }
      const { filter } = resolveViewerFilter({ ...base, custom_list_id: 'list-1' }, [custom])
      const selected = selectViewerTasks(tasks, filter, { now }).map((t) => t.id)
      expect(selected, vector.name).toEqual(vector.expect)

      const passesServerFilter = compileServerFilter(buildViewerFilterParams(filter, now).filter)
      for (const t of tasks.filter((candidate) => vector.expect.includes(candidate.id))) {
        expect(passesServerFilter(t), `${vector.name}: task ${t.id}`).toBe(true)
      }
    }
  })
})
