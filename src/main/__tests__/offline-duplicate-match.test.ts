import { describe, expect, it } from 'vitest'
import { DUPLICATE_WINDOW_MS, matchesQueuedCreate } from '../offline/duplicate-match'

const since = '2026-10-06T10:00:00.000Z'
const task = (over: Record<string, unknown> = {}) => ({
  id: 9, project_id: 7, title: 'Pack', description: '', created: '2026-10-06T10:00:05.000Z', ...over,
})

describe('matchesQueuedCreate', () => {
  it('matches the task a create would have produced', () => {
    expect(matchesQueuedCreate(task(), 7, { title: 'Pack' }, since)).toBe(true)
  })

  it('compares descriptions, treating a missing one as empty', () => {
    expect(matchesQueuedCreate(task({ description: '<p>x</p>' }), 7, { title: 'Pack', description: '<p>x</p>' }, since)).toBe(true)
    expect(matchesQueuedCreate(task({ description: '<p>x</p>' }), 7, { title: 'Pack' }, since)).toBe(false)
    expect(matchesQueuedCreate(task({ description: undefined }), 7, { title: 'Pack' }, since)).toBe(true)
  })

  it('needs the same project and title', () => {
    expect(matchesQueuedCreate(task({ project_id: 8 }), 7, { title: 'Pack' }, since)).toBe(false)
    expect(matchesQueuedCreate(task({ title: 'Pack bags' }), 7, { title: 'Pack' }, since)).toBe(false)
  })

  it('ignores tasks that existed long before the create was queued', () => {
    expect(matchesQueuedCreate(task({ created: '2026-10-01T10:00:00.000Z' }), 7, { title: 'Pack' }, since)).toBe(false)
    const justInside = new Date(Date.parse(since) - DUPLICATE_WINDOW_MS + 1000).toISOString()
    expect(matchesQueuedCreate(task({ created: justInside }), 7, { title: 'Pack' }, since)).toBe(true)
  })

  it('rejects malformed input', () => {
    expect(matchesQueuedCreate(null, 7, { title: 'Pack' }, since)).toBe(false)
    expect(matchesQueuedCreate({ title: 'Pack' }, 7, { title: 'Pack' }, since)).toBe(false)
    expect(matchesQueuedCreate(task({ created: 'yesterday' }), 7, { title: 'Pack' }, since)).toBe(false)
    expect(matchesQueuedCreate(task(), 7, { title: 'Pack' }, 'not a date')).toBe(false)
  })
})
