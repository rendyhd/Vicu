import { afterEach, describe, expect, it } from 'vitest'
import {
  ROUTINE_BUDGET_BYTES,
  ROUTINE_HARD_LIMIT_BYTES,
  completionDate,
  csvCell,
  csvForRoutines,
  encodeRoutineArchiveEnvelope,
  encodeRoutineEnvelope,
  formatInstant,
  hasRoutineArchiveMarker,
  hasRoutineMarker,
  latestCompletionDate,
  localDateInZone,
  mergeRoutinePayload,
  parseRoutineArchiveEnvelope,
  parseRoutineEnvelope,
  planArchiveWrites,
  pruneRoutinePayload,
  readRoutineHistory,
  routineDueDate,
  routineJsonBytes,
  scheduledDateOn,
  upsertRoutineEnvelope,
  utf8Bytes,
  type ArchivePartRef,
  type RoutineArchivePart,
  type RoutineOccurrenceRecord,
  type RoutinePayload,
} from '../routines'
import { addLocalDays } from '../due-dates'

const originalTz = process.env.TZ
afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ
  else process.env.TZ = originalTz
})

function record(date: string, over: Partial<RoutineOccurrenceRecord> = {}): RoutineOccurrenceRecord {
  return {
    key: `r1:${date}:s1`,
    routineId: 'r1',
    slotId: 's1',
    scheduledDate: date,
    scheduledMinutes: 480,
    timeZoneId: 'UTC',
    status: 'COMPLETED',
    loggedAt: `${date}T07:00:00.000Z`,
    modifiedAt: `${date}T07:00:00.000Z`,
    modifiedBy: 'a',
    note: '',
    ...over,
  }
}

function mapOf(...records: RoutineOccurrenceRecord[]): Record<string, RoutineOccurrenceRecord> {
  return Object.fromEntries(records.map((entry) => [entry.key, entry]))
}

function payloadOf(records: RoutineOccurrenceRecord[] = [], over: Partial<RoutinePayload> = {}): RoutinePayload {
  return {
    version: 1,
    definition: {
      id: 'r1',
      name: 'Vitamin D',
      kind: 'HEALTH',
      healthSubtype: 'SUPPLEMENT',
      amount: '1',
      unit: 'pill',
      iconName: 'pill',
      color: '#FF9900',
      schedule: { type: 'calendar', weekdays: [], weekInterval: 1, anchorDate: '2025-01-01' },
      slots: [{ id: 's1', label: 'Morning', period: 'MORNING', reminderMinutes: 480, reminderEnabled: true, followUpMinutes: 0 }],
      activeFrom: '2025-01-01',
      archived: false,
      createdAt: '2025-01-01T08:00:00.000Z',
      updatedAt: '2025-01-01T08:00:00.000Z',
      updatedBy: 'desktop-a',
    },
    occurrences: mapOf(...records),
    prunedBefore: '',
    ...over,
  }
}

function choreOf(records: RoutineOccurrenceRecord[], intervalDays = 14, firstDueDate = '2025-01-01'): RoutinePayload {
  const source = payloadOf(records)
  source.definition.kind = 'CHORE'
  source.definition.healthSubtype = null
  source.definition.schedule = { type: 'after_completion', intervalDays, firstDueDate }
  return source
}

/** `count` daily occurrences ending on `lastDate`, each padded with a note of `noteLength` chars. */
function dailyRecords(lastDate: string, count: number, noteLength: number): RoutineOccurrenceRecord[] {
  return Array.from({ length: count }, (_, index) =>
    record(addLocalDays(lastDate, index - count + 1), { note: 'n'.repeat(noteLength) }))
}

function dates(map: Record<string, RoutineOccurrenceRecord>): string[] {
  return Object.values(map).map((entry) => entry.scheduledDate).sort()
}

