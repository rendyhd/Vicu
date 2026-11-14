import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  archivePartReadable,
  keepServerRecordsOfSameState,
  loggedByUserId,
  mergeRoutinePayload,
  routineCarrierReadable,
  pruneRoutinePayload,
  readRoutineHistory,
  routineDueDate,
  type OccurrenceStatus,
  type RoutineArchivePart,
  type RoutineDefinition,
  type RoutineLoggedBy,
  type RoutineOccurrenceRecord,
  type RoutinePayload,
} from '../routines'
import { addLocalDays } from '../due-dates'
import { routineTrend, TREND_WEEKS, TREND_WINDOW_DAYS } from '../routine-trend'

/**
 * Runs every vector of test-fixtures/routine-archive-v1.json (docs/cross-app-semantics-v1.md,
 * section 6) against the real shared routine rules. The zone wrappers (routine-archive*.test.ts)
 * set `process.env.TZ` before calling this, like the cross-app semantics suite; the vectors name
 * their time zones explicitly, so every zone has to give the same answers.
 */

interface CompactOccurrence {
  date: string
  status: OccurrenceStatus
  modifiedAt: string
  modifiedBy: string
  loggedAt?: string
  timeZoneId?: string
  note?: string
  loggedBy?: RoutineLoggedBy
}
interface Side { prunedBefore: string; occurrences: CompactOccurrence[] }
interface DefinitionSide { name: string; updatedAt: string; updatedBy: string }
interface Fixture {
  contractVersion: number
  baseDefinition: RoutineDefinition
  merge: Array<{ name: string; local: Side; remote: Side; expect: { prunedBefore: string; occurrences: Record<string, string> } }>
  writeKeep: Array<{ name: string; local: Side; remote: Side; expect: Record<string, string> }>
  sharedVisibility: Array<{
    name: string
    me: number
    carriers: Array<{ id: number; createdBy: number; routineId: string; shared?: boolean }>
    parts: Array<{ id: number; createdBy: number; routineId: string }>
    useCarriers: number[]
    useParts: number[]
  }>
  loggedBy: Array<{ name: string; record: CompactOccurrence; expectUserId: number | null }>
  definitionMerge: Array<{ name: string; local: DefinitionSide; remote: DefinitionSide; expectName: string }>
  prune: Array<{
    name: string
    today: string
    prunedBefore: string
    schedule?: RoutineDefinition['schedule']
    occurrences: CompactOccurrence[]
    expect: { prunedBefore: string; kept: string[]; archived: string[] }
  }>
  archiveRead: Array<{
    name: string
    main: CompactOccurrence[]
    parts: Array<{ part: number; occurrences: CompactOccurrence[] }>
    expect: Record<string, string>
  }>
  afterCompletion: Array<{
    name: string
    intervalDays: number
    firstDueDate: string
    occurrences: CompactOccurrence[]
    expectDue: string
  }>
  trend: {
    windowDays: number
    weeks: number
    cases: Array<{
      name: string
      today: string
      schedule?: RoutineDefinition['schedule']
      slots?: string[]
      activeFrom?: string
      occurrences: Array<{ date: string; status: OccurrenceStatus; slot?: string; loggedAt?: string; timeZoneId?: string }>
      from: string
      to: string
      expect: {
        days: Record<string, string>
        streak: number | null
        done: number
        expected: number | null
        weeks: Array<[number, number]> | null
        summary: string
      }
    }>
  }
}

function loadFixture(): Fixture {
  return JSON.parse(readFileSync(join(process.cwd(), 'test-fixtures', 'routine-archive-v1.json'), 'utf8')) as Fixture
}

/** Expands a compact occurrence as the fixture's `about` field describes. */
function expand(compact: CompactOccurrence): RoutineOccurrenceRecord {
  return {
    key: `r1:${compact.date}:s1`,
    routineId: 'r1',
    slotId: 's1',
    scheduledDate: compact.date,
    scheduledMinutes: 480,
    timeZoneId: compact.timeZoneId ?? 'UTC',
    status: compact.status,
    loggedAt: compact.loggedAt ?? '',
    modifiedAt: compact.modifiedAt,
    modifiedBy: compact.modifiedBy,
    note: compact.note ?? '',
    ...(compact.loggedBy ? { loggedBy: compact.loggedBy } : {}),
  }
}

function toMap(list: CompactOccurrence[]): Record<string, RoutineOccurrenceRecord> {
  return Object.fromEntries(list.map((compact) => {
    const record = expand(compact)
    return [record.key, record]
  }))
}

