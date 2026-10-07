import { describe, expect, it } from 'vitest'
import { hasVicuMetadataMarker } from '../metadata-tasks'
import {
  encodeRoutineArchiveEnvelope,
  encodeRoutineEnvelope,
  hasRoutineArchiveMarker,
  hasRoutineMarker,
  parseRoutineEnvelope,
  type RoutinePayload,
} from '../routines'

const carrier: RoutinePayload = {
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
  occurrences: {},
  prunedBefore: '',
}

describe('hiding metadata tasks', () => {
  const archivePart = encodeRoutineArchiveEnvelope({ version: 1, routineId: 'r1', part: 1, occurrences: {} })

  it('hides routine carriers and routine archive parts from every task list', () => {
    expect(hasVicuMetadataMarker(encodeRoutineEnvelope(carrier))).toBe(true)
    expect(hasVicuMetadataMarker(archivePart)).toBe(true)
    expect(hasVicuMetadataMarker(`<p>notes</p>\n${archivePart}`)).toBe(true)
    expect(hasVicuMetadataMarker('<!-- vicu-custom-lists:v1:e30 -->')).toBe(true)
  })

  it('leaves ordinary tasks alone', () => {
    expect(hasVicuMetadataMarker('')).toBe(false)
    expect(hasVicuMetadataMarker(null)).toBe(false)
    expect(hasVicuMetadataMarker('buy milk, vicu-routine is a word here')).toBe(false)
  })

  it('does not mistake an archive part for a routine carrier', () => {
    expect(hasRoutineMarker(archivePart)).toBe(false)
    expect(hasRoutineArchiveMarker(archivePart)).toBe(true)
    expect(parseRoutineEnvelope(archivePart).payload).toBeUndefined()
    expect(parseRoutineEnvelope(archivePart).isCarrier).toBe(false)
  })
})
