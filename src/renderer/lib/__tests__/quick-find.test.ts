import { describe, expect, it } from 'vitest'
import { collectCachedTasks, quickFindTasks } from '../quick-find'
import type { Task } from '../vikunja-types'

const task = (id: number, title: string, extra: Partial<Task> = {}) => ({ id, title, project_id: 1, description: '', ...extra }) as Task

describe('collectCachedTasks', () => {
  it('finds tasks in lists, in pages and in fields, each once', () => {
    const a = task(1, 'Call the plumber')
    const b = task(2, 'Buy milk')
    const found = collectCachedTasks([[a, b], { pages: [[b], [task(3, 'Pay rent')]] }, { tasks: [a] }, undefined, 'text'])
    expect(found.map((t) => t.id)).toEqual([1, 2, 3])
  })

  it('leaves out hidden metadata tasks', () => {
    const hidden = task(9, 'carrier', { description: '<!-- vicu-routine:archive:v1 -->' })
    expect(collectCachedTasks([[hidden, task(1, 'Real')]]).map((t) => t.id)).toEqual([1])
  })

  it('ignores things that only look like tasks', () => {
    expect(collectCachedTasks([[{ id: 'x', title: 'no' }, { id: 1 }], { id: 1, title: 'a', project_id: 1 }])).toEqual([])
  })
})

describe('quickFindTasks', () => {
  const plumber = task(1, 'Call the plumber about the kitchen leak')
  const milk = task(2, 'Buy milk')

  it('lists nothing for an empty query', () => {
    expect(quickFindTasks('  ', [plumber], [])).toEqual([])
  })

  it('answers from the cache before the server has replied', () => {
    expect(quickFindTasks('plumb', [plumber, milk], []).map((t) => t.id)).toEqual([1])
  })

  it('merges the server answer, each task once, the server copy winning', () => {
    const fresh = task(1, 'Call the plumber back')
    const other = task(3, 'Plumbing quote')
    const result = quickFindTasks('plumb', [plumber], [fresh, other])
    expect(result.map((t) => t.id).sort()).toEqual([1, 3])
    expect(result.find((t) => t.id === 1)?.title).toBe('Call the plumber back')
  })

  it('stops at the limit', () => {
    const many = Array.from({ length: 20 }, (_, i) => task(i + 1, `Plumber ${i}`))
    expect(quickFindTasks('plumber', many, [], 5)).toHaveLength(5)
  })
})
