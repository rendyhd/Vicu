import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  mergeRoutinePayload,
  pruneRoutinePayload,
  readRoutineHistory,
  routineDueDate,
  type OccurrenceStatus,
  type RoutineArchivePart,
  type RoutineDefinition,
  type RoutineOccurrenceRecord,
  type RoutinePayload,
} from '../routines'

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
}
interface Side { prunedBefore: string; occurrences: CompactOccurrence[] }
interface DefinitionSide { name: string; updatedAt: string; updatedBy: string }
interface Fixture {
  contractVersion: number
  baseDefinition: RoutineDefinition
  merge: Array<{ name: string; local: Side; remote: Side; expect: { prunedBefore: string; occurrences: Record<string, string> } }>
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
    note: '',
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
  })
}
