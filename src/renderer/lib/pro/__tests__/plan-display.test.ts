import { describe, expect, it } from 'vitest'
import { asPlanTask, cellFacts, planNameBase, planPhase, sortPlanTasks } from '../plan-display'

describe('asPlanTask', () => {
  it('reads the parent from the parent task relation', () => {
    expect(asPlanTask({ id: 2, related_tasks: { parenttask: [{ id: 1 }] } }).parent).toBe(1)
    expect(asPlanTask({ id: 1 }).parent).toBeNull()
    expect(asPlanTask({ id: 1, related_tasks: { parenttask: null } }).parent).toBeNull()
  })
})

describe('sortPlanTasks', () => {
  it('puts the displayed tasks first in their order, then open, then done, and drops hidden ones', () => {
    const tasks = [
      { id: 1, done: true },
      { id: 2 },
      { id: 3 },
      { id: 4, description: '<!-- vicu-routine:v1 {} -->' },
      { id: 5 },
    ]
    expect(sortPlanTasks(tasks, [{ id: 5 }, { id: 3 }]).map((task) => task.id)).toEqual([5, 3, 2, 1])
  })
})

const cell = (over: Partial<Record<'due' | 'delivered' | 'late' | 'slipped' | 'dropped', number>>) => ({ due: 0, delivered: 0, late: 0, slipped: 0, dropped: 0, ...over })

describe('cellFacts', () => {
  it('is empty for an empty cell', () => {
    expect(cellFacts(cell({}))).toEqual([])
  })

  it('splits late deliveries from the ones on time', () => {
    expect(cellFacts(cell({ due: 1, delivered: 3, late: 1 }))).toEqual([
      { fact: 'due', count: 1 },
      { fact: 'delivered', count: 2 },
      { fact: 'late', count: 1 },
    ])
  })

  it('leaves out delivered when every delivery was late', () => {
    expect(cellFacts(cell({ delivered: 1, late: 1, slipped: 2, dropped: 1 }))).toEqual([
      { fact: 'late', count: 1 },
      { fact: 'slipped', count: 2 },
      { fact: 'dropped', count: 1 },
    ])
  })
})

describe('planPhase', () => {
  const plan = { start: '2026-11-02', end: '2027-01-31', closed: null }

  it('says the week while today is inside the plan', () => {
    expect(planPhase(plan, 3, 13, '2026-11-25')).toEqual({ kind: 'week', week: 4, weeks: 13 })
  })

  it('says when it starts, ended or closed', () => {
    expect(planPhase(plan, null, 13, '2026-10-30')).toEqual({ kind: 'before', day: '2026-11-02' })
    expect(planPhase(plan, null, 13, '2027-02-01')).toEqual({ kind: 'after', day: '2027-01-31' })
    expect(planPhase({ ...plan, closed: '2026-12-01' }, 4, 13, '2026-12-01')).toEqual({ kind: 'closed', day: '2026-12-01' })
  })
})

describe('planNameBase', () => {
  it('keeps a name without the old month', () => {
    expect(planNameBase('Launch', 'November 2026')).toBe('Launch')
  })

  it('takes the old month and its separator off the end', () => {
    expect(planNameBase('Launch November 2026', 'November 2026')).toBe('Launch')
    expect(planNameBase('Launch · november 2026', 'November 2026')).toBe('Launch')
  })

  it('keeps a name that is only the month', () => {
    expect(planNameBase('November 2026', 'November 2026')).toBe('November 2026')
  })
})
