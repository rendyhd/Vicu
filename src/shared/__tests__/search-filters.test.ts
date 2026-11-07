import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildSearchServerFilter, matchesSearchFilters, searchFiltersActive, type SearchFilters } from '../search-filters'

interface FixtureTask {
  id: number
  projectId: number
  due: string | null
  done: boolean
  priority: number
  labelIds: number[]
}

const fixture = JSON.parse(readFileSync(join(process.cwd(), 'test-fixtures', 'cross-app-semantics-v1.json'), 'utf8')) as {
  tasks: FixtureTask[]
  searchFilters: Array<{ name: string; today: string; filters: SearchFilters; expect: number[] }>
}

const tasks = fixture.tasks.map((task) => ({
  id: task.id,
  project_id: task.projectId,
  done: task.done,
  due_date: task.due === null ? '0001-01-01T00:00:00Z' : new Date(`${task.due}`).toISOString(),
  priority: task.priority,
  labels: task.labelIds.map((id) => ({ id })),
}))

describe('searchFilters (contract section 17)', () => {
  it('has the vectors', () => {
    expect(fixture.searchFilters.length).toBeGreaterThanOrEqual(18)
  })

  for (const vector of fixture.searchFilters) {
    it(vector.name, () => {
      expect(tasks.filter((task) => matchesSearchFilters(task, vector.filters, vector.today)).map((task) => task.id)).toEqual(vector.expect)
    })
  }

  it('no filter is not active', () => {
    expect(searchFiltersActive({})).toBe(false)
    expect(searchFiltersActive({ date: 'all', status: 'all', label_ids: [], priorities: [] })).toBe(false)
    expect(searchFiltersActive({ status: 'done' })).toBe(true)
  })

  it('text alone asks the server for nothing more', () => {
    expect(buildSearchServerFilter({}, true)).toBeUndefined()
  })

  it('labels and priority only go to the server without text', () => {
    const filters: SearchFilters = { label_ids: [7], priorities: [4, 3] }
    expect(buildSearchServerFilter(filters, true)).toBeUndefined()
    expect(buildSearchServerFilter(filters, false)).toBe('labels in 7 && priority in 3,4')
  })

  it('a range asks for its days in order', () => {
    const filter = buildSearchServerFilter({ date: 'range', from: '2026-10-12', to: '2026-10-07' }, false) ?? ''
    expect(filter).toBe(`due_date >= '${new Date(2026, 9, 7).toISOString()}' && due_date < '${new Date(2026, 9, 13).toISOString()}'`)
  })
})
