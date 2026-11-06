import { afterEach, describe, expect, it } from 'vitest'
import {
  canPlaceOn,
  dayAtX,
  dayBlocks,
  dayMarkers,
  dayTopRow,
  dayWithoutTime,
  drawnRange,
  endEdgeRange,
  formatLength,
  grabMode,
  markerOverBlock,
  MIN_ITEM_MINUTES,
  layoutOverlaps,
  minuteAtY,
  movedRange,
  openingMinute,
  plannedMinutes,
  planRangeFilter,
  snapMinutes,
  startEdgeRange,
} from '../planner-timeline'
import { dateOnlyDue } from '../../../shared/due-dates'
import { compileServerFilter } from '../../../shared/__tests__/server-filter-eval'

const NULL_DATE = '0001-01-01T00:00:00Z'
const iso = (local: string) => new Date(local).toISOString()
const DAY = '2026-10-06'
const now = new Date('2026-10-06T10:00:00')

const task = (id: number, due: string = NULL_DATE, start: string = NULL_DATE, end: string = NULL_DATE, done = false) => ({
  id,
  done,
  due_date: due,
  start_date: start,
  end_date: end,
})

const originalTz = process.env.TZ
afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ
  else process.env.TZ = originalTz
})

describe('what a day shows', () => {
  it('knows when a due-time marker lies over a block', () => {
    const blocks = [{ startMinute: 555, drawnMinutes: 30 }]
    expect(markerOverBlock(570, blocks)).toBe(true)
    expect(markerOverBlock(550, blocks)).toBe(true)
    expect(markerOverBlock(590, blocks)).toBe(true)
    expect(markerOverBlock(540, blocks)).toBe(false)
    expect(markerOverBlock(600, blocks)).toBe(false)
    expect(markerOverBlock(570, [])).toBe(false)
  })

  it('places a block by its wall-clock minutes, and an end at the midnight as the end of the day', () => {
    const [block, late] = dayBlocks(
      [
        task(1, NULL_DATE, iso('2026-10-06T09:15:00'), iso('2026-10-06T10:00:00')),
        task(2, NULL_DATE, iso('2026-10-06T23:00:00'), iso('2026-10-07T00:00:00')),
      ],
      DAY,
    )
    expect(block).toMatchObject({ startMinute: 555, endMinute: 600, column: 0, columnCount: 1 })
    expect(late).toMatchObject({ startMinute: 1380, endMinute: 1440 })
  })

  it('leaves out a block on another day and two dates that are not a block', () => {
    const shown = dayBlocks(
      [
        task(1, NULL_DATE, iso('2026-10-07T09:00:00'), iso('2026-10-07T10:00:00')),
        task(2, NULL_DATE, iso('2026-10-06T09:00:00')),
        task(3, NULL_DATE, iso('2026-10-06T09:00:00'), iso('2026-10-09T10:00:00')),
      ],
      DAY,
    )
    expect(shown).toEqual([])
  })

  it('lays out overlapping blocks side by side, and a block after them on its own', () => {
    const shown = dayBlocks(
      [
        task(1, NULL_DATE, iso('2026-10-06T09:00:00'), iso('2026-10-06T10:00:00')),
        task(2, NULL_DATE, iso('2026-10-06T09:30:00'), iso('2026-10-06T10:30:00')),
        task(3, NULL_DATE, iso('2026-10-06T11:00:00'), iso('2026-10-06T11:30:00')),
      ],
      DAY,
    )
    expect(shown.map((b) => [b.task.id, b.column, b.columnCount])).toEqual([
      [1, 0, 2],
      [2, 1, 2],
      [3, 0, 1],
    ])
  })

  it('keeps a short block in the column of the block that starts where it ends', () => {
    const [short, next] = dayBlocks(
      [
        task(1, NULL_DATE, iso('2026-10-06T08:00:00'), iso('2026-10-06T08:15:00')),
        task(2, NULL_DATE, iso('2026-10-06T08:15:00'), iso('2026-10-06T08:45:00')),
      ],
      DAY,
    )
    expect([short.column, short.columnCount, next.column, next.columnCount]).toEqual([0, 1, 0, 1])
    expect(short.drawnMinutes).toBe(15)
    expect(next.drawnMinutes).toBe(30)
  })

  it('draws a short block taller only while the room is free, and never past the day', () => {
    const [alone, close, tail, late] = dayBlocks(
      [
        task(1, NULL_DATE, iso('2026-10-06T08:00:00'), iso('2026-10-06T08:15:00')),
        task(2, NULL_DATE, iso('2026-10-06T10:00:00'), iso('2026-10-06T10:15:00')),
        task(3, NULL_DATE, iso('2026-10-06T10:20:00'), iso('2026-10-06T11:00:00')),
        task(4, NULL_DATE, iso('2026-10-06T23:45:00'), iso('2026-10-07T00:00:00')),
      ],
      DAY,
    )
    expect(alone.drawnMinutes).toBe(MIN_ITEM_MINUTES)
    expect(close.drawnMinutes).toBe(20)
    expect(tail.drawnMinutes).toBe(40)
    expect(late.drawnMinutes).toBe(15)
  })

  it('reuses a column that has become free in a group', () => {
    const items = [
      { startMinute: 0, endMinute: 60, column: 0, columnCount: 1 },
      { startMinute: 30, endMinute: 120, column: 0, columnCount: 1 },
      { startMinute: 60, endMinute: 90, column: 0, columnCount: 1 },
    ]
    expect(layoutOverlaps(items).map((b) => [b.column, b.columnCount])).toEqual([
      [0, 2],
      [1, 2],
      [0, 2],
    ])
  })

  it('a due time with no block is a marker; a date-only one and a done one are not', () => {
    const markers = dayMarkers(
      [
        task(1, iso('2026-10-06T14:00:00')),
        task(2, dateOnlyDue(DAY)),
        task(3, iso('2026-10-06T15:00:00'), NULL_DATE, NULL_DATE, true),
        task(4, iso('2026-10-06T16:00:00'), iso('2026-10-06T09:00:00'), iso('2026-10-06T10:00:00')),
        task(5, iso('2026-10-07T14:00:00')),
      ],
      DAY,
    )
    expect(markers.map((m) => [m.task.id, m.minute])).toEqual([[1, 840]])
  })

  it('the top row holds the day\'s date-only tasks without a block on that day', () => {
    const row = dayTopRow(
      [
        task(1, dateOnlyDue(DAY)),
        task(2, dateOnlyDue(DAY), iso('2026-10-06T09:00:00'), iso('2026-10-06T10:00:00')),
        task(3, iso('2026-10-06T14:00:00')),
        task(4, dateOnlyDue('2026-10-05')),
        task(5, dateOnlyDue(DAY), iso('2026-10-07T09:00:00'), iso('2026-10-07T10:00:00')),
      ],
      DAY,
    )
    expect(row.map((t) => t.id)).toEqual([1, 5])
  })

  it('the first list holds the selected day without a time, with overdue tasks only on today', () => {
    const tasks = [
      task(1, dateOnlyDue(DAY)),
      task(2, dateOnlyDue('2026-10-05')),
      task(3, iso('2026-10-05T14:00:00')),
      task(4, iso('2026-10-06T14:00:00')),
      task(5, dateOnlyDue(DAY), iso('2026-10-06T09:00:00'), iso('2026-10-06T10:00:00')),
      task(6, dateOnlyDue(DAY), NULL_DATE, NULL_DATE, true),
      task(7, dateOnlyDue('2026-10-07')),
      task(8),
    ]
    expect(dayWithoutTime(tasks, DAY, now).map((t) => t.id)).toEqual([1, 2, 3])
    expect(dayWithoutTime(tasks, '2026-10-07', now).map((t) => t.id)).toEqual([7])
    expect(dayWithoutTime(tasks, DAY, now, (t) => t.id === 6).map((t) => t.id)).toEqual([1, 2, 3, 6])
  })

  it('adds up the open blocks of a day', () => {
    const tasks = [
      task(1, NULL_DATE, iso('2026-10-06T09:00:00'), iso('2026-10-06T09:45:00')),
      task(2, NULL_DATE, iso('2026-10-06T11:00:00'), iso('2026-10-06T12:00:00')),
      task(3, NULL_DATE, iso('2026-10-06T13:00:00'), iso('2026-10-06T14:00:00'), true),
    ]
    expect(plannedMinutes(tasks, DAY)).toBe(105)
    expect(formatLength(105)).toBe('1h 45m')
    expect(formatLength(45)).toBe('45m')
    expect(formatLength(60)).toBe('1h')
  })
})

