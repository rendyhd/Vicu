import { describe, expect, it } from 'vitest'
import { NULL_DATE } from '../constants'
import { sortProjectTasks } from '../task-sort'
import {
  MIN_POSITION_GAP,
  POSITION_STEP,
  applyPositionUpdates,
  insertPosition,
  isUndatedTask,
  planMove,
  sendPositionUpdates,
} from '../reorder-positions'
import type { Task } from '../vikunja-types'

let nextId = 1
function task(title: string, position: number, due: string = NULL_DATE): Task {
  return { id: nextId++, title, position, due_date: due, project_id: 1 } as Task
}
const DUE = '2026-11-01T22:59:59Z'

/** Apply a plan to the tasks the way the optimistic update does. */
function applyPlan(tasks: Task[], movedId: number, plan: { position: number; renumbered: Array<{ taskId: number; position: number }> }): Task[] {
  const positions = new Map(plan.renumbered.map((entry) => [entry.taskId, entry.position]))
  positions.set(movedId, plan.position)
  return tasks.map((entry) => (positions.has(entry.id) ? { ...entry, position: positions.get(entry.id)! } : entry))
}

describe('isUndatedTask', () => {
  it('is true without a due date, also for the null date', () => {
    expect(isUndatedTask(task('a', 1))).toBe(true)
    expect(isUndatedTask({ ...task('a', 1), due_date: '' })).toBe(true)
    expect(isUndatedTask(task('a', 1, DUE))).toBe(false)
  })
})

describe('insertPosition', () => {
  it('is the middle between the undated neighbours', () => {
    const list = [task('a', 100), task('b', 300)]
    expect(insertPosition(list, 1)).toEqual({ position: 200, hasRoom: true })
  })

  it('goes half way to the first position at the top', () => {
    const list = [task('a', 100), task('b', 300)]
    expect(insertPosition(list, 0)).toEqual({ position: 50, hasRoom: true })
  })

  it('goes one step past the last undated task at the end', () => {
    const list = [task('a', 100), task('b', 300)]
    expect(insertPosition(list, 2)).toEqual({ position: 300 + POSITION_STEP / 2, hasRoom: true })
  })

  it('looks past dated tasks, whose positions mean nothing', () => {
    const list = [task('dated', 9_999_999, DUE), task('a', 100), task('b', 300)]
    expect(insertPosition(list, 1).position).toBe(50)
  })

  it('has no room between two tasks that share a position', () => {
    const list = [task('a', 0), task('b', 0)]
    expect(insertPosition(list, 1).hasRoom).toBe(false)
    expect(insertPosition([task('a', 7), task('b', 7)], 1).hasRoom).toBe(false)
  })

  it('has no room between positions closer than the minimum gap', () => {
    expect(MIN_POSITION_GAP).toBeGreaterThan(0)
    const list = [task('a', 10), task('b', 10 + MIN_POSITION_GAP / 2)]
    expect(insertPosition(list, 1).hasRoom).toBe(false)
    const roomy = [task('a', 10), task('b', 10 + MIN_POSITION_GAP * 2)]
    expect(insertPosition(roomy, 1).hasRoom).toBe(true)
  })
})

