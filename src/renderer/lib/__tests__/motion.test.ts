import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SPRINGS, flipDelta, parseCssTime, pointerVelocity, sampleSpring, springOffset } from '../motion'

const fixture = JSON.parse(readFileSync(resolve(__dirname, '..', '..', '..', '..', 'test-fixtures', 'design-tokens-v1.json'), 'utf-8'))

describe('parseCssTime', () => {
  it('reads ms and s', () => {
    expect(parseCssTime('150ms')).toBe(150)
    expect(parseCssTime(' 0.24s ')).toBe(240)
    expect(parseCssTime('90ms')).toBe(90)
  })
  it('is 0 for anything else', () => {
    expect(parseCssTime('')).toBe(0)
    expect(parseCssTime('fast')).toBe(0)
    expect(parseCssTime('12')).toBe(0)
  })
})

describe('SPRINGS', () => {
  it('equal the spring tokens of the contract', () => {
    expect(SPRINGS.move).toEqual(fixture.motion.move.spring)
    expect(SPRINGS['move-expressive']).toEqual(fixture.motion.moveExpressive.spring)
    expect(SPRINGS.pop).toEqual(fixture.motion.pop.spring)
  })
})

describe('springOffset', () => {
  it('starts at the offset, ends at rest', () => {
    for (const spring of Object.values(SPRINGS)) {
      expect(springOffset(spring, 80, 0, 0)).toBeCloseTo(80, 6)
      expect(Math.abs(springOffset(spring, 80, 0, 3))).toBeLessThan(0.001)
    }
  })

  it('starts with the given velocity', () => {
    const spring = SPRINGS.move
    const dt = 0.0005
    const speed = (springOffset(spring, 10, -300, dt) - springOffset(spring, 10, -300, 0)) / dt
    expect(speed).toBeCloseTo(-300, -1)
  })

  it('handles critical and over-damped springs', () => {
    expect(springOffset({ damping: 1, stiffness: 1600 }, 50, 0, 0)).toBeCloseTo(50, 6)
    expect(Math.abs(springOffset({ damping: 1, stiffness: 1600 }, 50, 0, 2))).toBeLessThan(0.001)
    expect(springOffset({ damping: 1.5, stiffness: 700 }, 50, 0, 0)).toBeCloseTo(50, 6)
    expect(Math.abs(springOffset({ damping: 1.5, stiffness: 700 }, 50, 0, 3))).toBeLessThan(0.001)
  })

  it('overshoots only when under-damped (the pop spring does, a critical one does not)', () => {
    const min = (spring: { damping: number; stiffness: number }) =>
      Math.min(...Array.from({ length: 200 }, (_, i) => springOffset(spring, 100, 0, i / 100)))
    expect(min(SPRINGS.pop)).toBeLessThan(-1)
    expect(min({ damping: 1, stiffness: 1600 })).toBeGreaterThan(-0.001)
  })

  it('carries a release velocity past the target when it is fast enough', () => {
    // Released 20 px away and moving towards the slot fast: it overshoots the slot a little.
    const fast = Math.min(...Array.from({ length: 200 }, (_, i) => springOffset(SPRINGS['move-expressive'], 20, -2500, i / 100)))
    const still = Math.min(...Array.from({ length: 200 }, (_, i) => springOffset(SPRINGS['move-expressive'], 20, 0, i / 100)))
    expect(fast).toBeLessThan(still)
  })
})

describe('sampleSpring', () => {
  it('ends exactly at rest within the cap', () => {
    const s = sampleSpring(SPRINGS['move-expressive'], 60, 0)
    expect(s.values[0]).toBeCloseTo(60, 6)
    expect(s.values[s.values.length - 1]).toBe(0)
    expect(s.durationMs).toBe((s.values.length - 1) * s.stepMs)
    expect(s.durationMs).toBeGreaterThan(100)
    expect(s.durationMs).toBeLessThanOrEqual(1200)
  })

  it('keeps going while a fast spring passes through rest', () => {
    // Released at the slot, moving fast: it must travel before settling, not stop at the first sample.
    const s = sampleSpring(SPRINGS.move, 0, 1800)
    expect(s.values.length).toBeGreaterThan(5)
    expect(Math.max(...s.values.map(Math.abs))).toBeGreaterThan(5)
  })

  it('has a single sample for a spring already at rest', () => {
    const s = sampleSpring(SPRINGS.move, 0, 0)
    expect(s.values[s.values.length - 1]).toBe(0)
    expect(s.durationMs).toBeLessThanOrEqual(48)
  })
})

describe('pointerVelocity', () => {
  it('is zero for fewer than two samples', () => {
    expect(pointerVelocity([])).toEqual({ x: 0, y: 0 })
    expect(pointerVelocity([{ t: 0, x: 1, y: 1 }])).toEqual({ x: 0, y: 0 })
  })

  it('uses the last 100 ms', () => {
    const samples = [
      { t: 0, x: 0, y: 0 },
      { t: 400, x: 0, y: 400 },
      { t: 450, x: 0, y: 410 },
      { t: 500, x: 0, y: 420 },
    ]
    const v = pointerVelocity(samples)
    expect(v.x).toBe(0)
    expect(v.y).toBeCloseTo(200, 6)
  })

  it('is zero when the samples share a timestamp', () => {
    expect(pointerVelocity([{ t: 5, x: 0, y: 0 }, { t: 5, x: 9, y: 9 }])).toEqual({ x: 0, y: 0 })
  })
})

describe('flipDelta', () => {
  const box = (left: number, top: number) => ({ left, top, width: 100, height: 30 })
  it('is the shift that puts the element back where it was', () => {
    expect(flipDelta(box(10, 100), box(10, 160))).toEqual({ dx: 0, dy: -60 })
    expect(flipDelta(box(0, 0), box(25, 0))).toEqual({ dx: -25, dy: 0 })
  })
  it('is null when it did not move (or moved less than half a pixel)', () => {
    expect(flipDelta(box(5, 5), box(5, 5))).toBeNull()
    expect(flipDelta(box(5, 5), box(5.2, 5.3))).toBeNull()
  })
})

describe('travelStart', () => {
  it('starts the chip at the token: centre shift and a scale between 0.5 and 1', async () => {
    const { travelStart } = await import('../motion')
    const token = { left: 100, top: 10, width: 60, height: 18 }
    const chip = { left: 20, top: 60, width: 80, height: 22 }
    const from = travelStart(token, chip)
    expect(from.dx).toBeCloseTo(130 - 60, 6)
    expect(from.dy).toBeCloseTo(19 - 71, 6)
    expect(from.scale).toBeCloseTo(0.75, 6)
    expect(travelStart({ ...token, width: 10 }, chip).scale).toBe(0.5)
    expect(travelStart({ ...token, width: 300 }, chip).scale).toBe(1)
  })
})
