import { afterEach, describe, expect, it } from 'vitest'
import {
  addLocalDays,
  dateOnlyDue,
  diffLocalDays,
  dueBucket,
  dueNextWeek,
  dueToday,
  dueTomorrow,
  endOfMonth,
  endOfWeek,
  isDateOnly,
  isDueToday,
  isNoDueDate,
  isOverdue,
  isUpcoming,
  isoWeekday,
  localDateOf,
  nextWeekStart,
  parsedDue,
  postponeDays,
  startOfLocalDay,
  startOfLocalDayIso,
  startOfWeek,
  toLocalDate,
} from '../due-dates'

const NULL_DATE_FOR_TESTS = '0001-01-01T00:00:00Z'
const originalTz = process.env.TZ

/** Runs `fn` with the process time zone switched (Node re-reads TZ on assignment). */
function inTimeZone<T>(tz: string, fn: () => T): T {
  process.env.TZ = tz
  return fn()
}

afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ
  else process.env.TZ = originalTz
})

describe('time zone setup', () => {
  it('actually switches the zone, so the tests below can fail on UTC-based code', () => {
    expect(inTimeZone('America/New_York', () => new Date(2026, 9, 6).getTimezoneOffset())).toBe(240)
    expect(inTimeZone('Pacific/Auckland', () => new Date(2026, 9, 6).getTimezoneOffset())).toBe(-780)
  })
})

describe('calendar date arithmetic', () => {
  it('adds days across month, year and leap-day boundaries', () => {
    expect(addLocalDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addLocalDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addLocalDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addLocalDays('2027-02-28', 1)).toBe('2027-03-01')
    expect(addLocalDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addLocalDays('2026-10-06', 0)).toBe('2026-10-06')
  })

  it('does not drift over a DST change in either direction', () => {
    for (const tz of ['America/New_York', 'Europe/Amsterdam', 'Pacific/Auckland', 'Australia/Lord_Howe']) {
      inTimeZone(tz, () => {
        expect(addLocalDays('2026-10-31', 1)).toBe('2026-11-01')
        expect(addLocalDays('2026-11-01', 1)).toBe('2026-11-02')
        expect(addLocalDays('2026-10-24', 1)).toBe('2026-10-25')
        expect(addLocalDays('2026-10-25', 1)).toBe('2026-10-26')
        expect(addLocalDays('2026-03-28', 2)).toBe('2026-03-30')
        expect(diffLocalDays('2026-10-20', '2026-11-03')).toBe(14)
      })
    }
  })

  it('counts calendar days between two dates', () => {
    expect(diffLocalDays('2026-10-06', '2026-10-06')).toBe(0)
    expect(diffLocalDays('2026-10-06', '2026-10-20')).toBe(14)
    expect(diffLocalDays('2026-10-20', '2026-10-06')).toBe(-14)
    expect(diffLocalDays('2026-12-25', '2027-01-08')).toBe(14)
  })

  it('numbers weekdays Monday = 1 to Sunday = 7', () => {
    expect(isoWeekday('2026-10-05')).toBe(1)
    expect(isoWeekday('2026-10-06')).toBe(2)
    expect(isoWeekday('2026-10-11')).toBe(7)
  })

  it('weeks start on Monday and end on Sunday', () => {
    expect(startOfWeek('2026-10-06')).toBe('2026-10-05')
    expect(startOfWeek('2026-10-11')).toBe('2026-10-05')
    expect(startOfWeek('2026-10-12')).toBe('2026-10-12')
    expect(endOfWeek('2026-10-12')).toBe('2026-10-18')
    expect(nextWeekStart('2026-10-12')).toBe('2026-10-19')
  })

  it('finds month ends, including February in leap and non-leap years', () => {
    expect(endOfMonth('2026-02-10')).toBe('2026-02-28')
    expect(endOfMonth('2028-02-10')).toBe('2028-02-29')
    expect(endOfMonth('2026-11-30')).toBe('2026-11-30')
    expect(endOfMonth('2026-12-01')).toBe('2026-12-31')
  })

  it('rejects malformed dates instead of guessing', () => {
    expect(() => addLocalDays('2026-1-5', 1)).toThrow()
    expect(() => dateOnlyDue('tomorrow')).toThrow()
  })
})