/** A key-to-record map as the fixture's `{ date: status }` shape. */
function statusByDate(map: Record<string, RoutineOccurrenceRecord>): Record<string, string> {
  return Object.fromEntries(
    Object.values(map)
      .sort((left, right) => left.scheduledDate.localeCompare(right.scheduledDate))
      .map((record) => [record.scheduledDate, record.status]),
  )
}

export function runRoutineArchiveSuite(options: { zone: string; expectedOffsetMinutesInOctober?: number }): void {
  const fixture = loadFixture()
  const payload = (side: Side, definition: RoutineDefinition = fixture.baseDefinition): RoutinePayload => ({
    version: 1,
    definition,
    occurrences: toMap(side.occurrences),
    prunedBefore: side.prunedBefore,
  })

  describe(`routine archive vectors v1 in ${options.zone}`, () => {
    it('is running in the requested time zone', () => {
      expect(fixture.contractVersion).toBe(1)
      if (options.expectedOffsetMinutesInOctober !== undefined) {
        expect(new Date(2026, 9, 6).getTimezoneOffset()).toBe(options.expectedOffsetMinutesInOctober)
      }
    })

    describe('merge', () => {
      for (const vector of fixture.merge) {
        it(vector.name, () => {
          const merged = mergeRoutinePayload(payload(vector.local), payload(vector.remote))
          expect(merged.prunedBefore).toBe(vector.expect.prunedBefore)
          expect(statusByDate(merged.occurrences)).toEqual(vector.expect.occurrences)
        })
        it(`${vector.name} (arguments swapped)`, () => {
          const merged = mergeRoutinePayload(payload(vector.remote), payload(vector.local))
          expect(merged.prunedBefore).toBe(vector.expect.prunedBefore)
          expect(statusByDate(merged.occurrences)).toEqual(vector.expect.occurrences)
        })
      }
    })

    describe('writeKeep', () => {
      for (const vector of fixture.writeKeep) {
        it(vector.name, () => {
          const remote = payload(vector.remote)
          const sent = keepServerRecordsOfSameState(mergeRoutinePayload(payload(vector.local), remote), remote)
          const byDate = Object.fromEntries(Object.values(sent.occurrences).map((record) => [record.scheduledDate, record.modifiedBy]))
          expect(byDate).toEqual(vector.expect)
        })
      }
    })

    describe('sharedVisibility', () => {
      for (const vector of fixture.sharedVisibility) {
        it(vector.name, () => {
          const carriers = vector.carriers.filter((carrier) => routineCarrierReadable(carrier.createdBy, carrier.shared === true, vector.me))
          expect(carriers.map((carrier) => carrier.id)).toEqual(vector.useCarriers)
          const routines = new Map(carriers.map((carrier) => [carrier.routineId, { shared: carrier.shared === true }]))
          const parts = vector.parts.filter((part) => archivePartReadable(part.routineId, vector.me, routines))
          expect(parts.map((part) => part.id)).toEqual(vector.useParts)
        })
      }
    })

    describe('loggedBy', () => {
      for (const vector of fixture.loggedBy) {
        it(vector.name, () => {
          expect(loggedByUserId(expand(vector.record))).toBe(vector.expectUserId)
        })
      }
    })

    describe('definitionMerge', () => {
      for (const vector of fixture.definitionMerge) {
        const withDefinition = (side: DefinitionSide): RoutinePayload => payload(
          { prunedBefore: '', occurrences: [] },
          { ...fixture.baseDefinition, ...side },
        )
        it(vector.name, () => {
          expect(mergeRoutinePayload(withDefinition(vector.local), withDefinition(vector.remote)).definition.name).toBe(vector.expectName)
          expect(mergeRoutinePayload(withDefinition(vector.remote), withDefinition(vector.local)).definition.name).toBe(vector.expectName)
        })
      }
    })

    describe('prune', () => {
      for (const vector of fixture.prune) {
        it(vector.name, () => {
          const definition: RoutineDefinition = vector.schedule
            ? { ...fixture.baseDefinition, kind: 'CHORE', healthSubtype: null, schedule: vector.schedule }
            : fixture.baseDefinition
          const outcome = pruneRoutinePayload(
            payload({ prunedBefore: vector.prunedBefore, occurrences: vector.occurrences }, definition),
            vector.today,
          )
          expect(outcome.payload.prunedBefore).toBe(vector.expect.prunedBefore)
          expect(Object.values(outcome.payload.occurrences).map((record) => record.scheduledDate).sort()).toEqual(vector.expect.kept)
          expect(outcome.archived.map((record) => record.scheduledDate).sort()).toEqual(vector.expect.archived)
        })
      }
    })

    describe('archiveRead', () => {
      for (const vector of fixture.archiveRead) {
        it(vector.name, () => {
          const parts: RoutineArchivePart[] = vector.parts.map((entry) => ({
            version: 1,
            routineId: 'r1',
            part: entry.part,
            occurrences: toMap(entry.occurrences),
          }))
          const forward = readRoutineHistory('r1', toMap(vector.main), parts)
          const backward = readRoutineHistory('r1', toMap(vector.main), [...parts].reverse())
          expect(statusByDate(forward)).toEqual(vector.expect)
          expect(statusByDate(backward)).toEqual(vector.expect)
        })
      }
    })

    describe('afterCompletion', () => {
      for (const vector of fixture.afterCompletion) {
        it(vector.name, () => {
          const definition: RoutineDefinition = {
            ...fixture.baseDefinition,
            kind: 'CHORE',
            healthSubtype: null,
            schedule: { type: 'after_completion', intervalDays: vector.intervalDays, firstDueDate: vector.firstDueDate },
          }
          const source = payload({ prunedBefore: '', occurrences: vector.occurrences }, definition)
          expect(routineDueDate(source)).toBe(vector.expectDue)
        })
      }
    })

    describe('trend (section 6.11)', () => {
      it('uses the fixture constants', () => {
        expect(TREND_WINDOW_DAYS).toBe(fixture.trend.windowDays)
        expect(TREND_WEEKS).toBe(fixture.trend.weeks)
      })

      function trendOf(vector: Fixture['trend']['cases'][number]) {
        const base = fixture.baseDefinition
        const schedule = vector.schedule ?? base.schedule
        const definition: RoutineDefinition = {
          ...base,
          kind: schedule.type === 'after_completion' ? 'CHORE' : base.kind,
          schedule,
          slots: (vector.slots ?? ['s1']).map((id, index) => ({
            ...base.slots[0],
            id,
            reminderMinutes: base.slots[0].reminderMinutes + index * 60,
          })),
          activeFrom: vector.activeFrom ?? base.activeFrom,
        }
        const records: RoutineOccurrenceRecord[] = vector.occurrences.map((occurrence) => ({
          key: `r1:${occurrence.date}:${occurrence.slot ?? 's1'}`,
          routineId: 'r1',
          slotId: occurrence.slot ?? 's1',
          scheduledDate: occurrence.date,
          scheduledMinutes: 480,
          timeZoneId: occurrence.timeZoneId ?? 'UTC',
          status: occurrence.status,
          loggedAt: occurrence.loggedAt ?? '',
          modifiedAt: '2026-11-13T08:00:00.000Z',
          modifiedBy: 'a',
          note: '',
        }))
        return routineTrend(definition, records, vector.today)
      }

      for (const vector of fixture.trend.cases) {
        it(vector.name, () => {
          const trend = trendOf(vector)
          const days: Record<string, string> = {}
          for (let date = vector.from; date <= vector.to; date = addLocalDays(date, 1)) {
            const state = trend.state(date)
            if (state !== 'none') days[date] = state
          }
          expect(days).toEqual(vector.expect.days)
          expect(trend.streak).toBe(vector.expect.streak)
          expect(trend.window.done).toBe(vector.expect.done)
          // Nothing is expected of an after-completion routine: its tally then counts only what was done.
          expect(trend.window.expected).toBe(vector.expect.expected ?? trend.window.done)
          expect(trend.weeks?.map((week) => [week.done, week.expected]) ?? null).toEqual(vector.expect.weeks)
          expect(trend.summary).toBe(vector.expect.summary)
        })
      }

      it('lists every time of the day picked, in time order', () => {
        const vector = fixture.trend.cases.find((entry) => entry.slots?.length === 2)!
        const trend = trendOf(vector)
        // 10 November: the first time was done, the second has no record and is missed.
        const day = trend.occurrencesOn('2026-11-10')
        expect(day.map((entry) => entry.slotId)).toEqual(['s1', 's2'])
        expect(day.map((entry) => entry.status)).toEqual(['COMPLETED', 'NOT_LOGGED'])
        expect(day.map((entry) => entry.record !== undefined)).toEqual([true, false])
        // Today the second time is still to do; the day before the routine started holds nothing.
        expect(trend.occurrencesOn('2026-11-13').at(-1)?.status).toBe('PENDING')
        expect(trend.occurrencesOn('2026-11-08')).toEqual([])
        expect(trend.occurrencesOn('2026-11-14')).toEqual([])
      })
    })
  })
}
