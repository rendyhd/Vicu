import { describe, expect, it } from 'vitest'
import { filtersFor } from '@/hooks/use-filters'

const NULL_DATE = '0001-01-01T00:00:00Z'

describe('what each list asks the server for (D-PERF-2)', () => {
  it('Today and Upcoming ask for their own due-date window, not every open dated task', () => {
    const today = filtersFor({ view: 'today' })
    const upcoming = filtersFor({ view: 'upcoming' })

    expect(today).toMatchObject({ filter: `done = false && due_date != '${NULL_DATE}'`, due_window: 'today', sort_by: 'due_date', order_by: 'asc' })
    expect(upcoming).toMatchObject({ filter: `done = false && due_date != '${NULL_DATE}'`, due_window: 'upcoming', sort_by: 'due_date', order_by: 'asc' })
    // Different queries, so the two lists never share (or overwrite) a cache entry.
    expect(JSON.stringify(today)).not.toBe(JSON.stringify(upcoming))
  })

  it('the Today and Upcoming query does not change from one day to the next (the clause is added per request)', () => {
    expect(JSON.stringify(filtersFor({ view: 'today' }))).toBe(JSON.stringify(filtersFor({ view: 'today' })))
    expect(JSON.stringify(filtersFor({ view: 'today' }))).not.toMatch(/\d{4}-\d{2}-\d{2}T(?!00:00:00Z)/)
  })

  it('the Tag view filters by the label on the server and keeps nested subtasks for the client', () => {
    expect(filtersFor({ view: 'tag', labelId: 7 })).toMatchObject({
      filter: 'done = false && labels = 7',
      keep_nested_subtasks: true,
    })
    // One label, one cache entry.
    expect(filtersFor({ view: 'tag', labelId: 7 }).filter).not.toBe(filtersFor({ view: 'tag', labelId: 8 }).filter)
  })

  it('Anytime, Inbox and project lists keep their queries', () => {
    expect(filtersFor({ view: 'anytime' })).toMatchObject({ filter: 'done = false' })
    expect(filtersFor({ view: 'inbox', inboxProjectId: 3 }).filter).toBe('done = false && project_id = 3')
    expect(filtersFor({ view: 'project', projectId: 9 }).filter).toBe('done = false && project_id = 9')
  })
})
