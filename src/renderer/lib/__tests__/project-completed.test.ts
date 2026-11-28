import { describe, expect, it } from 'vitest'
import {
  PROJECT_DONE_PAGE_SIZE,
  byCompletion,
  projectDoneCount,
  projectDoneCountPlan,
  projectDoneFilter,
  projectDoneHasMore,
  projectDoneLabelFilter,
  projectDonePageParams,
  projectDoneRows,
} from '../project-completed'
import {
  PROJECTS_SHOW_DONE_KEY,
  projectsShowDoneValue,
  readProjectsShowDone,
  readSyncedPref,
} from '../../../shared/synced-prefs'
import { workModeClause, type WorkScope } from '../../../shared/work-scope'
import type { Task } from '../vikunja-types'

function task(id: number, doneAt: string, extra: Partial<Task> = {}): Task {
  return { id, title: `Task ${id}`, done: true, done_at: doneAt, project_id: 7, description: '', ...extra } as Task
}

describe('the setting projects.show_done (cross-app semantics 11.3, 12.6)', () => {
  it('is on only for true; no entry, null and any other value read as off', () => {
    expect(PROJECTS_SHOW_DONE_KEY).toBe('projects.show_done')
    expect(readProjectsShowDone(true)).toBe(true)
    for (const value of [undefined, null, false, 'true', 1, {}]) expect(readProjectsShowDone(value)).toBe(false)
    expect(readSyncedPref({ 'projects.show_done': true }, PROJECTS_SHOW_DONE_KEY)).toBe(true)
    expect(readSyncedPref({}, PROJECTS_SHOW_DONE_KEY)).toBe(false)
  })

  it('writes true when turned on and null when turned off, never false', () => {
    expect(projectsShowDoneValue(true)).toBe(true)
    expect(projectsShowDoneValue(false)).toBeNull()
  })
})

describe('the query of a project\'s done tasks', () => {
  it('asks for the project\'s own done tasks, newest completion first, 20 a page', () => {
    expect(projectDoneFilter(7)).toBe('done = true && project = 7')
    expect(projectDonePageParams(7, null, 2)).toEqual({
      filter: 'done = true && project = 7',
      sort_by: ['done_at', 'id'],
      order_by: ['desc', 'desc'],
      page: 2,
      per_page: PROJECT_DONE_PAGE_SIZE,
      keep_nested_subtasks: true,
    })
    expect(PROJECT_DONE_PAGE_SIZE).toBe(20)
  })

  it('adds the Work and Personal clause the way the Logbook does (22.9)', () => {
    const scope: WorkScope = { label: 4, projects: new Set([3, 9]) }
    const { clause } = workModeClause(scope, 'work')
    expect(projectDonePageParams(7, clause, 1).filter).toBe('done = true && project = 7 && (project in 3, 9 || labels = 4)')
    expect(projectDonePageParams(7, workModeClause(scope, 'personal').clause, 1).filter)
      .toBe('done = true && project = 7 && project not in 3, 9')
    expect(projectDoneLabelFilter(7, 4)).toBe('done = true && project = 7 && labels = 4')
  })

  it('has more while the last page arrived full', () => {
    const full = Array.from({ length: PROJECT_DONE_PAGE_SIZE }, (_, i) => task(i + 1, '2026-11-01T10:00:00Z'))
    expect(projectDoneHasMore([])).toBe(false)
    expect(projectDoneHasMore([full])).toBe(true)
    expect(projectDoneHasMore([full, undefined])).toBe(false)
    expect(projectDoneHasMore([full, full.slice(0, 3)])).toBe(false)
  })
})

describe('the rows of the Completed list', () => {
  it('orders by completion, newest first, then the higher id', () => {
    const rows = [
      task(1, '2026-11-01T10:00:00Z'),
      task(5, '2026-11-03T08:00:00Z'),
      task(2, '2026-11-03T08:00:00Z'),
      task(9, '0001-01-01T00:00:00Z'),
    ].sort(byCompletion)
    expect(rows.map((row) => row.id)).toEqual([5, 2, 1, 9])
  })

  it('merges pages without repeats and leaves out hidden, reopened and already shown tasks', () => {
    const pages = [
      [task(1, '2026-11-02T10:00:00Z'), task(2, '2026-11-02T09:00:00Z'), task(3, '2026-11-02T08:00:00Z')],
      [
        task(3, '2026-11-02T08:00:00Z'),
        task(4, '2026-11-01T10:00:00Z', { description: '<!-- vicu-routine:v1 {} -->' }),
        task(5, '2026-11-01T09:00:00Z', { done: false }),
        task(6, '2026-11-01T08:00:00Z'),
      ],
    ]
    expect(projectDoneRows(pages, new Set([2])).map((row) => row.id)).toEqual([1, 3, 6])
    expect(projectDoneRows([undefined])).toEqual([])
  })
})

describe('the count follows the Work and Personal mode (section 22)', () => {
  const scope: WorkScope = { label: 4, projects: new Set([3]) }
  const noLabel: WorkScope = { label: null, projects: new Set([3]) }

  it('counts every done task in All and in the mode the project belongs to', () => {
    expect(projectDoneCountPlan(7, scope, 'all')).toEqual({ kind: 'all' })
    expect(projectDoneCountPlan(3, scope, 'work')).toEqual({ kind: 'all' })
    expect(projectDoneCountPlan(7, noLabel, 'personal')).toEqual({ kind: 'all' })
  })

  it('counts by the work label in a project of the other side, and nothing a mode never shows', () => {
    expect(projectDoneCountPlan(7, scope, 'work')).toEqual({ kind: 'labelled', label: 4 })
    expect(projectDoneCountPlan(7, scope, 'personal')).toEqual({ kind: 'allButLabelled', label: 4 })
    expect(projectDoneCountPlan(7, noLabel, 'work')).toEqual({ kind: 'none' })
    expect(projectDoneCountPlan(3, scope, 'personal')).toEqual({ kind: 'none' })
  })

  it('works the number out of the totals, unknown until each total it needs is known', () => {
    expect(projectDoneCount({ kind: 'all' }, 12, undefined)).toBe(12)
    expect(projectDoneCount({ kind: 'all' }, undefined, undefined)).toBeUndefined()
    expect(projectDoneCount({ kind: 'none' }, undefined, undefined)).toBe(0)
    expect(projectDoneCount({ kind: 'labelled', label: 4 }, 12, 5)).toBe(5)
    expect(projectDoneCount({ kind: 'allButLabelled', label: 4 }, 12, 5)).toBe(7)
    expect(projectDoneCount({ kind: 'allButLabelled', label: 4 }, 12, undefined)).toBeUndefined()
    expect(projectDoneCount({ kind: 'allButLabelled', label: 4 }, 3, 5)).toBe(0)
  })
})