describe('dateOnlyDue', () => {
  it('is local 23:59:59 of the date, as an exact UTC instant', () => {
    expect(inTimeZone('America/New_York', () => dateOnlyDue('2026-10-06'))).toBe('2026-10-07T03:59:59.000Z')
    expect(inTimeZone('Pacific/Auckland', () => dateOnlyDue('2026-10-06'))).toBe('2026-10-06T10:59:59.000Z')
    expect(inTimeZone('Europe/Amsterdam', () => dateOnlyDue('2026-10-06'))).toBe('2026-10-06T21:59:59.000Z')
    expect(inTimeZone('UTC', () => dateOnlyDue('2026-10-06'))).toBe('2026-10-06T23:59:59.000Z')
  })

  it('stays 23:59:59 local on the days the clocks change', () => {
    // US DST ends 2026-11-01 (that local day has 25 hours): 23:59:59 EST = 04:59:59Z the next day.
    expect(inTimeZone('America/New_York', () => dateOnlyDue('2026-11-01'))).toBe('2026-11-02T04:59:59.000Z')
    // EU DST ends 2026-10-25.
    expect(inTimeZone('Europe/Amsterdam', () => dateOnlyDue('2026-10-25'))).toBe('2026-10-25T22:59:59.000Z')
    // US DST starts 2026-03-08 (that local day has 23 hours).
    expect(inTimeZone('America/New_York', () => dateOnlyDue('2026-03-08'))).toBe('2026-03-09T03:59:59.000Z')
  })

  it('round-trips to the same local date in every zone', () => {
    for (const tz of ['America/New_York', 'Pacific/Auckland', 'Pacific/Kiritimati', 'Pacific/Pago_Pago', 'UTC']) {
      inTimeZone(tz, () => {
        for (const date of ['2026-01-01', '2026-03-08', '2026-10-06', '2026-11-01', '2026-12-31']) {
          expect(localDateOf(dateOnlyDue(date))).toBe(date)
          expect(isDateOnly(dateOnlyDue(date))).toBe(true)
        }
      })
    }
  })
})

describe('localDateOf and isDateOnly', () => {
  it('reads the local date, not the UTC date', () => {
    // 2026-10-07T01:00:00Z is still Oct 6 at 21:00 in New York.
    expect(inTimeZone('America/New_York', () => localDateOf('2026-10-07T01:00:00Z'))).toBe('2026-10-06')
    // 2026-10-05T22:30:00Z is already Oct 6 at 00:30 in Berlin.
    expect(inTimeZone('Europe/Berlin', () => localDateOf('2026-10-05T22:30:00Z'))).toBe('2026-10-06')
  })

  it('is empty for no due date', () => {
    expect(localDateOf(NULL_DATE_FOR_TESTS)).toBe('')
    expect(localDateOf('')).toBe('')
    expect(localDateOf(null)).toBe('')
    expect(localDateOf(undefined)).toBe('')
    expect(localDateOf('not a date')).toBe('')
    expect(localDateOf(new Date(Number.NaN))).toBe('')
    expect(isNoDueDate(NULL_DATE_FOR_TESTS)).toBe(true)
    expect(isNoDueDate('2026-10-06T12:00:00Z')).toBe(false)
  })

  it('treats local 23:59:59 and legacy local 00:00:00 as date-only, ignoring milliseconds', () => {
    inTimeZone('America/New_York', () => {
      expect(isDateOnly(new Date(2026, 9, 6, 23, 59, 59, 0).toISOString())).toBe(true)
      expect(isDateOnly(new Date(2026, 9, 6, 23, 59, 59, 999).toISOString())).toBe(true)
      expect(isDateOnly(new Date(2026, 9, 6, 0, 0, 0, 0).toISOString())).toBe(true)
      expect(isDateOnly(new Date(2026, 9, 6, 23, 59, 0, 0).toISOString())).toBe(false)
      expect(isDateOnly(new Date(2026, 9, 6, 0, 0, 1, 0).toISOString())).toBe(false)
      expect(isDateOnly(new Date(2026, 9, 6, 12, 0, 0, 0).toISOString())).toBe(false)
    })
  })

  it('never calls the null date date-only', () => {
    expect(isDateOnly(NULL_DATE_FOR_TESTS)).toBe(false)
    expect(isDateOnly('')).toBe(false)
  })

  it('judges the local time, so the same instant differs by zone', () => {
    // 2026-10-07T03:59:59Z is 23:59:59 in New York but 16:59:59 in Auckland.
    expect(inTimeZone('America/New_York', () => isDateOnly('2026-10-07T03:59:59.000Z'))).toBe(true)
    expect(inTimeZone('Pacific/Auckland', () => isDateOnly('2026-10-07T03:59:59.000Z'))).toBe(false)
  })
})

