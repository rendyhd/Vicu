import { afterEach, describe, expect, it } from 'vitest'
import {
  addMonths,
  comingSaturday,
  dueOfWhenValue,
  focusStaysInside,
  monthGrid,
  monthStart,
  moveGridFocus,
  parseTimeText,
  parseWhenText,
  quickChoices,
  timeLabel,
  whenText,
  whenValueOfDue,
  withDate,
  withTime,
  EMPTY_WHEN,
} from '../when-logic'
import { dateOnlyDue } from '../due-dates'

const originalTz = process.env.TZ
afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ
  else process.env.TZ = originalTz
})

const US = { locale: 'en-US', hour12: true }
const GB = { locale: 'en-GB', hour12: false }
// Wednesday 7 October 2026, mid-morning.
const NOW = new Date(2026, 9, 7, 10, 30)

describe('parseTimeText', () => {
  it('reads clock times in both styles', () => {
    expect(parseTimeText('15:30')).toBe('15:30')
    expect(parseTimeText('3pm')).toBe('15:00')
    expect(parseTimeText('3:30 pm')).toBe('15:30')
    expect(parseTimeText('12am')).toBe('00:00')
    expect(parseTimeText('12pm')).toBe('12:00')
    expect(parseTimeText('7')).toBe('07:00')
    expect(parseTimeText(' 9.15 ')).toBe('09:15')
  })

  it('rejects what is not a time', () => {
    for (const text of ['', 'noon', '25:00', '13pm', '0am', '10:75', 'tomorrow']) {
      expect(parseTimeText(text), text).toBeNull()
    }
  })
})

describe('value and due date', () => {
  it('a day without a time is the date-only due date', () => {
    expect(dueOfWhenValue({ date: '2026-10-20', time: null })).toBe(dateOnlyDue('2026-10-20'))
  })

  it('a day with a time is that local minute', () => {
    const due = dueOfWhenValue({ date: '2026-10-20', time: '15:30' })!
    const at = new Date(due)
    expect([at.getFullYear(), at.getMonth(), at.getDate(), at.getHours(), at.getMinutes(), at.getSeconds()]).toEqual([2026, 9, 20, 15, 30, 0])
  })

  it('no day means clear the due date', () => {
    expect(dueOfWhenValue(EMPTY_WHEN)).toBeNull()
    expect(dueOfWhenValue({ date: null, time: '09:00' })).toBeNull()
  })

  it('reads a stored due date back, date-only values included', () => {
    expect(whenValueOfDue(dateOnlyDue('2026-10-20'))).toEqual({ date: '2026-10-20', time: null })
    expect(whenValueOfDue(dueOfWhenValue({ date: '2026-10-20', time: '15:30' }))).toEqual({ date: '2026-10-20', time: '15:30' })
    expect(whenValueOfDue('0001-01-01T00:00:00Z')).toEqual(EMPTY_WHEN)
    expect(whenValueOfDue(null)).toEqual(EMPTY_WHEN)
    // Legacy date-only values sit at local midnight.
    expect(whenValueOfDue(new Date(2026, 9, 20, 0, 0, 0).toISOString())).toEqual({ date: '2026-10-20', time: null })
  })

  it('uses the local day in any time zone, never the UTC day', () => {
    for (const tz of ['Pacific/Auckland', 'America/New_York']) {
      process.env.TZ = tz
      const due = dueOfWhenValue({ date: '2026-10-20', time: '23:30' })
      expect(whenValueOfDue(due), tz).toEqual({ date: '2026-10-20', time: '23:30' })
      expect(whenValueOfDue(dateOnlyDue('2026-10-20')), tz).toEqual({ date: '2026-10-20', time: null })
    }
  })

  it('keeps the time when the day changes and starts from today when a time is picked first', () => {
    expect(withDate({ date: '2026-10-07', time: '15:00' }, '2026-10-09')).toEqual({ date: '2026-10-09', time: '15:00' })
    expect(withTime(EMPTY_WHEN, '09:00', '2026-10-07')).toEqual({ date: '2026-10-07', time: '09:00' })
    expect(withTime({ date: '2026-10-09', time: '09:00' }, null, '2026-10-07')).toEqual({ date: '2026-10-09', time: null })
  })
})

describe('month grid', () => {
  it('has six Monday-first weeks around the month', () => {
    const grid = monthGrid('2026-10-15')
    expect(grid).toHaveLength(6)
    expect(grid.every((row) => row.length === 7)).toBe(true)
    // 1 October 2026 is a Thursday: the first row starts on Monday 28 September.
    expect(grid[0][0]).toEqual({ date: '2026-09-28', inMonth: false })
    expect(grid[0][3]).toEqual({ date: '2026-10-01', inMonth: true })
    expect(grid[5][6].date).toBe('2026-11-08')
    expect(grid.flat().filter((d) => d.inMonth)).toHaveLength(31)
  })

  it('handles a month that starts on Monday and February in a leap year', () => {
    expect(monthGrid('2026-06-10')[0][0]).toEqual({ date: '2026-06-01', inMonth: true })
    expect(monthGrid('2028-02-01').flat().filter((d) => d.inMonth)).toHaveLength(29)
  })

  it('moves by months and clamps the day', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29')
    expect(addMonths('2026-10-15', -10)).toBe('2025-12-15')
    expect(addMonths('2026-12-05', 1)).toBe('2027-01-05')
    expect(monthStart('2026-10-15')).toBe('2026-10-01')
  })

  it('moves the focused day with the keys', () => {
    expect(moveGridFocus('2026-10-15', 'ArrowRight')).toBe('2026-10-16')
    expect(moveGridFocus('2026-10-15', 'ArrowLeft')).toBe('2026-10-14')
    expect(moveGridFocus('2026-10-15', 'ArrowDown')).toBe('2026-10-22')
    expect(moveGridFocus('2026-10-15', 'ArrowUp')).toBe('2026-10-08')
    expect(moveGridFocus('2026-10-31', 'ArrowRight')).toBe('2026-11-01')
    expect(moveGridFocus('2026-10-15', 'PageDown')).toBe('2026-11-15')
    expect(moveGridFocus('2026-03-31', 'PageDown')).toBe('2026-04-30')
    expect(moveGridFocus('2026-10-15', 'PageUp')).toBe('2026-09-15')
    expect(moveGridFocus('2026-10-15', 'PageUp', true)).toBe('2025-10-15')
    // Thursday 15 October: the week runs Monday 12 to Sunday 18.
    expect(moveGridFocus('2026-10-15', 'Home')).toBe('2026-10-12')
    expect(moveGridFocus('2026-10-15', 'End')).toBe('2026-10-18')
    expect(moveGridFocus('2026-10-15', 'a')).toBeNull()
    expect(moveGridFocus('2026-10-15', 'Enter')).toBeNull()
  })
})

