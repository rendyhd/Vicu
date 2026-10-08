import { describe, expect, it } from 'vitest'
import { runTaskTransition, taskTransitionName, transitionIds } from '../task-transition'

describe('transitionIds', () => {
  it('lists the task that closes and the one that opens, once each', () => {
    expect(transitionIds(1, 2)).toEqual([1, 2])
    expect(transitionIds(null, 2)).toEqual([2])
    expect(transitionIds(3, null)).toEqual([3])
    expect(transitionIds(4, 4)).toEqual([4])
    expect(transitionIds(null, null)).toEqual([])
  })
})

describe('taskTransitionName', () => {
  it('is one name per task id, usable as a CSS identifier', () => {
    expect(taskTransitionName(12)).toBe('task-12')
    expect(taskTransitionName(12)).toMatch(/^[a-z][a-z0-9-]*$/)
  })
})

describe('runTaskTransition without a document', () => {
  it('applies the change at once', () => {
    let applied = 0
    runTaskTransition([1, 2], () => applied++)
    runTaskTransition([], () => applied++)
    expect(applied).toBe(2)
  })
})
