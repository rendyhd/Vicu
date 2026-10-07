import { describe, expect, it } from 'vitest'
import { countTodayOverdue, splitTodayOverdue } from '../today-overdue'
import { NULL_DATE } from '../constants'

const local = (y: number, m: number, d: number, h = 0, min = 0, s = 0) => new Date(y, m - 1, d, h, min, s, 0)

interface TestTask {
  id: number
  project_id: number
  done: boolean
  due_date: string
}

let nextId = 1
const task = (project_id: number, due: Date | null, done = false): TestTask => ({
  id: nextId++,
  project_id,
  done,
  due_date: due ? due.toISOString() : NULL_DATE,
})

const active = new Set([1, 2])

describe('countTodayOverdue (the app icon badge)', () => {
  const now = local(2026, 10, 7, 10, 0, 0)

  it('counts overdue and due-today open tasks', () => {
    const tasks = [
      task(1, local(2026, 10, 6, 23, 59, 59)), // date-only, yesterday: overdue
      task(1, local(2026, 10, 7, 23, 59, 59)), // date-only, today
      task(2, local(2026, 10, 7, 9, 0, 0)), // earlier today with a time: still today
      task(1, local(2026, 10, 8, 23, 59, 59)), // tomorrow: not counted
    ]
    expect(countTodayOverdue(tasks, active, now)).toBe(3)
  })

  it('leaves out tasks in archived or unknown projects, as the Today view does', () => {
    const tasks = [
      task(1, local(2026, 10, 7, 23, 59, 59)),
      task(9, local(2026, 10, 6, 23, 59, 59)), // archived
      task(9, local(2026, 10, 7, 23, 59, 59)), // archived
    ]
    expect(countTodayOverdue(tasks, active, now)).toBe(1)
  })

  it('leaves out done tasks and tasks without a due date', () => {
    const tasks = [task(1, local(2026, 10, 7, 23, 59, 59), true), task(1, null)]
    expect(countTodayOverdue(tasks, active, now)).toBe(0)
  })

  it('moves a task from today to overdue at midnight without any data change', () => {
    const tasks = [task(1, local(2026, 10, 7, 23, 59, 59))]
    expect(splitTodayOverdue(tasks, active, local(2026, 10, 7, 23, 59, 58))).toMatchObject({ overdue: [], today: [expect.anything()] })
    const after = splitTodayOverdue(tasks, active, local(2026, 10, 8, 0, 0, 1))
    expect(after.overdue).toHaveLength(1)
    expect(after.today).toHaveLength(0)
    // Still counted: overdue tasks are in the badge too.
    expect(countTodayOverdue(tasks, active, local(2026, 10, 8, 0, 0, 1))).toBe(1)
  })

  it('counts a task due tomorrow from the first second after local midnight', () => {
    const tasks = [task(1, local(2026, 10, 8, 23, 59, 59))]
    expect(countTodayOverdue(tasks, active, local(2026, 10, 7, 23, 59, 59))).toBe(0)
    expect(countTodayOverdue(tasks, active, local(2026, 10, 8, 0, 0, 1))).toBe(1)
  })

  it('keeps counting an open task however long it has been overdue', () => {
    const tasks = [task(1, local(2026, 10, 7, 23, 59, 59))]
    expect(countTodayOverdue(tasks, active, local(2026, 10, 9, 8, 0, 0))).toBe(1)
  })
})

describe('splitTodayOverdue', () => {
  const now = local(2026, 10, 7, 10, 0, 0)

  it('keeps done tasks, as the Today view shows them struck through during the undo window', () => {
    const tasks = [task(1, local(2026, 10, 7, 23, 59, 59), true)]
    expect(splitTodayOverdue(tasks, active, now).today).toHaveLength(1)
  })

  it('drops tasks of projects that are not active', () => {
    const tasks = [task(5, local(2026, 10, 7, 23, 59, 59))]
    const result = splitTodayOverdue(tasks, active, now)
    expect(result.today).toHaveLength(0)
    expect(result.overdue).toHaveLength(0)
  })
})