describe('markers and envelopes', () => {
  const archivePart: RoutineArchivePart = { version: 1, routineId: 'r1', part: 1, occurrences: mapOf(record('2025-01-10')) }

  it('round trips a main carrier and keeps the description body', () => {
    const source = payloadOf([record('2026-10-01')])
    source.definition.name = 'Vitamine D3 ☀️'
    const marker = encodeRoutineEnvelope(source)
    expect(marker).toMatch(/^<!-- vicu-routine:v1:[A-Za-z0-9_-]+ -->$/)
    expect(parseRoutineEnvelope(`Notes\n${marker}`)).toMatchObject({ isCarrier: true, body: 'Notes', payload: source })
    expect(upsertRoutineEnvelope('Notes', source)).toBe(`Notes\n${marker}`)
  })

  it('writes an archive part as only its marker and reads it back', () => {
    const marker = encodeRoutineArchiveEnvelope(archivePart)
    expect(marker).toMatch(/^<!-- vicu-routine:archive:v1:[A-Za-z0-9_-]+ -->$/)
    expect(parseRoutineArchiveEnvelope(marker)).toEqual({ isArchive: true, part: archivePart })
  })

  it('keeps the two marker kinds apart', () => {
    const archiveMarker = encodeRoutineArchiveEnvelope(archivePart)
    const mainMarker = encodeRoutineEnvelope(payloadOf())
    expect(hasRoutineMarker(archiveMarker)).toBe(false)
    expect(hasRoutineArchiveMarker(archiveMarker)).toBe(true)
    expect(parseRoutineEnvelope(archiveMarker)).toEqual({ isCarrier: false, body: archiveMarker })
    expect(hasRoutineMarker(mainMarker)).toBe(true)
    expect(hasRoutineArchiveMarker(mainMarker)).toBe(false)
    expect(parseRoutineArchiveEnvelope(mainMarker)).toEqual({ isArchive: false })
    // Writing a main carrier never removes an archive marker from the same description.
    expect(upsertRoutineEnvelope(archiveMarker, payloadOf())).toContain(archiveMarker)
  })

  it('reports malformed and unsupported archive markers without a part', () => {
    expect(parseRoutineArchiveEnvelope('<!-- vicu-routine:archive:v2:e30 -->')).toMatchObject({ isArchive: true, error: expect.stringContaining('version 2') })
    expect(parseRoutineArchiveEnvelope('<!-- vicu-routine:archive:v1:!!! -->')).toMatchObject({ isArchive: true, error: expect.any(String) })
    const empty = `<!-- vicu-routine:archive:v1:${btoa('{"version":1,"routineId":"","part":1,"occurrences":{}}')} -->`
    expect(parseRoutineArchiveEnvelope(empty).part).toBeUndefined()
  })

  it('rejects a main carrier above the 512 KiB hard limit and accepts one at the budget', () => {
    const big = payloadOf(dailyRecords('2026-10-01', 10, 100))
    big.definition.name = 'x'.repeat(ROUTINE_HARD_LIMIT_BYTES)
    expect(() => encodeRoutineEnvelope(big)).toThrow('too large')
    const atBudget = payloadOf([record('2026-10-01', { note: 'n'.repeat(ROUTINE_BUDGET_BYTES - 1500) })])
    expect(routineJsonBytes(atBudget)).toBeLessThanOrEqual(ROUTINE_BUDGET_BYTES)
    expect(parseRoutineEnvelope(encodeRoutineEnvelope(atBudget)).payload).toEqual(atBudget)
  })
})

