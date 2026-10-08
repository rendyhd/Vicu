import { describe, expect, it } from 'vitest'
import { pillSlide } from '../selection-pill-logic'

const box = (left: number, top: number, width = 200, height = 32) => ({ left, top, width, height })

describe('pillSlide', () => {
  it('puts the new pill where the old one was', () => {
    expect(pillSlide(box(8, 100), box(8, 164))).toEqual({ dx: 0, dy: -64, sx: 1, sy: 1 })
  })
  it('scales to the old size when the items differ in height', () => {
    const slide = pillSlide(box(8, 100, 200, 32), box(8, 400, 200, 28))
    expect(slide?.dy).toBe(-300)
    expect(slide?.sy).toBeCloseTo(32 / 28, 6)
  })
  it('is null when nothing moved or the new pill has no size', () => {
    expect(pillSlide(box(8, 100), box(8, 100))).toBeNull()
    expect(pillSlide(box(8, 100), box(8, 100, 0, 0))).toBeNull()
  })
})