describe('setters', () => {
  it('ignore the time of day of "now"', () => {
    inTimeZone('America/New_York', () => {
      for (const hour of [0, 12, 23]) {
        const now = new Date(2026, 9, 6, hour, 30)
        expect(dueToday(now)).toBe('2026-10-07T03:59:59.000Z')
        expect(dueTomorrow(now)).toBe('2026-10-08T03:59:59.000Z')
        expect(dueNextWeek(now)).toBe('2026-10-13T03:59:59.000Z')
      }
    })
  })

  it('use the local date even when UTC is already on the next day', () => {
    // 21:00 in New York on Oct 6 is Oct 7 01:00 UTC: "today" is still Oct 6.
    inTimeZone('America/New_York', () => {
      expect(localDateOf(dueToday(new Date(2026, 9, 6, 21, 0)))).toBe('2026-10-06')
    })
    // 00:30 in Berlin on Oct 6 is Oct 5 22:30 UTC: "today" is already Oct 6.
    inTimeZone('Europe/Berlin', () => {
      expect(localDateOf(dueToday(new Date(2026, 9, 6, 0, 30)))).toBe('2026-10-06')
    })
  })

  it('Next week is the next Monday, one day ahead on a Sunday and a week ahead on a Monday', () => {
    inTimeZone('Europe/Berlin', () => {
      expect(localDateOf(dueNextWeek(new Date(2026, 9, 4, 10, 0)))).toBe('2026-10-05')
      expect(localDateOf(dueNextWeek(new Date(2026, 9, 5, 10, 0)))).toBe('2026-10-12')
      expect(localDateOf(dueNextWeek(new Date(2026, 9, 7, 10, 0)))).toBe('2026-10-12')
      expect(localDateOf(dueNextWeek(new Date(2026, 9, 10, 10, 0)))).toBe('2026-10-12')
      expect(localDateOf(dueNextWeek(new Date(2026, 9, 11, 10, 0)))).toBe('2026-10-12')
    })
  })

  it('Tomorrow rolls over month, year and DST ends', () => {
    inTimeZone('America/New_York', () => {
      expect(localDateOf(dueTomorrow(new Date(2026, 11, 31, 23, 0)))).toBe('2027-01-01')
      expect(localDateOf(dueTomorrow(new Date(2026, 9, 31, 23, 0)))).toBe('2026-11-01')
      expect(localDateOf(dueTomorrow(new Date(2026, 10, 1, 23, 0)))).toBe('2026-11-02')
    })
  })
})