describe('planMove', () => {
  it('changes only the moved task when there is room', () => {
    const list = [task('a', 100), task('b', 200), task('c', 300)]
    const plan = planMove(list, 2, 0)
    expect(plan.position).toBe(50)
    expect(plan.renumbered).toEqual([])
  })

  // Tasks moved into a project get position 0, all of them; the midpoint between two zeros is
  // zero, so dragging among them changed nothing on screen (the Inbox reorder bug).
  it('spreads tasks that share a position so the drag takes effect', () => {
    const [a, b, c] = [task('a', 0), task('b', 0), task('c', 0)]
    const plan = planMove([a, b, c], 2, 0)
    expect(plan.position).toBe(POSITION_STEP)
    expect(plan.renumbered).toEqual([
      { taskId: a.id, position: 2 * POSITION_STEP },
      { taskId: b.id, position: 3 * POSITION_STEP },
    ])
    const after = sortProjectTasks(applyPlan([a, b, c], c.id, plan))
    expect(after.map((entry) => entry.title)).toEqual(['c', 'a', 'b'])
  })

  it('does not touch dated tasks when it renumbers', () => {
    const dated = task('dated', 0, DUE)
    const [a, b] = [task('a', 0), task('b', 0)]
    const plan = planMove([dated, a, b], 2, 1)
    expect(plan.renumbered.map((entry) => entry.taskId)).not.toContain(dated.id)
  })

  it('does not send positions that stay the same', () => {
    const [a, b, c] = [task('a', POSITION_STEP), task('b', POSITION_STEP), task('c', 3 * POSITION_STEP)]
    // b goes to the end: a and c are separate and have room, only b moves.
    const plan = planMove([a, b, c], 1, 2)
    expect(plan.renumbered).toEqual([])
    // c between a and b: they tie, so everything is spread; a already sits at its spot.
    const spread = planMove([a, b, c], 2, 1)
    expect(spread.renumbered.some((entry) => entry.taskId === a.id)).toBe(false)
  })

  // For every list and every drag, the undated tasks end up in the order the user dropped them in.
  const lists: Array<[string, () => Task[]]> = [
    ['distinct positions', () => [task('a', 100), task('b', 200), task('c', 300), task('d', 400), task('e', 500)]],
    ['all zero', () => [task('a', 0), task('b', 0), task('c', 0), task('d', 0), task('e', 0)]],
    ['some equal', () => [task('a', 10), task('b', 10), task('c', 20), task('d', 20), task('e', 30)]],
    ['almost equal', () => [task('a', 1), task('b', 1.25), task('c', 1.5), task('d', 1.75), task('e', 2)]],
    ['mixed with dated', () => [task('a', 0, DUE), task('b', 0), task('c', 0), task('d', 5, DUE), task('e', 0)]],
  ]

  it.each(lists)('puts undated tasks where they were dropped: %s', (_name, build) => {
    for (let from = 0; from < 5; from++) {
      for (let to = 0; to < 5; to++) {
        if (from === to) continue
        const list = build()
        const moved = list[from]
        if (!isUndatedTask(moved)) continue
        const plan = planMove(list, from, to)
        const without = list.filter((_, index) => index !== from)
        const dropped = [...without.slice(0, to), moved, ...without.slice(to)]
        const expected = dropped.filter(isUndatedTask).map((entry) => entry.title)
        const shown = sortProjectTasks(applyPlan(list, moved.id, plan)).filter(isUndatedTask).map((entry) => entry.title)
        expect(shown, `${_name}: ${from} -> ${to}`).toEqual(expected)
      }
    }
  })
})

describe('applyPositionUpdates', () => {
  it('changes only the listed tasks and leaves the input alone', () => {
    const [a, b, c] = [task('a', 1), task('b', 2), task('c', 3)]
    const before = [a, b, c]
    const after = applyPositionUpdates(before, [{ taskId: b.id, position: 20 }, { taskId: 99, position: 5 }])
    expect(after.map((entry) => entry.position)).toEqual([1, 20, 3])
    expect(after[0]).toBe(a)
    expect(before.map((entry) => entry.position)).toEqual([1, 2, 3])
  })
})

describe('sendPositionUpdates', () => {
  it('sends the other tasks first and the dragged task last, one after the other', async () => {
    const log: string[] = []
    await sendPositionUpdates(
      async (update) => {
        log.push(`start ${update.taskId}`)
        await Promise.resolve()
        log.push(`end ${update.taskId}`)
      },
      { taskId: 1, position: 10 },
      [{ taskId: 2, position: 20 }, { taskId: 3, position: 30 }],
    )
    expect(log).toEqual(['start 2', 'end 2', 'start 3', 'end 3', 'start 1', 'end 1'])
  })

  it('sends only the dragged task when nothing else moves', async () => {
    const sent: number[] = []
    await sendPositionUpdates(async (update) => { sent.push(update.taskId) }, { taskId: 1, position: 10 })
    expect(sent).toEqual([1])
  })

  it('stops at the first failure', async () => {
    const sent: number[] = []
    await expect(sendPositionUpdates(
      async (update) => {
        sent.push(update.taskId)
        if (update.taskId === 2) throw new Error('server said no')
      },
      { taskId: 1, position: 10 },
      [{ taskId: 2, position: 20 }, { taskId: 3, position: 30 }],
    )).rejects.toThrow('server said no')
    expect(sent).toEqual([2])
  })
})
