import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { movedId, readSubtaskOrder, sortSubtasks } from '../subtask-order'

const fixture = JSON.parse(readFileSync(join(process.cwd(), 'test-fixtures', 'cross-app-semantics-v1.json'), 'utf8')) as {
  subtaskOrder: Array<{ name: string; order: unknown; ids: number[]; expect: number[] }>
}

describe('subtaskOrder (contract section 19)', () => {
  for (const vector of fixture.subtaskOrder) {
    it(vector.name, () => {
      const items = vector.ids.map((id) => ({ id }))
      expect(sortSubtasks(items, readSubtaskOrder(vector.order)).map((item) => item.id)).toEqual(vector.expect)
    })
  }

  it('moves an id by a place, and not past the ends', () => {
    expect(movedId([1, 2, 3], 2, -1)).toEqual([2, 1, 3])
    expect(movedId([1, 2, 3], 2, 1)).toEqual([1, 3, 2])
    expect(movedId([1, 2, 3], 1, -1)).toBeNull()
    expect(movedId([1, 2, 3], 3, 1)).toBeNull()
    expect(movedId([1, 2, 3], 9, 1)).toBeNull()
  })
})
