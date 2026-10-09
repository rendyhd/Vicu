import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  PRIORITY_SLOT_OPACITY,
  SQUARE_BANG_PATH,
  priorityBars,
  priorityMark,
  priorityMarkSvg,
} from '../priority-mark-svg'

// Card 2.2a: the priority mark follows design-tokens-v1.json `priority` and names match Android's
// TaskRowSemantics.priorityDescription.
const tokens = JSON.parse(readFileSync(resolve(__dirname, '..', '..', '..', 'test-fixtures', 'design-tokens-v1.json'), 'utf8'))
const levels = tokens.priority.levels as Record<string, { mark: string; role: string }>

describe('priority mark table', () => {
  it('matches the token file for every level', () => {
    expect(Object.keys(levels)).toEqual(['1', '2', '3', '4', '5'])
    for (const [level, def] of Object.entries(levels)) {
      const spec = priorityMark(Number(level))
      expect(spec?.kind, `kind of ${level}`).toBe(def.mark)
      expect(spec?.role, `role of ${level}`).toBe(def.role)
      expect(def.role in tokens.roles, `${def.role} is a role`).toBe(true)
      expect(spec?.cssVar).toBe(`--${def.role.replaceAll('.', '-')}`)
    }
  })

  it('shows nothing for 0, negatives, out of range and non-integers', () => {
    for (const p of [0, -1, 6, 1.5, Number.NaN, null, undefined]) {
      expect(priorityMark(p as number)).toBeNull()
      expect(priorityMarkSvg(p as number)).toBe('')
    }
  })

  it('uses the spoken names of Android', () => {
    expect([1, 2, 3, 4, 5].map((p) => priorityMark(p)?.name)).toEqual([
      'Low priority',
      'Medium priority',
      'High priority',
      'Urgent priority',
      'Do now priority',
    ])
  })
})

describe('priority mark shapes', () => {
  it('fills one, two or three of the three bar slots', () => {
    expect(priorityBars('bars-1').map((b) => b.on)).toEqual([true, false, false])
    expect(priorityBars('bars-2').map((b) => b.on)).toEqual([true, true, false])
    expect(priorityBars('bars-3').map((b) => b.on)).toEqual([true, true, true])
  })

  it('keeps every bar inside the 14 px box and ascending', () => {
    const bars = priorityBars('bars-3')
    for (const b of bars) {
      expect(b.x).toBeGreaterThanOrEqual(0)
      expect(b.x + b.width).toBeLessThanOrEqual(14)
      expect(b.y + b.height).toBeLessThanOrEqual(14)
    }
    expect(bars.map((b) => b.height)).toEqual([...bars.map((b) => b.height)].sort((a, c) => a - c))
  })

  it('draws the SVG string with a name, currentColor and the faint slots', () => {
    const svg = priorityMarkSvg(2)
    expect(svg).toContain('role="img"')
    expect(svg).toContain('aria-label="Medium priority"')
    expect(svg).toContain('fill="currentColor"')
    expect(svg.match(/<rect/g)).toHaveLength(3)
    expect(svg.match(new RegExp(`fill-opacity="${PRIORITY_SLOT_OPACITY}"`, 'g'))).toHaveLength(1)
  })

  it('draws priority 4 and 5 as the same square with a bang cut out', () => {
    const four = priorityMarkSvg(4)
    expect(four).toContain('fill-rule="evenodd"')
    expect(four).toContain(SQUARE_BANG_PATH)
    expect(priorityMarkSvg(5).replace('Do now priority', 'Urgent priority')).toBe(four)
    expect(priorityMarkSvg(5)).toContain('aria-label="Do now priority"')
  })

  it('scales to the requested size', () => {
    expect(priorityMarkSvg(1, 20)).toContain('width="20" height="20"')
  })
})