describe('postponeDays', () => {
  it('keeps an explicit time of day and moves by calendar days', () => {
    inTimeZone('America/New_York', () => {
      const from = new Date(2026, 9, 6, 9, 30).toISOString()
      expect(postponeDays(from, 1)).toBe(new Date(2026, 9, 7, 9, 30).toISOString())
      expect(postponeDays(from, 30)).toBe(new Date(2026, 10, 5, 9, 30).toISOString())
    })
  })

  it('keeps the wall-clock time across a DST change', () => {
    inTimeZone('America/New_York', () => {
      // 09:30 on Oct 31 (EDT) postponed over the Nov 1 change is still 09:30 local (EST).
      const from = new Date(2026, 9, 31, 9, 30).toISOString()
      const result = new Date(postponeDays(from, 2))
      expect(result.getDate()).toBe(2)
      expect(result.getHours()).toBe(9)
      expect(result.getMinutes()).toBe(30)
    })
  })

  it('turns a date-only value, new or legacy, into 23:59:59 of the new date', () => {
    inTimeZone('Pacific/Auckland', () => {
      const dateOnly = new Date(2026, 9, 6, 23, 59, 59).toISOString()
      const legacy = new Date(2026, 9, 6, 0, 0, 0).toISOString()
      expect(postponeDays(dateOnly, 1)).toBe(dateOnlyDue('2026-10-07'))
      expect(postponeDays(legacy, 7)).toBe(dateOnlyDue('2026-10-13'))
    })
  })

  it('counts from today when the task has no due date', () => {
    inTimeZone('America/New_York', () => {
      const now = new Date(2026, 9, 6, 21, 0)
      expect(postponeDays(NULL_DATE_FOR_TESTS, 1, now)).toBe(dateOnlyDue('2026-10-07'))
      expect(postponeDays('', 3, now)).toBe(dateOnlyDue('2026-10-09'))
      expect(postponeDays(null, 0, now)).toBe(dateOnlyDue('2026-10-06'))
    })
  })

  it('can move backwards', () => {
    inTimeZone('America/New_York', () => {
      expect(postponeDays(dateOnlyDue('2026-10-06'), -6)).toBe(dateOnlyDue('2026-09-30'))
    })
  })
})

describe('parsedDue', () => {
  it('keeps a parsed time to the minute and drops seconds and milliseconds', () => {
    inTimeZone('America/New_York', () => {
      const parsed = new Date(2026, 9, 7, 15, 0, 37, 412)
      expect(parsedDue(parsed, true)).toBe(new Date(2026, 9, 7, 15, 0, 0, 0).toISOString())
    })
  })

  it('turns a date without a time into date-only, whatever time chrono implied', () => {
    inTimeZone('America/New_York', () => {
      expect(parsedDue(new Date(2026, 9, 7, 12, 0), false)).toBe(dateOnlyDue('2026-10-07'))
      expect(parsedDue(new Date(2026, 9, 7, 0, 0), false)).toBe(dateOnlyDue('2026-10-07'))
      expect(parsedDue(new Date(2026, 9, 7, 23, 59), false)).toBe(dateOnlyDue('2026-10-07'))
    })
  })

  it('does not mutate the parsed date', () => {
    const parsed = new Date(2026, 9, 7, 15, 0, 37, 412)
    const before = parsed.getTime()
    parsedDue(parsed, true)
    parsedDue(parsed, false)
    expect(parsed.getTime()).toBe(before)
  })
})