describe('quick choices', () => {
  it('are computed from today with their weekdays', () => {
    const choices = quickChoices('2026-10-07', US)
    expect(choices.map((c) => [c.id, c.date, c.hint])).toEqual([
      ['today', '2026-10-07', 'Wed'],
      ['tomorrow', '2026-10-08', 'Thu'],
      ['weekend', '2026-10-10', 'Sat'],
      ['nextWeek', '2026-10-12', 'Mon 12'],
    ])
    expect(choices.map((c) => c.label)).toEqual(['Today', 'Tomorrow', 'This weekend', 'Next week'])
  })

  it('this weekend is always ahead: on a Saturday it is the next Saturday', () => {
    expect(comingSaturday('2026-10-10')).toBe('2026-10-17')
    expect(comingSaturday('2026-10-11')).toBe('2026-10-17')
    expect(comingSaturday('2026-10-12')).toBe('2026-10-17')
    expect(comingSaturday('2026-10-09')).toBe('2026-10-10')
  })

  it('next week on a Sunday is the next day', () => {
    expect(quickChoices('2026-10-11', GB).find((c) => c.id === 'nextWeek')!.date).toBe('2026-10-12')
  })
})

describe('text to selection', () => {
  it('reads "tomorrow 9am" as tomorrow at 09:00', () => {
    expect(parseWhenText('tomorrow 9am', NOW, 'en-US')!.value).toEqual({ date: '2026-10-08', time: '09:00' })
  })

  it('reads "next mon" as the coming Monday, date-only', () => {
    expect(parseWhenText('next mon', NOW, 'en-US')!.value).toEqual({ date: '2026-10-12', time: null })
  })

  it('reads weekdays, dates and times', () => {
    expect(parseWhenText('saturday 3pm', NOW, 'en-US')!.value).toEqual({ date: '2026-10-10', time: '15:00' })
    expect(parseWhenText('oct 20', NOW, 'en-US')!.value).toEqual({ date: '2026-10-20', time: null })
    expect(parseWhenText('20/10', NOW, 'en-GB')!.value).toEqual({ date: '2026-10-20', time: null })
    expect(parseWhenText('today', NOW, 'en-US')!.value).toEqual({ date: '2026-10-07', time: null })
    expect(parseWhenText('in 2 days', NOW, 'en-US')!.value.date).toBe('2026-10-09')
  })

  it('finds nothing in text without a date', () => {
    expect(parseWhenText('', NOW)).toBeNull()
    expect(parseWhenText('   ', NOW)).toBeNull()
    expect(parseWhenText('buy milk', NOW)).toBeNull()
    expect(parseWhenText('weekend', NOW)).toBeNull()
  })

  it('what the panel writes for a pick reads back as the same pick', () => {
    const picks = [
      { date: '2026-10-20', time: null },
      { date: '2026-10-20', time: '15:00' },
      { date: '2026-10-10', time: '09:30' },
      { date: '2026-12-31', time: null },
      { date: '2027-01-04', time: '18:00' },
    ]
    for (const fmt of [US, GB]) {
      for (const pick of picks) {
        const text = whenText(pick, NOW, fmt)
        expect(parseWhenText(text, NOW, fmt.locale)?.value, `${fmt.locale}: "${text}"`).toEqual(pick)
      }
    }
  })
})

describe('whenText and timeLabel', () => {
  it('uses the chip phrasing in the window clock', () => {
    expect(whenText({ date: '2026-10-10', time: '15:00' }, NOW, GB)).toBe('Sat 10 Oct, 15:00')
    expect(whenText({ date: '2026-10-10', time: '15:00' }, NOW, US)).toBe('Sat, Oct 10, 3:00 PM')
    expect(whenText({ date: '2026-10-10', time: null }, NOW, GB)).toBe('Sat 10 Oct')
    expect(whenText(EMPTY_WHEN, NOW, GB)).toBe('')
  })

  it('labels a time in the window clock', () => {
    expect(timeLabel('09:00', GB)).toBe('09:00')
    expect(timeLabel('15:00', US)).toBe('3:00 PM')
  })
})

describe('focusStaysInside', () => {
  const inside = {}
  const outside = {}
  const panel = { contains: (node: unknown) => node === inside }

  it('is true only when focus moves to a control of the panel', () => {
    expect(focusStaysInside(panel, inside)).toBe(true)
  })

  it('is false for Escape and a press outside, where focus leaves the panel or goes nowhere', () => {
    expect(focusStaysInside(panel, outside)).toBe(false)
    expect(focusStaysInside(panel, null)).toBe(false)
    expect(focusStaysInside(null, inside)).toBe(false)
  })
})
