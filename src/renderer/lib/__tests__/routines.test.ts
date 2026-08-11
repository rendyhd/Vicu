import { describe, expect, it } from 'vitest'
import {
  encodeRoutineEnvelope,
  isCalendarScheduled,
  mergeRoutinePayload,
  occurrencesForDate,
  parseRoutineEnvelope,
  routineDueDate,
  type RoutinePayload,
} from '../routines'

function payload(overrides: Partial<RoutinePayload> = {}): RoutinePayload {
  return {
    version: 1,
    definition: {
      id: 'routine-1',
      name: 'Creatine',
      kind: 'HEALTH',
      healthSubtype: 'SUPPLEMENT',
      amount: '5',
      unit: 'g',
      iconName: 'pill',
      color: '#AF52DE',
      schedule: { type: 'calendar', weekdays: [], weekInterval: 1, anchorDate: '2026-08-01' },
      slots: [{ id: 'morning', label: 'Morning', period: 'MORNING', reminderMinutes: 480, reminderEnabled: true, followUpMinutes: 30 }],
      activeFrom: '2026-08-01',
      archived: false,
      createdAt: '2026-08-01T08:00:00.000Z',
      updatedAt: '2026-08-01T08:00:00.000Z',
      updatedBy: 'device-a',
    },
    occurrences: {},
    prunedBefore: '',
    ...overrides,
  }
}

describe('routine envelope', () => {
  it('round trips Unicode through the Android-compatible base64url marker', () => {
    const source = payload()
    source.definition.name = 'Vitamine D3 ☀️'
    const marker = encodeRoutineEnvelope(source)
    expect(marker).toMatch(/^<!-- vicu-routine:v1:[A-Za-z0-9_-]+ -->$/)
    expect(parseRoutineEnvelope(`Notes\n${marker}`).payload).toEqual(source)
    expect(parseRoutineEnvelope(`Notes\n${marker}`).body).toBe('Notes')
  })
})

describe('routine scheduling', () => {
  it('honors ISO weekdays and biweekly anchors', () => {
    const schedule = { type: 'calendar' as const, weekdays: [1], weekInterval: 2, anchorDate: '2026-08-03' }
    expect(isCalendarScheduled(schedule, '2026-08-03')).toBe(true)
    expect(isCalendarScheduled(schedule, '2026-08-10')).toBe(false)
    expect(isCalendarScheduled(schedule, '2026-08-17')).toBe(true)
  })

  it('keeps completion-based chores visible when overdue', () => {
    const source = payload()
    source.definition.kind = 'CHORE'
    source.definition.healthSubtype = null
    source.definition.schedule = { type: 'after_completion', intervalDays: 14, firstDueDate: '2026-08-01' }
    expect(routineDueDate(source)).toBe('2026-08-01')
    const carrier = { task: { id: 10, description: '' }, payload: source }
    const occurrences = occurrencesForDate(carrier, '2026-08-11', '2026-08-11')
    expect(occurrences).toHaveLength(1)
    expect(occurrences[0].scheduledDate).toBe('2026-08-01')
    expect(occurrences[0].overdue).toBe(true)
  })
})

describe('routine merge', () => {
  it('keeps the newest definition and independently newest occurrence', () => {
    const local = payload()
    local.definition = { ...local.definition, name: 'Local', updatedAt: '2026-08-02T00:00:00Z' }
    local.occurrences.a = {
      key: 'a', routineId: 'routine-1', slotId: 'morning', scheduledDate: '2026-08-02', scheduledMinutes: 480,
      timeZoneId: 'Europe/Amsterdam', status: 'COMPLETED', loggedAt: '2026-08-02T08:00:00Z', modifiedAt: '2026-08-02T08:00:00Z', modifiedBy: 'device-a', note: '',
    }
    const remote = payload()
    remote.definition = { ...remote.definition, name: 'Remote', updatedAt: '2026-08-03T00:00:00Z' }
    remote.occurrences.a = { ...local.occurrences.a, status: 'SKIPPED', modifiedAt: '2026-08-02T09:00:00Z', modifiedBy: 'device-b' }
    const merged = mergeRoutinePayload(local, remote)
    expect(merged.definition.name).toBe('Remote')
    expect(merged.occurrences.a.status).toBe('SKIPPED')
  })
})
