import { describe, expect, it } from 'vitest'
import { taskDropAnimation } from '../drop-animation'

const timing = { duration: 240, easing: 'cubic-bezier(0.05, 0.7, 0.1, 1)' }

describe('taskDropAnimation', () => {
  it('is a function that travels the overlay into the slot', () => {
    expect(typeof taskDropAnimation(timing, false)).toBe('function')
  })

  it('does not travel under reduced motion (a zero duration is no animation to dnd-kit)', () => {
    expect(taskDropAnimation(timing, true)).toMatchObject({ duration: 0, sideEffects: null })
  })
})
