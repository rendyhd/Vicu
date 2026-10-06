import { afterEach, describe, expect, it } from 'vitest'
import { datePickerPresets, localDateInputValue } from '../date-utils'
import { dateOnlyDue, dueNextWeek, localDateOf, toLocalDate } from '../due-dates'

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
  it('actually switches the zone, so the tests below can fail on the old UTC behaviour', () => {
    expect(inTimeZone('America/New_York', () => new Date(2026, 9, 6).getTimezoneOffset())).toBe(240)
    expect(inTimeZone('Europe/Berlin', () => new Date(2026, 9, 6).getTimezoneOffset())).toBe(-120)
  })
})

describe('toLocalDate', () => {
  it('uses the local calendar day, not the UTC day', () => {
    // 20:30 local in UTC-4 is already tomorrow in UTC.
    inTimeZone('America/New_York', () => {
      expect(toLocalDate(new Date(2026, 9, 6, 20, 30))).toBe('2026-10-06')
    })
    // 00:30 local in UTC+2 is still yesterday in UTC.
    inTimeZone('Europe/Berlin', () => {
      expect(toLocalDate(new Date(2026, 9, 6, 0, 30))).toBe('2026-10-06')
    })
  })

  it('zero-pads month and day', () => {
    expect(toLocalDate(new Date(2026, 0, 5, 12))).toBe('2026-01-05')
  })
})

describe('datePickerPresets', () => {
  it('Today and Tomorrow follow the local date in the evening in UTC-5/-4', () => {
    inTimeZone('America/New_York', () => {
      // Tuesday 2026-10-06 21:00 local (= 2026-10-07T01:00Z)
      const presets = datePickerPresets(new Date(2026, 9, 6, 21, 0))
      expect(presets.today).toBe('2026-10-06')
      expect(presets.tomorrow).toBe('2026-10-07')
    })
  })

  it('Today and Tomorrow follow the local date after midnight in UTC+2', () => {
    inTimeZone('Europe/Berlin', () => {
      // Tuesday 2026-10-06 00:30 local (= 2026-10-05T22:30Z)
      const presets = datePickerPresets(new Date(2026, 9, 6, 0, 30))
      expect(presets.today).toBe('2026-10-06')
      expect(presets.tomorrow).toBe('2026-10-07')
    })
  })

  it('Next Week is the next Monday, one day ahead on a Sunday', () => {
    inTimeZone('Europe/Berlin', () => {
      // Sunday 2026-10-04
      expect(datePickerPresets(new Date(2026, 9, 4, 10, 0)).nextWeek).toBe('2026-10-05')
      // Monday 2026-10-05: a full week ahead, never the same day
      expect(datePickerPresets(new Date(2026, 9, 5, 10, 0)).nextWeek).toBe('2026-10-12')
      // Wednesday 2026-10-07
      expect(datePickerPresets(new Date(2026, 9, 7, 10, 0)).nextWeek).toBe('2026-10-12')
      // Saturday 2026-10-10
      expect(datePickerPresets(new Date(2026, 9, 10, 10, 0)).nextWeek).toBe('2026-10-12')
    })
  })

  it('Next Week agrees with the Next week setter for every weekday', () => {
    inTimeZone('America/New_York', () => {
      for (let day = 4; day <= 10; day++) {
        const now = new Date(2026, 9, day, 21, 0)
        expect(datePickerPresets(now).nextWeek).toBe(localDateOf(dueNextWeek(now)))
      }
    })
  })

  it('rolls over month and year ends and DST changes', () => {
    inTimeZone('America/New_York', () => {
      expect(datePickerPresets(new Date(2026, 11, 31, 23, 0)).tomorrow).toBe('2027-01-01')
      // US DST ends 2026-11-01: that local day has 25 hours
      expect(datePickerPresets(new Date(2026, 9, 31, 23, 0)).tomorrow).toBe('2026-11-01')
      expect(datePickerPresets(new Date(2026, 10, 1, 23, 0)).tomorrow).toBe('2026-11-02')
    })
  })
})

describe('localDateInputValue', () => {
  it('is empty for the null date and for empty input', () => {
    expect(localDateInputValue('0001-01-01T00:00:00Z')).toBe('')
    expect(localDateInputValue('')).toBe('')
  })

  it('shows the local day of the stored instant, not its UTC day', () => {
    // 2026-10-07T01:00:00Z is still Oct 6 at 21:00 in New York.
    inTimeZone('America/New_York', () => {
      expect(localDateInputValue('2026-10-07T01:00:00Z')).toBe('2026-10-06')
    })
    // 2026-10-05T22:30:00Z is already Oct 6 at 00:30 in Berlin.
    inTimeZone('Europe/Berlin', () => {
      expect(localDateInputValue('2026-10-05T22:30:00Z')).toBe('2026-10-06')
    })
  })

  it('round-trips with the picker output', () => {
    for (const tz of ['America/New_York', 'Europe/Berlin', 'Pacific/Auckland']) {
      inTimeZone(tz, () => {
        expect(localDateInputValue(dateOnlyDue('2026-10-06'))).toBe('2026-10-06')
      })
    }
  })
})

describe('the date a picked day is stored as', () => {
  it('is local 23:59:59 of the picked day, not local midnight', () => {
    inTimeZone('America/New_York', () => {
      expect(dateOnlyDue('2026-10-06')).toBe('2026-10-07T03:59:59.000Z')
    })
    inTimeZone('Europe/Berlin', () => {
      expect(dateOnlyDue('2026-10-06')).toBe('2026-10-06T21:59:59.000Z')
    })
  })
})
