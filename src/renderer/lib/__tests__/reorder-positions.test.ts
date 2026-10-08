import { describe, expect, it } from 'vitest'
import { NULL_DATE } from '../constants'
import { sortProjectTasks } from '../task-sort'
import {
  planInsertedSibling,
  MIN_POSITION_GAP,
  POSITION_STEP,
  applyPositionUpdates,
  insertPosition,
  isUndatedTask,
  planMove,
  planSiblingMove,
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

describe('planSiblingMove (sidebar projects and sections)', () => {
  let nextProjectId = 100
  const project = (position: number) => ({ id: nextProjectId++, position })
  /** Apply a plan and read the order the sidebar would show (a stable sort by position). */
  function shownOrder(
    siblings: Array<{ id: number; position: number }>,
    movedId: number,
    plan: { position: number; renumbered: Array<{ id: number; position: number }> },
  ): number[] {
    const positions = new Map(plan.renumbered.map((entry) => [entry.id, entry.position]))
    positions.set(movedId, plan.position)
    return siblings
      .map((entry) => ({ ...entry, position: positions.get(entry.id) ?? entry.position }))
      .sort((a, b) => a.position - b.position)
      .map((entry) => entry.id)
  }

  it('changes only the dragged project when there is room', () => {
    const [a, b, c] = [project(100), project(200), project(300)]
    expect(planSiblingMove([a, b, c], 2, 0)).toEqual({ position: 50, renumbered: [] })
    expect(planSiblingMove([a, b, c], 0, 1)).toEqual({ position: 250, renumbered: [] })
    expect(planSiblingMove([a, b, c], 0, 2)).toEqual({ position: 300 + POSITION_STEP / 2, renumbered: [] })
  })

  it('spreads siblings that share a position so the drag takes effect', () => {
    const [a, b, c] = [project(0), project(0), project(0)]
    const plan = planSiblingMove([a, b, c], 2, 0)
    expect(plan.position).toBe(POSITION_STEP)
    expect(plan.renumbered).toEqual([
      { id: a.id, position: 2 * POSITION_STEP },
      { id: b.id, position: 3 * POSITION_STEP },
    ])
    expect(shownOrder([a, b, c], c.id, plan)).toEqual([c.id, a.id, b.id])
  })

  it('does not send positions that stay the same', () => {
    const [a, b, c] = [project(POSITION_STEP), project(POSITION_STEP), project(3 * POSITION_STEP)]
    // c between a and b: they tie, so all are spread; a already sits at its spot.
    const plan = planSiblingMove([a, b, c], 2, 1)
    expect(plan.renumbered.some((entry) => entry.id === a.id)).toBe(false)
    expect(shownOrder([a, b, c], c.id, plan)).toEqual([a.id, c.id, b.id])
  })

  const lists: Array<[string, () => Array<{ id: number; position: number }>]> = [
    ['distinct positions', () => [100, 200, 300, 400, 500].map(project)],
    ['all zero', () => [0, 0, 0, 0, 0].map(project)],
    ['some equal', () => [10, 10, 20, 20, 30].map(project)],
    ['almost equal', () => [1, 1.25, 1.5, 1.75, 2].map(project)],
  ]

  it.each(lists)('puts the project where it was dropped: %s', (name, build) => {
    for (let from = 0; from < 5; from++) {
      for (let to = 0; to < 5; to++) {
        if (from === to) continue
        const list = build()
        const moved = list[from]
        const plan = planSiblingMove(list, from, to)
        const without = list.filter((_, index) => index !== from)
        const expected = [...without.slice(0, to), moved, ...without.slice(to)].map((entry) => entry.id)
        expect(shownOrder(list, moved.id, plan), `${name}: ${from} -> ${to}`).toEqual(expected)
      }
    }
  })
})

describe('sendPositionUpdates with any update shape', () => {
  it('sends the other siblings first and the dragged project last', async () => {
    const sent: number[] = []
    await sendPositionUpdates(
      async (update: { id: number; position: number }) => { sent.push(update.id) },
      { id: 1, position: 10 },
      [{ id: 2, position: 20 }, { id: 3, position: 30 }],
    )
    expect(sent).toEqual([2, 3, 1])
  })
})

describe('planInsertedSibling', () => {
  const sections = [
    { id: 1, position: 65536 },
    { id: 2, position: 131072 },
    { id: 3, position: 196608 },
  ]

  it('leaves a section added at the end where the server put it', () => {
    expect(planInsertedSibling(sections, { id: 9, position: 262144 }, 3)).toBeNull()
  })

  it('puts a section between two others at the middle of their positions', () => {
    expect(planInsertedSibling(sections, { id: 9, position: 262144 }, 1)).toEqual({ position: 98304, renumbered: [] })
  })

  it('puts a section first before the first one', () => {
    const plan = planInsertedSibling(sections, { id: 9, position: 262144 }, 0)
    expect(plan?.position).toBe(32768)
  })

  it('spreads the siblings when there is no room between neighbours', () => {
    const tight = [{ id: 1, position: 1 }, { id: 2, position: 1 }]
    const plan = planInsertedSibling(tight, { id: 9, position: 5 }, 1)
    expect(plan?.renumbered.length).toBeGreaterThan(0)
  })
})