describe('the request for a view', () => {
  for (const zone of ['Pacific/Auckland', 'America/New_York']) {
    it(`takes blocks in range, open tasks due in range, and overdue when today is shown (${zone})`, () => {
      process.env.TZ = zone
      const days = ['2026-10-06', '2026-10-07', '2026-10-08']
      const shown = compileServerFilter(planRangeFilter(days, '2026-10-06'))
      const row = (due: string, start?: string, done = false) => ({
        done,
        project_id: 1,
        due_date: due,
        start_date: start ?? NULL_DATE,
      })
      expect(shown(row(dateOnlyDue('2026-10-08')))).toBe(true)
      expect(shown(row(dateOnlyDue('2026-10-09')))).toBe(false)
      expect(shown(row(dateOnlyDue('2026-10-01')))).toBe(true) // overdue, today is shown
      expect(shown(row(NULL_DATE))).toBe(false)
      expect(shown(row(NULL_DATE, iso('2026-10-07T09:00:00')))).toBe(true)
      expect(shown(row(NULL_DATE, iso('2026-10-07T09:00:00'), true))).toBe(true) // a done block stays
      expect(shown(row(dateOnlyDue('2026-10-07'), undefined, true))).toBe(false)

      const later = compileServerFilter(planRangeFilter(['2026-10-07'], '2026-10-06'))
      expect(later(row(dateOnlyDue('2026-10-01')))).toBe(false) // overdue stays out of another day
    })
  }
})

