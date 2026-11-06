import { describe, expect, it } from 'vitest'
import { besidePointer, overlayBesidePointer, rowBandAtPointer } from '../drag-overlay'

const view = { width: 1280, height: 820 }
const chip = { width: 200, height: 40 }
const row = { left: 300, top: 100, right: 1100, bottom: 140, width: 800, height: 40 }

describe('besidePointer', () => {
  it('sits below and to the right of the pointer, clear of it', () => {
    const at = besidePointer({ x: 100, y: 200 }, chip, view)
    expect(at.x).toBeGreaterThan(100)
    expect(at.y).toBeGreaterThan(200)
  })

  it('slides left at the right edge of the window', () => {
    const at = besidePointer({ x: 1270, y: 200 }, chip, view)
    expect(at.x + chip.width).toBeLessThanOrEqual(view.width)
  })

  it('goes above the pointer at the bottom edge', () => {
    const at = besidePointer({ x: 100, y: 810 }, chip, view)
    expect(at.y + chip.height).toBeLessThan(810)
  })

  it('works before the chip is measured', () => {
    expect(besidePointer({ x: 100, y: 200 }, null, null).x).toBeGreaterThan(100)
  })
})

describe('overlayBesidePointer', () => {
  const pressAt = (clientX: number, clientY: number) => ({ clientX, clientY }) as unknown as Event
  const event = pressAt(500, 120)
  const args = (type: string, x: number, y: number, activeNodeRect = row, activatorEvent: Event = event) =>
    ({
      activatorEvent,
      active: { data: { current: { type } } },
      activeNodeRect,
      overlayNodeRect: chip,
      windowRect: view,
      transform: { x, y, scaleX: 1, scaleY: 1 },
    }) as unknown as Parameters<typeof overlayBesidePointer>[0]

  it('moves a task to beside the pointer, measured from where the row started', () => {
    const t = overlayBesidePointer(args('task', 40, 60))
    expect(row.left + t.x).toBeGreaterThan(540)
    expect(row.top + t.y).toBeGreaterThan(180)
  })

  it('follows the pointer one to one', () => {
    const a = overlayBesidePointer(args('task', 0, 0))
    const b = overlayBesidePointer(args('task', 30, 10))
    expect(b.x - a.x).toBe(30)
    expect(b.y - a.y).toBe(10)
  })

  it('keeps the first rect of a drag when the row moves under it', () => {
    const own = pressAt(500, 120)
    const a = overlayBesidePointer(args('task', 0, 0, row, own))
    const b = overlayBesidePointer(args('task', 0, 0, { ...row, top: row.top - 300 }, own))
    expect(b.y).toBe(a.y)
  })

  it('leaves sections and custom lists where the drag puts them', () => {
    const t = overlayBesidePointer(args('section', 40, 60))
    expect([t.x, t.y]).toEqual([40, 60])
  })
})

describe('rowBandAtPointer', () => {
  it('is the row, at the height of the pointer', () => {
    expect(rowBandAtPointer(row, { x: 50, y: 500 })).toEqual({ ...row, top: 480, bottom: 520 })
  })
})
