import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  TODAY_ROUTINES_DEFAULT_LIMIT,
  TODAY_ROUTINES_SOON_MINUTES,
  planTodayRoutines,
  todayRoutinesLimit,
  type TodayRoutinesLimit,
} from '../today-routines'

// Section 6.10 of docs/cross-app-semantics-v1.md and the `todayRoutines` block of the shared fixture.
const fixture = JSON.parse(
  readFileSync(resolve(__dirname, '..', '..', '..', 'test-fixtures', 'cross-app-semantics-v1.json'), 'utf8'),
).todayRoutines as {
  soonMinutes: number
  defaultLimit: number
  cases: Array<{
    name: string
    now: string
    limit: number | 'all'
    occurrences: Array<{ routine: string; name: string; time: string; status: string; carried?: boolean }>
    rows: Array<{ routine: string; time: string; progress: string | null }>
    visible: string[]
    line: { count: number; text: string } | null
  }>
}

const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))
const timeOf = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

describe('routines on Today', () => {
  it('constants match the fixture', () => {
    expect(TODAY_ROUTINES_SOON_MINUTES).toBe(fixture.soonMinutes)
    expect(TODAY_ROUTINES_DEFAULT_LIMIT).toBe(fixture.defaultLimit)
  })

  for (const vector of fixture.cases) {
    it(vector.name, () => {
      const plan = planTodayRoutines(vector.occurrences, minutesOf(vector.now), vector.limit as TodayRoutinesLimit, (item) => ({
        routineId: item.routine,
        name: item.name,
        minutes: minutesOf(item.time),
        finished: item.status !== 'open',
        carried: item.carried === true,
      }))
      expect(plan.rows.map((row) => ({ routine: row.routineId, time: timeOf(row.minutes), progress: row.progress })))
        .toEqual(vector.rows)
      expect(plan.visible.map((row) => row.routineId)).toEqual(vector.visible)
      if (vector.line) {
        expect(plan.hidden).toHaveLength(vector.line.count)
        expect(plan.lineText).toBe(vector.line.text)
      } else {
        expect(plan.lineText).toBeNull()
      }
    })
  }

  it('reads a stored limit, falling back to the default', () => {
    expect(todayRoutinesLimit(5)).toBe(5)
    expect(todayRoutinesLimit('all')).toBe('all')
    expect(todayRoutinesLimit(4)).toBe(TODAY_ROUTINES_DEFAULT_LIMIT)
    expect(todayRoutinesLimit(undefined)).toBe(TODAY_ROUTINES_DEFAULT_LIMIT)
  })
})