describe('timestamps', () => {
  it('formats instants as UTC with exactly three fraction digits', () => {
    expect(formatInstant(new Date('2026-10-06T08:00:00Z'))).toBe('2026-10-06T08:00:00.000Z')
    expect(formatInstant(Date.UTC(2026, 9, 6, 8, 0, 0, 5))).toBe('2026-10-06T08:00:00.005Z')
    expect(formatInstant()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  })

  it('compares offsets and fractions as instants', () => {
    const local = payloadOf([record('2026-10-01', { status: 'COMPLETED', modifiedAt: '2026-10-01T10:00:00+02:00', modifiedBy: 'a' })])
    const remote = payloadOf([record('2026-10-01', { status: 'SKIPPED', modifiedAt: '2026-10-01T08:00:00.001Z', modifiedBy: 'a' })])
    // 10:00+02:00 is 08:00:00.000Z, one millisecond before the remote write.
    expect(mergeRoutinePayload(local, remote).occurrences['r1:2026-10-01:s1'].status).toBe('SKIPPED')
    expect(mergeRoutinePayload(remote, local).occurrences['r1:2026-10-01:s1'].status).toBe('SKIPPED')
  })

  it('treats an unparseable timestamp as the oldest write', () => {
    const broken = payloadOf([record('2026-10-01', { status: 'SKIPPED', modifiedAt: 'not a date', modifiedBy: 'z' })])
    const good = payloadOf([record('2026-10-01', { status: 'COMPLETED', modifiedAt: '2020-01-01T00:00:00.000Z', modifiedBy: 'a' })])
    expect(mergeRoutinePayload(broken, good).occurrences['r1:2026-10-01:s1'].status).toBe('COMPLETED')
  })

  it('breaks definition ties by the larger updatedBy and keeps the local one on a full tie', () => {
    const left = payloadOf()
    left.definition = { ...left.definition, name: 'Left', updatedBy: 'a' }
    const right = payloadOf()
    right.definition = { ...right.definition, name: 'Right', updatedBy: 'b' }
    expect(mergeRoutinePayload(left, right).definition.name).toBe('Right')
    expect(mergeRoutinePayload(right, left).definition.name).toBe('Right')
    right.definition.updatedBy = 'a'
    expect(mergeRoutinePayload(left, right).definition.name).toBe('Left')
    expect(mergeRoutinePayload(right, left).definition.name).toBe('Right')
  })

  it('drops pruned history that comes back from an older payload', () => {
    const pruned = payloadOf([record('2026-10-01')], { prunedBefore: '2025-10-01' })
    const stale = payloadOf([record('2025-02-01'), record('2025-10-02')])
    const merged = mergeRoutinePayload(stale, pruned)
    expect(dates(merged.occurrences)).toEqual(['2025-10-02', '2026-10-01'])
    expect(merged.prunedBefore).toBe('2025-10-01')
  })
})

describe('after_completion schedule', () => {
  it('counts from the local date of loggedAt in the occurrence time zone', () => {
    const late = record('2026-10-01', { loggedAt: '2026-10-03T23:30:00.000Z', timeZoneId: 'Asia/Tokyo' })
    expect(completionDate(late)).toBe('2026-10-04')
    expect(routineDueDate(choreOf([late], 3, '2026-10-01'))).toBe('2026-10-07')
  })

  it('falls back to the scheduled date without a usable loggedAt', () => {
    expect(completionDate(record('2026-10-01', { loggedAt: '' }))).toBe('2026-10-01')
    expect(completionDate(record('2026-10-01', { loggedAt: 'garbage' }))).toBe('2026-10-01')
    expect(completionDate(record('garbage', { loggedAt: '' }))).toBeUndefined()
  })

  it('uses the device zone when the time zone is missing or unknown', () => {
    const instant = Date.parse('2026-10-04T02:30:00.000Z')
    process.env.TZ = 'America/New_York'
    expect(localDateInZone(instant, '')).toBe('2026-10-03')
    expect(localDateInZone(instant, 'Not/AZone')).toBe('2026-10-03')
    expect(localDateInZone(instant, 'Asia/Tokyo')).toBe('2026-10-04')
    process.env.TZ = 'Pacific/Auckland'
    expect(localDateInZone(instant, undefined)).toBe('2026-10-04')
    expect(localDateInZone(instant, 'Not/AZone')).toBe('2026-10-04')
    expect(localDateInZone(instant, 'America/New_York')).toBe('2026-10-03')
  })

  it('only counts COMPLETED occurrences and ignores skips', () => {
    const done = record('2026-09-01', { loggedAt: '2026-09-05T07:00:00.000Z' })
    const skipped = record('2026-09-10', { status: 'SKIPPED', loggedAt: '2026-09-12T07:00:00.000Z' })
    expect(latestCompletionDate(choreOf([done, skipped]))).toBe('2026-09-05')
    expect(latestCompletionDate(choreOf([skipped]))).toBeUndefined()
    expect(routineDueDate(choreOf([skipped], 3, '2026-10-01'))).toBe('2026-10-01')
  })

  it('shows an overdue chore on today with its due date, but reminders only use the due date', () => {
    const source = choreOf([record('2026-09-01', { loggedAt: '2026-09-02T07:00:00.000Z' })], 7)
    expect(routineDueDate(source)).toBe('2026-09-09')
    expect(scheduledDateOn(source, '2026-09-09')).toBe('2026-09-09')
    expect(scheduledDateOn(source, '2026-09-10')).toBeNull()
    expect(scheduledDateOn(source, '2026-09-20', { today: '2026-09-20' })).toBe('2026-09-09')
    expect(scheduledDateOn(source, '2026-09-21', { today: '2026-09-20' })).toBeNull()
    expect(scheduledDateOn(source, '2026-09-05', { today: '2026-09-05' })).toBeNull()
  })

  it('schedules nothing for an archived routine or before activeFrom', () => {
    const source = payloadOf()
    expect(scheduledDateOn(source, '2025-01-02')).toBe('2025-01-02')
    expect(scheduledDateOn(source, '2024-12-31')).toBeNull()
    source.definition.archived = true
    expect(scheduledDateOn(source, '2025-01-02')).toBeNull()
  })
})

describe('pruning on write', () => {
  it('shrinks the window in 30-day steps until the JSON fits 384 KiB', () => {
    const today = '2026-10-06'
    const source = payloadOf(dailyRecords(today, 400, 1500))
    expect(routineJsonBytes(source)).toBeGreaterThan(ROUTINE_BUDGET_BYTES)
    const { payload, archived } = pruneRoutinePayload(source, today)
    expect(routineJsonBytes(payload)).toBeLessThanOrEqual(ROUTINE_BUDGET_BYTES)
    // Only whole 30-day steps beyond the 400-day cutoff, and the smallest step that fits.
    const base = addLocalDays(today, -400)
    expect(payload.prunedBefore > base).toBe(true)
    expect([30, 60, 90, 120, 150, 180, 210, 240, 270, 300]).toContain(
      Math.round((Date.parse(`${payload.prunedBefore}T00:00:00Z`) - Date.parse(`${base}T00:00:00Z`)) / 86_400_000),
    )
    const previous = addLocalDays(payload.prunedBefore, -30)
    const wider = { ...source, occurrences: Object.fromEntries(Object.entries(source.occurrences).filter(([, entry]) => entry.scheduledDate >= previous)), prunedBefore: previous }
    expect(routineJsonBytes(wider)).toBeGreaterThan(ROUTINE_BUDGET_BYTES)
    // Everything before the cutoff left the payload and is in `archived`, nothing else.
    expect(dates(payload.occurrences).every((date) => date >= payload.prunedBefore)).toBe(true)
    expect(archived.every((entry) => entry.scheduledDate < payload.prunedBefore)).toBe(true)
    expect(Object.keys(payload.occurrences).length + archived.length).toBe(400)
  })

  it('honors a custom budget and never advances prunedBefore when nothing moves', () => {
    const source = payloadOf([record('2026-10-01'), record('2026-10-02')])
    const same = pruneRoutinePayload(source, '2026-10-06')
    expect(same.archived).toEqual([])
    expect(same.payload.prunedBefore).toBe('')
    expect(same.payload).toEqual(source)
    // Whole 30-day steps from the 400-day cutoff (2025-09-01): the 14th lands on 2026-09-26.
    const early = payloadOf([record('2026-09-20'), record('2026-10-01')])
    const budget = routineJsonBytes(payloadOf([record('2026-10-01')], { prunedBefore: '2026-09-26' }))
    const tiny = pruneRoutinePayload(early, '2026-10-06', budget)
    expect(tiny.archived.map((entry) => entry.scheduledDate)).toEqual(['2026-09-20'])
    expect(tiny.payload.prunedBefore).toBe('2026-09-26')
    expect(dates(tiny.payload.occurrences)).toEqual(['2026-10-01'])
  })

  it('terminates when nothing fits and still keeps today', () => {
    const source = payloadOf([record('2026-10-05'), record('2026-10-06', { note: 'n'.repeat(5000) })])
    const outcome = pruneRoutinePayload(source, '2026-10-06', 100)
    expect(Object.keys(outcome.payload.occurrences)).toEqual(['r1:2026-10-06:s1'])
    expect(outcome.archived.map((entry) => entry.scheduledDate)).toEqual(['2026-10-05'])
    expect(outcome.payload.prunedBefore).toBe('2026-10-06')
  })

  it('never moves an after_completion routine past the completion it counts from', () => {
    // Last completed 500 days ago: its occurrence is older than the 400-day window.
    const old = record('2025-05-01', { loggedAt: '2025-05-02T07:00:00.000Z' })
    const older = record('2025-04-01', { loggedAt: '2025-04-02T07:00:00.000Z' })
    const source = choreOf([older, old], 14)
    const outcome = pruneRoutinePayload(source, '2026-10-06')
    expect(dates(outcome.payload.occurrences)).toEqual(['2025-05-01'])
    expect(outcome.archived.map((entry) => entry.scheduledDate)).toEqual(['2025-04-01'])
    expect(outcome.payload.prunedBefore).toBe('2025-05-01')
    expect(routineDueDate(outcome.payload)).toBe('2025-05-16')
    // Without any completion the limit is the first due date.
    const never = choreOf([record('2025-02-01', { status: 'SKIPPED' })], 14, '2025-06-01')
    const neverOutcome = pruneRoutinePayload(never, '2026-10-06')
    expect(neverOutcome.payload.prunedBefore).toBe('2025-06-01')
    expect(neverOutcome.archived.map((entry) => entry.scheduledDate)).toEqual(['2025-02-01'])
  })
})

describe('archive part selection', () => {
  const byDate = (ops: ReturnType<typeof planArchiveWrites>) =>
    ops.map((op) => ({ kind: op.kind, taskId: op.kind === 'update' ? op.taskId : undefined, part: op.part.part, dates: dates(op.part.occurrences) }))
  const ref = (taskId: number, part: number, ...records: RoutineOccurrenceRecord[]): ArchivePartRef => ({
    taskId,
    part: { version: 1, routineId: 'r1', part, occurrences: mapOf(...records) },
  })

  it('creates part 1 when the routine has no archive yet', () => {
    const ops = planArchiveWrites('r1', [], [record('2025-02-01'), record('2025-01-01')])
    expect(byDate(ops)).toEqual([{ kind: 'create', taskId: undefined, part: 1, dates: ['2025-01-01', '2025-02-01'] }])
    expect(ops[0].part.routineId).toBe('r1')
  })

  it('appends to the part with the highest number while it stays within the budget', () => {
    const ops = planArchiveWrites('r1', [ref(10, 1, record('2024-01-01')), ref(11, 2, record('2024-06-01'))], [record('2025-01-01')])
    expect(byDate(ops)).toEqual([{ kind: 'update', taskId: 11, part: 2, dates: ['2024-06-01', '2025-01-01'] }])
  })

  it('starts the next part number when the highest part is full', () => {
    const full = ref(11, 2, record('2024-06-01', { note: 'n'.repeat(2000) }))
    const budget = utf8Bytes(JSON.stringify(full.part)) + 100
    const ops = planArchiveWrites('r1', [ref(10, 1, record('2024-01-01')), full], [record('2025-01-01', { note: 'n'.repeat(500) })], budget)
    expect(byDate(ops)).toEqual([{ kind: 'create', taskId: undefined, part: 3, dates: ['2025-01-01'] }])
  })

  it('writes a change to an archived occurrence into the part that holds its key', () => {
    const held = record('2024-01-01', { status: 'COMPLETED', modifiedAt: '2024-01-01T07:00:00.000Z' })
    const edited = record('2024-01-01', { status: 'SKIPPED', modifiedAt: '2026-10-06T07:00:00.000Z' })
    const ops = planArchiveWrites('r1', [ref(10, 1, held), ref(11, 2, record('2024-06-01'))], [edited])
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ kind: 'update', taskId: 10 })
    expect(ops[0].part.occurrences['r1:2024-01-01:s1'].status).toBe('SKIPPED')
  })

  it('leaves a part alone when the archived copy is newer than the one moved', () => {
    const held = record('2024-01-01', { status: 'SKIPPED', modifiedAt: '2026-10-06T07:00:00.000Z' })
    const stale = record('2024-01-01', { status: 'COMPLETED', modifiedAt: '2024-01-01T07:00:00.000Z' })
    expect(planArchiveWrites('r1', [ref(10, 1, held)], [stale])).toEqual([])
  })

  it('appends to the lowest task id among duplicates of the highest part number', () => {
    const ops = planArchiveWrites('r1', [ref(21, 2, record('2024-06-01')), ref(20, 2, record('2024-07-01'))], [record('2025-01-01')])
    expect(byDate(ops)).toEqual([{ kind: 'update', taskId: 20, part: 2, dates: ['2024-07-01', '2025-01-01'] }])
  })

  it('ignores the parts of other routines', () => {
    const other: ArchivePartRef = { taskId: 5, part: { version: 1, routineId: 'other', part: 7, occurrences: {} } }
    const ops = planArchiveWrites('r1', [other], [record('2025-01-01')])
    expect(byDate(ops)).toEqual([{ kind: 'create', taskId: undefined, part: 1, dates: ['2025-01-01'] }])
  })

  it('splits a large move into parts that each stay within the budget', () => {
    const moved = dailyRecords('2025-01-31', 31, 400)
    const budget = 6000
    const ops = planArchiveWrites('r1', [], moved, budget)
    expect(ops.length).toBeGreaterThan(1)
    expect(ops.map((op) => op.part.part)).toEqual(ops.map((_, index) => index + 1))
    for (const op of ops) expect(utf8Bytes(JSON.stringify(op.part))).toBeLessThanOrEqual(budget)
    expect(ops.flatMap((op) => dates(op.part.occurrences)).sort()).toEqual(dates(mapOf(...moved)))
  })

  it('keeps counting bytes exactly with Unicode notes', () => {
    const moved = dailyRecords('2025-01-20', 20, 0).map((entry, index) => ({ ...entry, note: 'é☀😀'.repeat(20 + index) }))
    const budget = 4000
    for (const op of planArchiveWrites('r1', [], moved, budget)) {
      expect(utf8Bytes(JSON.stringify(op.part))).toBeLessThanOrEqual(budget)
    }
  })
})

