import { describe, expect, it } from 'vitest'
import { preferOwnRoutineCarriers } from '../routines'

const ME = 7
function carrier(taskId: number, createdBy: number, routineId: string) {
  return { task: { id: taskId, created_by: { id: createdBy } }, payload: { definition: { id: routineId } as never } }
}

describe('preferOwnRoutineCarriers (review S-5)', () => {
  it('keeps the user\'s own carrier over another member\'s with the same routine id', () => {
    const mine = carrier(10, ME, 'r1')
    const copy = carrier(99, 8, 'r1')
    expect(preferOwnRoutineCarriers([copy, mine], ME)).toEqual([mine])
  })

  it('keeps the oldest carrier when only other members have the id', () => {
    const owner = carrier(20, 8, 'r2')
    const copy = carrier(21, 9, 'r2')
    expect(preferOwnRoutineCarriers([copy, owner], ME)).toEqual([owner])
  })

  it('leaves routines with one carrier, and the user\'s own duplicates, as they are', () => {
    const list = [carrier(1, ME, 'a'), carrier(2, 8, 'b'), carrier(3, ME, 'c'), carrier(4, ME, 'c')]
    expect(preferOwnRoutineCarriers(list, ME)).toEqual(list)
  })

  it('treats nothing as the user\'s own until the user is known', () => {
    const first = carrier(5, ME, 'r')
    const second = carrier(6, 8, 'r')
    expect(preferOwnRoutineCarriers([second, first], null)).toEqual([first])
  })
})
