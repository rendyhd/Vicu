import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DAY_CHOICES,
  DEFAULT_DAYS,
  DEFAULT_MOVE_BY,
  DEFAULT_TIMES,
  dayChoices,
  eveningTime,
  morningTime,
  moveBy,
  readDays,
  readMoveBy,
  readTimes,
  writeDays,
  writeMoveBy,
  writeTimes,
  type DayChoiceId,
  type MoveStepId,
  type TimeOfDay,
} from '../when-choices'
import type { WeekStart } from '../week-start'

/**
 * The `whenChoices` vectors of test-fixtures/cross-app-semantics-v1.json (section 22), run in the
 * zone the test file sets. The mobile app runs the same (`WhenChoicesFixtureTest`).
 */
export function runWhenChoicesSuite(options: { zone: string }) {
  type Vector = Record<string, unknown>
  const fixture = JSON.parse(readFileSync(join(process.cwd(), 'test-fixtures', 'cross-app-semantics-v1.json'), 'utf8'))
  const vectors = fixture.whenChoices as Record<string, Vector[] | unknown>
  const list = (key: string) => vectors[key] as Vector[]

  /** A local wall-clock time "2026-10-06T10:00:00" as a Date in the process zone. */
  const local = (text: string) => {
    const [d, t] = text.split('T')
    const [y, mo, day] = d.split('-').map(Number)
    const [h, mi, s] = t.split(':').map(Number)
    return new Date(y, mo - 1, day, h, mi, s ?? 0, 0)
  }
  const wall = (date: Date) => {
    const p = (n: number) => String(n).padStart(2, '0')
    return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`
  }

  describe(`when choices in ${options.zone}`, () => {
    it('has the contract defaults', () => {
      expect(DEFAULT_TIMES).toEqual(vectors.defaultTimes)
      expect(DEFAULT_DAYS).toEqual(vectors.defaultDays)
      expect(DEFAULT_MOVE_BY).toEqual(vectors.defaultMoveBy)
      expect(writeTimes(DEFAULT_TIMES)).toBeNull()
      expect(writeDays(DEFAULT_DAYS)).toBeNull()
      expect(writeMoveBy(DEFAULT_MOVE_BY)).toBeNull()
    })

    it('reads the times of day', () => {
      for (const v of list('readTimes')) expect(readTimes(v.value), v.name as string).toEqual(v.expect)
    })

    it('reads the day choices and Move by', () => {
      for (const v of list('readDays')) expect(readDays(v.value), v.name as string).toEqual(v.expect)
      for (const v of list('readMoveBy')) expect(readMoveBy(v.value), v.name as string).toEqual(v.expect)
    })

    it('finds the morning and evening times', () => {
      for (const v of list('morningEvening')) {
        const times = v.times as TimeOfDay[]
        expect(morningTime(times), v.name as string).toBe(v.morning ?? null)
        expect(eveningTime(times), v.name as string).toBe(v.evening ?? null)
      }
    })

    it('offers the day choices', () => {
      for (const v of list('days')) {
        const times = (v.times as TimeOfDay[] | undefined) ?? DEFAULT_TIMES
        const weekStart = ((v.weekStart as string | undefined) ?? 'monday') as WeekStart
        const known = DAY_CHOICES.map((c) => c.id as string)
        const ids = (v.ids as string[]).filter((id) => known.includes(id)) as DayChoiceId[]
        const actual = dayChoices(ids, local(v.now as string), times, weekStart)
        expect(actual.map((c) => ({ id: c.id, day: c.date, time: c.time })), v.name as string).toEqual(v.expect)
      }
    })

    it('moves by a step', () => {
      for (const v of list('moveBy')) {
        const due = local(v.due as string).toISOString()
        const moved = moveBy(due, v.step as MoveStepId, v.today as string)
        expect(wall(new Date(moved)), v.name as string).toBe(v.expect)
      }
    })
  })
}