describe('history read', () => {
  it('merges the main carrier with every part of the routine and ignores other routines', () => {
    const parts: RoutineArchivePart[] = [
      { version: 1, routineId: 'r1', part: 2, occurrences: mapOf(record('2025-06-01')) },
      { version: 1, routineId: 'r1', part: 1, occurrences: mapOf(record('2025-01-10', { status: 'SKIPPED', modifiedAt: '2025-02-01T00:00:00.000Z' })) },
      { version: 1, routineId: 'r1', part: 1, occurrences: mapOf(record('2025-01-10')) },
      { version: 1, routineId: 'other', part: 1, occurrences: { 'other:2025-01-01:s1': { ...record('2025-01-01'), routineId: 'other', key: 'other:2025-01-01:s1' } } },
    ]
    const history = readRoutineHistory('r1', mapOf(record('2026-10-01')), parts)
    expect(dates(history)).toEqual(['2025-01-10', '2025-06-01', '2026-10-01'])
    expect(history['r1:2025-01-10:s1'].status).toBe('SKIPPED')
  })

  it('lets the main carrier win only when it is newer', () => {
    const archived = record('2025-01-10', { status: 'SKIPPED', modifiedAt: '2025-03-01T00:00:00.000Z' })
    const part: RoutineArchivePart = { version: 1, routineId: 'r1', part: 1, occurrences: mapOf(archived) }
    const older = record('2025-01-10', { status: 'COMPLETED', modifiedAt: '2025-02-01T00:00:00.000Z' })
    const newer = record('2025-01-10', { status: 'COMPLETED', modifiedAt: '2025-04-01T00:00:00.000Z' })
    expect(readRoutineHistory('r1', mapOf(older), [part])['r1:2025-01-10:s1'].status).toBe('SKIPPED')
    expect(readRoutineHistory('r1', mapOf(newer), [part])['r1:2025-01-10:s1'].status).toBe('COMPLETED')
  })
})

describe('CSV export', () => {
  const entry = (name: string, note = '') => ({ name, occurrences: [record('2026-10-01', { note })] })

  it('quotes cells and doubles inner quotes', () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell(7)).toBe('"7"')
    expect(csvForRoutines([entry('Creatine', 'a, b')]).split('\n')[1]).toBe('"Creatine","2026-10-01","08:00","COMPLETED","2026-10-01T07:00:00.000Z","UTC","a, b"')
  })

  it.each(['=1+1', '+1', '-1', '@SUM(A1)', '\tx', '\rx'])('prefixes a cell that starts with %j so it is not a formula', (value) => {
    expect(csvCell(value)).toBe(`"'${value}"`)
  })

  it('leaves safe cells alone, including a dash or an equals sign inside the text', () => {
    expect(csvCell('1+1=2')).toBe('"1+1=2"')
    expect(csvCell('well-being')).toBe('"well-being"')
    expect(csvCell('')).toBe('""')
  })

  it('guards the routine name and the note columns', () => {
    const lines = csvForRoutines([entry('=cmd|calc', '@evil')]).split('\n')
    expect(lines[1]).toContain(`"'=cmd|calc"`)
    expect(lines[1]).toContain(`"'@evil"`)
  })
})
