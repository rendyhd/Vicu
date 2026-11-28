import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { dueNextWeek, endOfWeek, isoWeekday, nextWeekDay, startOfWeek } from '../due-dates'
import { buildCustomListServerFilter, filterCustomList } from '../custom-list-filter'
import { readSyncedPref } from '../synced-prefs'
import {
  DEFAULT_WEEK_START,
  WEEK_START_KEY,
  getWeekStart,
  readWeekStart,
  setWeekStart,
  weekStartOffer,
  weekdaysOf,
  writeWeekStart,
  type WeekStart,
} from '../week-start'
import { monthGrid, quickChoices } from '../../renderer/lib/when-logic'
import { isCalendarScheduled } from '../routines'
import { askContextJson } from '../ai/ask'

// The `weekStart` vectors of test-fixtures/cross-app-semantics-v1.json (contract section 2.1):
// reading the stored value, the offer of the Vikunja account's own setting, the month grid and the
// order of weekdays. The weeks themselves are in cross-app-semantics-suite.ts.

interface Block {
  read: Array<{ value: unknown; expect: WeekStart }>
  offer: Array<{ vikunja: number | null; inUse: WeekStart; expect: WeekStart | null }>
  grid: Array<{ month: string; weekStart: WeekStart; first: string; last: string }>
  weekdays: Array<{ weekStart: WeekStart; expect: number[] }>
}

const block = (JSON.parse(readFileSync(join(process.cwd(), 'test-fixtures', 'cross-app-semantics-v1.json'), 'utf8')) as { weekStart: Block }).weekStart

afterEach(() => setWeekStart(DEFAULT_WEEK_START))

describe('week start (contract section 2.1)', () => {
  it('has the vectors', () => {
    expect(block.read.length).toBeGreaterThanOrEqual(7)
    expect(block.offer.length).toBeGreaterThanOrEqual(7)
  })

  for (const vector of block.read) {
    it(`reads ${JSON.stringify(vector.value)} as ${vector.expect}`, () => {
      expect(readWeekStart(vector.value)).toBe(vector.expect)
      expect(readSyncedPref({ [WEEK_START_KEY]: vector.value }, WEEK_START_KEY)).toBe(vector.expect)
    })
  }

  it('writes only Sunday and Saturday: Monday is a reset', () => {
    expect(writeWeekStart('monday')).toBeNull()
    expect(writeWeekStart('sunday')).toBe('sunday')
    expect(writeWeekStart('saturday')).toBe('saturday')
  })

  for (const vector of block.offer) {
    it(`offers ${vector.expect} when Vikunja has ${vector.vikunja} and ${vector.inUse} is in use`, () => {
      expect(weekStartOffer(vector.vikunja, vector.inUse)).toBe(vector.expect)
    })
  }

  for (const vector of block.grid) {
    it(`the grid of ${vector.month} starts on ${vector.weekStart}`, () => {
      const grid = monthGrid(vector.month, vector.weekStart)
      expect(grid).toHaveLength(6)
      expect(grid.every((row) => row.length === 7)).toBe(true)
      expect(grid[0][0].date).toBe(vector.first)
      expect(grid[5][6].date).toBe(vector.last)
    })
  }

  for (const vector of block.weekdays) {
    it(`the weekdays of a ${vector.weekStart} week`, () => {
      expect(weekdaysOf(vector.weekStart)).toEqual(vector.expect)
    })
  }

  it('next week is the Monday in next week whatever the week start', () => {
    // Sunday weeks: Wednesday and Saturday give the coming Monday; a Sunday is already in the new week.
    expect(nextWeekDay('2026-11-18', 'sunday')).toBe('2026-11-23')
    expect(nextWeekDay('2026-11-21', 'sunday')).toBe('2026-11-23')
    expect(nextWeekDay('2026-11-22', 'sunday')).toBe('2026-11-30')
    // Monday weeks: unchanged, a Sunday gives the next day.
    expect(nextWeekDay('2026-11-22', 'monday')).toBe('2026-11-23')
  })

  it('the week helpers use the week start this process holds when none is passed', () => {
    expect(getWeekStart()).toBe('monday')
    expect(endOfWeek('2026-10-06')).toBe('2026-10-11')

    setWeekStart('sunday')
    expect(endOfWeek('2026-10-06')).toBe('2026-10-10')
    expect(isoWeekday(startOfWeek('2026-10-06'))).toBe(7)
    expect(monthGrid('2026-11-01')[0][0].date).toBe('2026-11-01')
    const nextWeek = quickChoices('2026-11-22', { locale: 'en-US', hour12: true }).find((choice) => choice.id === 'nextWeek')
    expect(nextWeek?.date).toBe('2026-11-30')
    expect(dueNextWeek(new Date(2026, 10, 22, 10))).toBe(new Date(2026, 10, 30, 23, 59, 59).toISOString())
    expect(JSON.parse(askContextJson('2026-10-06T10:00', 'UTC', { name: 'Today' }, {})).week_starts).toBe('sunday')

    // A list evaluated without a context follows it too.
    const task = { id: 1, project_id: 1, done: false, due_date: new Date(2026, 9, 11, 23, 59, 59).toISOString(), priority: 0, labels: [] }
    expect(filterCustomList([task], { due_date_filter: 'this_week', include_overdue: false }, '2026-10-06')).toEqual([])
    expect(filterCustomList([task], { due_date_filter: 'this_week', include_overdue: false }, '2026-10-06', { weekStart: 'monday' })).toEqual([task])
  })

  it('a schedule keeps counting its weeks from Monday', () => {
    // Every 2 weeks on Sunday and Monday, from Mon 2026-10-05: Sun 10-18 is in the anchor's second
    // Monday week (off), Mon 10-19 starts the third (on). A Sunday week start must not move that.
    const schedule = { type: 'calendar' as const, weekdays: [1, 7], weekInterval: 2, anchorDate: '2026-10-05' }
    const days = ['2026-10-05', '2026-10-11', '2026-10-12', '2026-10-18', '2026-10-19', '2026-10-25']
    const before = days.map((day) => isCalendarScheduled(schedule, day))
    setWeekStart('sunday')
    expect(days.map((day) => isCalendarScheduled(schedule, day))).toEqual(before)
    expect(before).toEqual([true, true, false, false, true, true])
  })

  it('a rule that rounds to a week is left to the device unless weeks start on Monday', () => {
    const filter = { include_done: true, rule: 'due_date >= now/w && due_date < now/w+1w' }
    const now = new Date(2026, 9, 6, 10)
    expect(buildCustomListServerFilter(filter, now, 'monday')).toContain('now/w')
    expect(buildCustomListServerFilter(filter, now, 'sunday')).toBeUndefined()
    expect(buildCustomListServerFilter({ include_done: true, rule: 'due_date < now/d+1d' }, now, 'sunday')).toContain('now/d')
  })
})
