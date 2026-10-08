import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { formatDateDisplay, type DateContext } from '../date-display'

/**
 * Runs the `dateDisplay` vectors of test-fixtures/cross-app-semantics-v1.json that belong to one
 * time zone. The fixture writes `now` and `due` as local wall-clock times in the vector's zone, so
 * they are turned into Dates in the process time zone; the zone wrappers (date-display-*.test.ts)
 * set `process.env.TZ` before calling this. Nothing here builds a Date at module scope.
 */

interface DateDisplayVector {
  name: string
  context: DateContext
  locale: 'en-US' | 'en-GB'
  hour12: boolean
  zone: string
  now: string
  due: string
  dateOnly: boolean
  expect: string
}

function loadVectors(): DateDisplayVector[] {
  const fixture = JSON.parse(
    readFileSync(join(process.cwd(), 'test-fixtures', 'cross-app-semantics-v1.json'), 'utf8'),
  ) as { dateDisplay: { vectors: DateDisplayVector[] } }
  return fixture.dateDisplay.vectors
}

function local(value: string): Date {
  const [datePart, timePart = '00:00:00'] = value.split('T')
  const [y, m, d] = datePart.split('-').map(Number)
  const [h, mi, s] = timePart.split(':').map(Number)
  return new Date(y, m - 1, d, h, mi, s)
}

export function runDateDisplaySuite(options: { zone: string; expectedOffsetMinutesInOctober: number }): void {
  const vectors = loadVectors().filter((vector) => vector.zone === options.zone)

  describe(`date display vectors in ${options.zone}`, () => {
    it('is running in the requested time zone and has vectors for it', () => {
      expect(new Date(2026, 9, 6).getTimezoneOffset()).toBe(options.expectedOffsetMinutesInOctober)
      expect(vectors.length).toBeGreaterThan(100)
    })

    for (const vector of vectors) {
      it(vector.name, () => {
        const text = formatDateDisplay(
          vector.context,
          local(vector.due),
          local(vector.now),
          vector.dateOnly,
          { locale: vector.locale, hour12: vector.hour12 },
        )
        expect(text).toBe(vector.expect)
      })
    }
  })
}