describe('gestures', () => {
  const range = { startMinute: 540, endMinute: 570 }

  it('moves land on a 15-minute line, keep their length and stay inside the day', () => {
    expect(snapMinutes(547)).toBe(540)
    expect(snapMinutes(548)).toBe(555)
    expect(movedRange(range, 16)).toEqual({ startMinute: 555, endMinute: 585 })
    expect(movedRange({ startMinute: 550, endMinute: 580 }, 0)).toEqual({ startMinute: 555, endMinute: 585 })
    expect(movedRange(range, -2000)).toEqual({ startMinute: 0, endMinute: 30 })
    expect(movedRange(range, 2000)).toEqual({ startMinute: 1410, endMinute: 1440 })
  })

  it('the top edge moves the start only, at least one step, at most 12 hours', () => {
    expect(startEdgeRange(range, 500)).toEqual({ startMinute: 495, endMinute: 570 })
    expect(startEdgeRange(range, 600)).toEqual({ startMinute: 555, endMinute: 570 })
    expect(startEdgeRange({ startMinute: 800, endMinute: 900 }, 0)).toEqual({ startMinute: 180, endMinute: 900 })
  })

  it('the bottom edge moves the end only, at least one step, at most 12 hours and the midnight', () => {
    expect(endEdgeRange(range, 610)).toEqual({ startMinute: 540, endMinute: 615 })
    expect(endEdgeRange(range, 100)).toEqual({ startMinute: 540, endMinute: 555 })
    expect(endEdgeRange({ startMinute: 60, endMinute: 90 }, 1440)).toEqual({ startMinute: 60, endMinute: 780 })
    expect(endEdgeRange({ startMinute: 1400, endMinute: 1420 }, 1440)).toEqual({ startMinute: 1400, endMinute: 1440 })
  })

  it('draws in either direction and stays within a block', () => {
    expect(drawnRange(540, 600)).toEqual({ startMinute: 540, endMinute: 600 })
    expect(drawnRange(540, 480)).toEqual({ startMinute: 480, endMinute: 540 })
    expect(drawnRange(540, 541)).toEqual({ startMinute: 540, endMinute: 555 })
    expect(drawnRange(60, 1440)).toEqual({ startMinute: 60, endMinute: 780 })
    expect(drawnRange(1440, 1440)).toEqual({ startMinute: 1425, endMinute: 1440 })
  })

  it('grabs the edges of a block, and the whole of a marker', () => {
    expect(grabMode(3, 60, true)).toBe('start')
    expect(grabMode(56, 60, true)).toBe('end')
    expect(grabMode(30, 60, true)).toBe('move')
    expect(grabMode(3, 60, false)).toBe('move')
    // A 15-minute block still has a middle to move it by.
    expect(grabMode(7, 14, true)).toBe('move')
    expect(grabMode(2, 14, true)).toBe('start')
    expect(grabMode(12, 14, true)).toBe('end')
  })

  it('finds the day column and the minute under the pointer', () => {
    const days = ['a', 'b', 'c']
    expect(dayAtX(days, 100, 100, 300)).toBe('a')
    expect(dayAtX(days, 250, 100, 300)).toBe('b')
    expect(dayAtX(days, 399, 100, 300)).toBe('c')
    expect(dayAtX(days, 99, 100, 300)).toBeNull()
    expect(dayAtX(days, 400, 100, 300)).toBeNull()
    expect(minuteAtY(160, 100)).toBe(60)
    expect(minuteAtY(50, 100)).toBe(0)
    expect(minuteAtY(5000, 100)).toBe(1440)
  })

  it('never places on a past day, and opens near now on today', () => {
    expect(canPlaceOn('2026-10-05', DAY)).toBe(false)
    expect(canPlaceOn(DAY, DAY)).toBe(true)
    expect(openingMinute(DAY, new Date(2026, 9, 6, 10, 0), DAY, 480)).toBe(540)
    expect(openingMinute('2026-10-07', new Date(2026, 9, 6, 10, 0), DAY, 480)).toBe(480)
    expect(openingMinute(DAY, new Date(2026, 9, 6, 0, 20), DAY, 480)).toBe(0)
  })
})