describe('Today / Upcoming classification', () => {
  it('judges the local date, not the UTC date', () => {
    inTimeZone('America/New_York', () => {
      // Now: Tue Oct 6 21:00 local (Wed Oct 7 01:00 UTC).
      const now = new Date(2026, 9, 6, 21, 0)
      const dueTodayEvening = new Date(2026, 9, 6, 23, 59, 59).toISOString() // Oct 7 03:59:59Z
      const dueTomorrow = new Date(2026, 9, 7, 8, 0).toISOString()
      expect(dueBucket(dueTodayEvening, now)).toBe('today')
      expect(dueBucket(dueTomorrow, now)).toBe('upcoming')
    })
    inTimeZone('Pacific/Auckland', () => {
      // Now: Tue Oct 6 00:30 local (Mon Oct 5 11:30 UTC).
      const now = new Date(2026, 9, 6, 0, 30)
      const dueYesterdayEvening = new Date(2026, 9, 5, 23, 59, 59).toISOString()
      expect(dueBucket(dueYesterdayEvening, now)).toBe('overdue')
      expect(dueBucket(new Date(2026, 9, 6, 0, 0).toISOString(), now)).toBe('today')
    })
  })

  it('keeps a task due earlier today in Today until the date changes', () => {
    inTimeZone('Europe/Amsterdam', () => {
      const due = new Date(2026, 9, 6, 8, 0).toISOString()
      expect(isOverdue(due, new Date(2026, 9, 6, 10, 0))).toBe(false)
      expect(isDueToday(due, new Date(2026, 9, 6, 10, 0))).toBe(true)
      expect(isOverdue(due, new Date(2026, 9, 7, 0, 5))).toBe(true)
      expect(isDueToday(due, new Date(2026, 9, 7, 0, 5))).toBe(false)
    })
  })

  it('treats a legacy midnight due date as that local day', () => {
    inTimeZone('America/New_York', () => {
      const legacy = new Date(2026, 9, 7, 0, 0).toISOString() // Oct 7 04:00Z
      const now = new Date(2026, 9, 6, 22, 0)
      expect(isUpcoming(legacy, now)).toBe(true)
      expect(isDueToday(legacy, new Date(2026, 9, 7, 9, 0))).toBe(true)
    })
  })

  it('has no bucket for tasks without a due date', () => {
    expect(dueBucket(NULL_DATE_FOR_TESTS)).toBe('none')
    expect(dueBucket('')).toBe('none')
    expect(dueBucket(null)).toBe('none')
    expect(isOverdue(NULL_DATE_FOR_TESTS)).toBe(false)
    expect(isDueToday(NULL_DATE_FOR_TESTS)).toBe(false)
    expect(isUpcoming(NULL_DATE_FOR_TESTS)).toBe(false)
  })
})

describe('server filter boundaries', () => {
  it('gives local day starts as UTC instants', () => {
    const now = () => new Date(2026, 9, 6, 21, 0)
    expect(inTimeZone('America/New_York', () => startOfLocalDayIso(0, now()))).toBe('2026-10-06T04:00:00.000Z')
    expect(inTimeZone('America/New_York', () => startOfLocalDayIso(1, now()))).toBe('2026-10-07T04:00:00.000Z')
    expect(inTimeZone('America/New_York', () => startOfLocalDayIso(2, now()))).toBe('2026-10-08T04:00:00.000Z')
    expect(inTimeZone('Pacific/Auckland', () => startOfLocalDayIso(1, now()))).toBe('2026-10-06T11:00:00.000Z')
  })

  it('crosses a DST change at its real UTC offset', () => {
    // Oct 31 22:00 EDT: tomorrow (Nov 1) starts at 04:00Z, the day after (Nov 2) at 05:00Z (EST).
    inTimeZone('America/New_York', () => {
      const now = new Date(2026, 9, 31, 22, 0)
      expect(startOfLocalDayIso(1, now)).toBe('2026-11-01T04:00:00.000Z')
      expect(startOfLocalDayIso(2, now)).toBe('2026-11-02T05:00:00.000Z')
    })
  })

  it('"before the start of tomorrow" covers every Today task and nothing later', () => {
    inTimeZone('America/New_York', () => {
      const now = new Date(2026, 9, 6, 10, 0)
      const bound = new Date(startOfLocalDayIso(1, now)).getTime()
      expect(new Date(dueToday(now)).getTime()).toBeLessThan(bound)
      expect(new Date(new Date(2026, 9, 6, 23, 59, 59, 999).toISOString()).getTime()).toBeLessThan(bound)
      expect(new Date(dueTomorrow(now)).getTime()).toBeGreaterThanOrEqual(bound)
      expect(new Date(new Date(2026, 9, 7, 0, 0, 0, 0).toISOString()).getTime()).toBeGreaterThanOrEqual(bound)
    })
  })

  it('startOfLocalDay accepts a date string or an instant', () => {
    inTimeZone('America/New_York', () => {
      expect(startOfLocalDay('2026-10-06').toISOString()).toBe('2026-10-06T04:00:00.000Z')
      expect(startOfLocalDay(new Date(2026, 9, 6, 21, 30)).toISOString()).toBe('2026-10-06T04:00:00.000Z')
      expect(toLocalDate(startOfLocalDay('2026-10-06'))).toBe('2026-10-06')
    })
  })
})
