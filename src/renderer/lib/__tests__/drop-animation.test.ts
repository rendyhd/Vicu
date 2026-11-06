import { describe, expect, it, vi } from 'vitest'
import type { DropAnimationFunction } from '@dnd-kit/core'
import { centreToCentre, taskDropAnimation, type DropLanding } from '../drop-animation'

const timing = { duration: 240, easing: 'cubic-bezier(0.05, 0.7, 0.1, 1)' }

type Args = Parameters<DropAnimationFunction>[0]

function fakeAnimated() {
  return {
    style: { opacity: '', transform: '', transition: '' },
    animate: vi.fn(() => ({ onfinish: null, oncancel: null })),
    isConnected: true,
    getBoundingClientRect: () => ({ left: 300, top: 400, width: 700, height: 40 }),
    querySelector: () => null,
    firstElementChild: null as unknown,
  }
}

function dropArgs() {
  const row = fakeAnimated()
  const chip = fakeAnimated()
  const overlay = fakeAnimated()
  overlay.firstElementChild = chip
  const args = {
    active: { node: row, rect: { left: 300, top: 400, width: 700, height: 40 } },
    dragOverlay: { node: overlay, rect: { left: 100, top: 100, width: 200, height: 40 } },
    transform: { x: -200, y: -300, scaleX: 1, scaleY: 1 },
  } as unknown as Args
  return { args, row, chip, overlay }
}

const run = (reduced: boolean, landing: DropLanding | null) => {
  const animation = taskDropAnimation(timing, reduced, () => landing) as DropAnimationFunction
  const parts = dropArgs()
  animation(parts.args)
  return parts
}

const movesTo = (overlay: ReturnType<typeof fakeAnimated>) => {
  const frames = (overlay.animate.mock.calls[0] as unknown[])[0] as { transform: string }[]
  return frames[frames.length - 1].transform
}

describe('taskDropAnimation', () => {
  it('travels the overlay into the row slot when nothing else was asked for', () => {
    const { overlay, row } = run(false, null)
    expect(movesTo(overlay)).toBe('translate3d(0px, 0px, 0)')
    expect(row.style.opacity).toBe('0')
  })

  it('does not travel under reduced motion', () => {
    const { overlay, chip, row } = run(true, null)
    expect(overlay.animate).not.toHaveBeenCalled()
    expect(chip.animate).not.toHaveBeenCalled()
    expect(row.style.opacity).toBe('')
  })

  it('lands on the target, not on the row, and hides the row', () => {
    const { overlay, chip, row } = run(false, { into: { left: 0, top: 200, width: 100, height: 20 } })
    // From the centre 200,120 to the centre 50,210.
    expect(movesTo(overlay)).toBe('translate3d(-350px, -210px, 0)')
    expect(row.style.opacity).toBe('0')
    expect(chip.animate).toHaveBeenCalledTimes(2)
  })

  it('leaves the row alone when it stays (a label)', () => {
    const { row } = run(false, { into: { left: 0, top: 0, width: 10, height: 10 }, keepsRow: true })
    expect(row.style.opacity).toBe('')
  })

  it('only fades a landing under reduced motion', () => {
    const { overlay, chip, row } = run(true, { into: { left: 0, top: 0, width: 10, height: 10 } })
    expect(overlay.animate).not.toHaveBeenCalled()
    expect(chip.animate).toHaveBeenCalledTimes(1)
    expect(row.style.opacity).toBe('0')
  })

  it('fades in place when there is no target box', () => {
    const { overlay, chip } = run(false, { into: null })
    expect(overlay.animate).not.toHaveBeenCalled()
    expect(chip.animate).toHaveBeenCalledTimes(1)
  })
})

describe('centreToCentre', () => {
  it('is the translation between the two centres', () => {
    expect(centreToCentre({ left: 0, top: 0, width: 10, height: 10 }, { left: 100, top: 50, width: 30, height: 30 })).toEqual({ x: 110, y: 60 })
  })
})
