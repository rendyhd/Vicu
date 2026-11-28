import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { importIcsText } from '../calendar/ics-import'
import { IMPORT_WINDOW_DAYS, UNTITLED_EVENT } from '../../shared/ics-import'
import { encodePlanEvent } from '../../shared/plan-events'

/**
 * The `icsImport` vectors of test-fixtures/cross-app-semantics-v1.json (contract 20.10), read with
 * ical.js through src/main/calendar/ics-import.ts. A time without a zone is local wall-clock time; the
 * zone wrappers (ics-import*.test.ts) set `process.env.TZ` first, and `expectByZone` is checked only
 * in the zones it names. Vicu mobile runs the same block with its own reader.
 */

interface ImportVector {
  name: string
  importDay: string
  busyOnly?: boolean
  ics: string[]
  expect?: Record<string, unknown>[]
  expectByZone?: Record<string, Record<string, unknown>[]>
}
interface Vectors {
  windowDays: number
  untitled: string
  cases: ImportVector[]
}

function loadVectors(): Vectors {
  return (JSON.parse(readFileSync(join(process.cwd(), 'test-fixtures', 'cross-app-semantics-v1.json'), 'utf8')) as { icsImport: Vectors }).icsImport
}

const fileOf = (lines: string[]) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Vicu//Vectors//EN', ...lines, 'END:VCALENDAR'].join('\r\n')

export function runIcsImportSuite(options: { zone: string; expectedOffsetMinutesInOctober?: number }): void {
  const vectors = loadVectors()
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone

  describe(`calendar file import in ${options.zone}`, () => {
    it('is running in the requested time zone, with the contract constants', () => {
      if (options.expectedOffsetMinutesInOctober !== undefined) {
        expect(new Date(2026, 9, 6).getTimezoneOffset()).toBe(options.expectedOffsetMinutesInOctober)
      }
      expect(IMPORT_WINDOW_DAYS).toBe(vectors.windowDays)
      expect(UNTITLED_EVENT).toBe(vectors.untitled)
    })

    for (const vector of vectors.cases) {
      const expected = vector.expect ?? vector.expectByZone?.[zone]
      it.skipIf(expected === undefined)(vector.name, () => {
        const events = importIcsText(fileOf(vector.ics), { importDay: vector.importDay, busyOnly: vector.busyOnly === true })
        expect(events.map(encodePlanEvent)).toEqual(expected)
      })
    }
  })
}
