import { describe, expect, it } from 'vitest'
import { withDueRules } from '../task-due-rules'
import { NULL_DATE } from '../constants'
import { dateOnlyDue } from '../../../shared/due-dates'
import { taskPatch } from '../../../shared/merge-patches'
import { splitTodayOverdue, countTodayOverdue } from '../today-overdue'
import type { Task } from '../vikunja-types'

const iso = (local: string) => new Date(local).toISOString()
const now = new Date('2026-10-06T10:00:00')

const blocked = {
  id: 1,
  project_id: 1,
  done: false,
  due_date: dateOnlyDue('2026-10-06'),
  start_date: iso('2026-10-06T15:00:00'),
  end_date: iso('2026-10-06T15:30:00'),
  reminders: [
    { reminder: iso('2026-10-06T14:45:00'), relative_to: 'start_date', relative_period: -900 },
    { reminder: iso('2026-10-06T09:00:00') },
  ],
} as unknown as Task

describe('a new due date on a task with a block (contract 16.3)', () => {
  it('moves the block to the new day in the same patch, at the same wall-clock times', () => {
    const { changes } = withDueRules<{ changes: Partial<Task>; original: Task }>({ changes: { due_date: dateOnlyDue('2026-10-08') }, original: blocked }, now)
    expect(new Date(changes.start_date!).getTime()).toBe(new Date('2026-10-08T15:00:00').getTime())
    expect(new Date(changes.end_date!).getTime()).toBe(new Date('2026-10-08T15:30:00').getTime())
    const patch = taskPatch(blocked, { ...blocked, ...changes })
    expect(Object.keys(patch).sort()).toEqual(['due_date', 'end_date', 'start_date'])
  })

  it('clearing the due date removes the time and the reminders that followed it', () => {
    const { changes } = withDueRules<{ changes: Partial<Task>; original: Task }>({ changes: { due_date: NULL_DATE }, original: blocked }, now)
    expect(changes.start_date).toBe(NULL_DATE)
    expect(changes.end_date).toBe(NULL_DATE)
    expect(changes.reminders).toEqual([{ reminder: iso('2026-10-06T09:00:00') }])
    const patch = taskPatch(blocked, { ...blocked, ...changes }) as Record<string, unknown>
    expect(patch.start_date).toBeNull()
    expect(patch.end_date).toBeNull()
  })

  it('leaves a task without a block, and a change without a due date, alone', () => {
    const plain = { ...blocked, start_date: NULL_DATE, end_date: NULL_DATE } as Task
    const noBlock = { changes: { due_date: dateOnlyDue('2026-10-08') }, original: plain }
    expect(withDueRules(noBlock, now)).toBe(noBlock)
    const title = { changes: { title: 'New' }, original: blocked }
    expect(withDueRules(title, now)).toBe(title)
  })
})

describe('the Today split with a block', () => {
  const active = new Set([1])
  const task = (id: number, due: string, start: string | null = null, end: string | null = null, done = false) => ({
    id,
    project_id: 1,
    done,
    due_date: due,
    start_date: start ?? NULL_DATE,
    end_date: end ?? NULL_DATE,
  })

  it('a block starting today is on Today whatever its due date, and counts once', () => {
    const tasks = [
      task(1, NULL_DATE, iso('2026-10-06T15:00:00'), iso('2026-10-06T15:30:00')),
      task(2, dateOnlyDue('2026-10-13'), iso('2026-10-06T16:00:00'), iso('2026-10-06T16:30:00')),
      task(3, dateOnlyDue('2026-10-06'), iso('2026-10-06T17:00:00'), iso('2026-10-06T17:30:00')),
      task(4, dateOnlyDue('2026-10-05'), iso('2026-10-06T18:00:00'), iso('2026-10-06T18:30:00')),
    ]
    const { overdue, today } = splitTodayOverdue(tasks, active, now)
    expect(overdue.map((t) => t.id)).toEqual([4])
    expect(today.map((t) => t.id).sort()).toEqual([1, 2, 3])
    expect(countTodayOverdue(tasks, active, now)).toBe(4)
  })

  it('a start date alone, or a bar over several days, is not a block and stays out', () => {
    const tasks = [
      task(1, NULL_DATE, iso('2026-10-06T15:00:00')),
      task(2, NULL_DATE, iso('2026-10-06T15:00:00'), iso('2026-10-09T15:00:00')),
    ]
    expect(splitTodayOverdue(tasks, active, now)).toEqual({ overdue: [], today: [] })
  })
})
