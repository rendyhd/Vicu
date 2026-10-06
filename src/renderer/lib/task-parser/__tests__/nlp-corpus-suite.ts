import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from '../index'
import type { ParserConfig, SyntaxMode } from '../types'
import { parsedDue } from '../../due-dates'

/**
 * Runs every case of test-fixtures/nlp-corpus-v1.json (docs/cross-app-semantics-v1.md section 5,
 * shared-parser-spec.md) against the real parser. Android runs the same file.
 *
 * The corpus writes times as local wall-clock times without an offset, so they are converted
 * with `new Date(y, m - 1, d, h, mi, s)` in the process time zone. The zone wrappers
 * (nlp-corpus*.test.ts) set `process.env.TZ` before calling this, and pass the offset they
 * expect so a silently ignored TZ cannot turn the suite into a no-op.
 *
 * Nothing here may build a Date at module scope: the zone is switched after this file loads.
 */

interface CorpusCase {
  input: string
  title: string
  mode?: SyntaxMode
  locale?: string
  parserEnabled?: boolean
  due?: string | null
  priority?: number | null
  labels?: string[]
  project?: string | null
  recurrence?: { interval: number; unit: string } | null
}

interface Corpus {
  contractVersion: number
  reference: string
  cases: CorpusCase[]
}

function loadCorpus(): Corpus {
  return JSON.parse(readFileSync(join(process.cwd(), 'test-fixtures', 'nlp-corpus-v1.json'), 'utf8')) as Corpus
}

/** `2026-10-06T10:00:00` as a Date in the process time zone. */
function local(value: string): Date {
  const [datePart, timePart = '00:00:00'] = value.split('T')
  const [y, m, d] = datePart.split('-').map(Number)
  const [h, mi, s] = timePart.split(':').map(Number)
  return new Date(y, m - 1, d, h, mi, s)
}

const pad = (n: number) => String(n).padStart(2, '0')

/** An instant back to `YYYY-MM-DDTHH:mm:ss` local wall-clock time. */
function wall(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export function runNlpCorpusSuite(options: { zone: string; expectedOffsetMinutesInOctober?: number }): void {
  const corpus = loadCorpus()

  describe(`nlp corpus v1 in ${options.zone}`, () => {
    it('is running in the requested time zone', () => {
      expect(corpus.contractVersion).toBe(1)
      expect(corpus.cases.length).toBe(74)
      if (options.expectedOffsetMinutesInOctober !== undefined) {
        expect(new Date(2026, 9, 6).getTimezoneOffset()).toBe(options.expectedOffsetMinutesInOctober)
      }
    })

    for (const testCase of corpus.cases) {
      const flags = [
        testCase.mode ? `mode ${testCase.mode}` : null,
        testCase.locale ? testCase.locale : null,
        testCase.parserEnabled === false ? 'parser off' : null,
      ].filter(Boolean)
      const label = `${JSON.stringify(testCase.input)}${flags.length ? ` (${flags.join(', ')})` : ''}`

      it(label, () => {
        // The app's settings: the parser on or off, the syntax mode, the `!` shortcut on.
        const config: ParserConfig = {
          enabled: testCase.parserEnabled ?? true,
          syntaxMode: testCase.mode ?? 'todoist',
          bangToday: true,
          locale: testCase.locale ?? 'en-US',
        }
        const result = parse(testCase.input, config, local(corpus.reference))

        // The stored value, as the composer, title editor and Quick Entry build it.
        const due = result.dueDate ? wall(parsedDue(result.dueDate, result.dueHasTime)) : null

        expect({
          title: result.title,
          due,
          priority: result.priority,
          labels: result.labels,
          project: result.project,
          recurrence: result.recurrence,
        }).toEqual({
          title: testCase.title,
          due: testCase.due ?? null,
          priority: testCase.priority ?? null,
          labels: testCase.labels ?? [],
          project: testCase.project ?? null,
          recurrence: testCase.recurrence ?? null,
        })
      })
    }
  })
}
