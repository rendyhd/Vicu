import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { formatBlockRow, type DateFormat } from '../date-display'
import { buildDefaultReminder, withDefaultReminder } from '../default-reminder'
import { MAX_BLOCK_MINUTES, isTimeBlock } from '../time-blocks'

/**
 * The `timeBlocks` vectors of test-fixtures/cross-app-semantics-v1.json (contract section 16) that
 * this far have code: what a block is, the default reminder and the row text. Times are local
 * wall-clock times, converted in the process time zone; the zone wrappers (time-blocks*.test.ts) set
 * `process.env.TZ` first. Vicu mobile runs the same block (`TimeBlocksFixtureTest`). Nothing here
 * may build a Date at module scope.
 */

interface Vectors {
  maxBlockMinutes: number
  isBlock: Array<{ name: string; start: string | null; end: string | null; block: boolean }>
  defaultReminder: Array<{
    name: string
    offset: number
    relativeTo: 'due_date' | 'start_date' | 'end_date'
    due: string | null
    start: string | null
    end: string | null
    expect: { reminder: string; relative_period: number; relative_to: string } | null
  }>
  display: Array<{ name: string; now: string; start: string; end: string; locale: string; hour12: boolean; text: string }>
}

function loadVectors(): Vectors {
  return (JSON.parse(readFileSync(join(process.cwd(), 'test-fixtures', 'cross-app-semantics-v1.json'), 'utf8')) as { timeBlocks: Vectors }).timeBlocks
}

/** `2026-10-06T10:00:00` as a Date in the process time zone. */
function local(value: string): Date {
  const [datePart, timePart = '00:00:00'] = value.split('T')
  const [y, m, d] = datePart.split('-').map(Number)
  const [h, mi, s = 0] = timePart.split(':').map(Number)
  return new Date(y, m - 1, d, h, mi, s)
}

const iso = (value: string | null): string | null => (value ? local(value).toISOString() : null)

export function runTimeBlocksSuite(options: { zone: string; expectedOffsetMinutesInOctober?: number }): void {
  const vectors = loadVectors()

  describe(`time blocks in ${options.zone}`, () => {
    it('is running in the requested time zone', () => {
      expect(MAX_BLOCK_MINUTES).toBe(vectors.maxBlockMinutes)
      if (options.expectedOffsetMinutesInOctober !== undefined) {
        expect(new Date(2026, 9, 6).getTimezoneOffset()).toBe(options.expectedOffsetMinutesInOctober)
      }
    })

    describe('isBlock', () => {
      for (const vector of vectors.isBlock) {
        it(vector.name, () => {
          expect(isTimeBlock(iso(vector.start), iso(vector.end))).toBe(vector.block)
        })
      }
    })

    describe('defaultReminder', () => {
      for (const vector of vectors.defaultReminder) {
        const expected = vector.expect && { ...vector.expect, reminder: iso(vector.expect.reminder) }

        it(vector.name, () => {
          const start = iso(vector.start)
          const end = iso(vector.end)
          const block = start && end && isTimeBlock(start, end) ? { start, end } : null
          expect(buildDefaultReminder(iso(vector.due), vector.offset, vector.relativeTo, block)).toEqual(expected)
        })

        it(`${vector.name}, on a new task`, () => {
          const payload = withDefaultReminder(
            { title: 'x', due_date: iso(vector.due) ?? undefined, start_date: iso(vector.start) ?? undefined, end_date: iso(vector.end) ?? undefined },
            { notifications_default_reminder_offset: vector.offset, notifications_default_reminder_relative_to: vector.relativeTo },
          ) as { reminders?: unknown[] }
          expect(payload.reminders ?? null).toEqual(expected ? [expected] : null)
        })
      }
    })

    describe('display', () => {
      for (const vector of vectors.display) {
        it(vector.name, () => {
          const fmt: DateFormat = { locale: vector.locale, hour12: vector.hour12 } as DateFormat
          expect(formatBlockRow(local(vector.start), local(vector.end), local(vector.now), fmt)).toBe(vector.text)
        })
      }
    })
  })
}
