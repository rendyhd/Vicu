import { describe, expect, it } from 'vitest'
import {
  dayListLabel,
  drawTargetProject,
  inNextSevenDays,
  matchesTitleFilter,
  readPlanSource,
  sourceLists,
  sourceProjectId,
} from '../plan-source'
import { dateOnlyDue } from '../../../shared/due-dates'

const NULL_DATE = '0001-01-01T00:00:00Z'

describe('the left panel of the Plan screen', () => {
  it('reads a stored source, and anything else as the first list', () => {
    expect(readPlanSource('inbox')).toBe('inbox')
    expect(readPlanSource('next7')).toBe('next7')
    expect(readPlanSource('nodate')).toBe('nodate')
    expect(readPlanSource('project:12')).toBe('project:12')
    for (const value of [undefined, null, 'project:0', 'project:x', 'someday', 7]) expect(readPlanSource(value)).toBe('day')
  })

  it('knows the project of a source', () => {
    expect(sourceProjectId('inbox', 3)).toBe(3)
    expect(sourceProjectId('inbox', 0)).toBeNull()
    expect(sourceProjectId('project:12', 3)).toBe(12)
    expect(sourceProjectId('day', 3)).toBeNull()
    expect(sourceProjectId('next7', 3)).toBeNull()
  })

  it('names its lists, the first after the selected day', () => {
    expect(dayListLabel('Today')).toBe('Today, no time')
    expect(sourceLists('Today, no time').map((item) => item.label)).toEqual(['Today, no time', 'Inbox', 'Next 7 days', 'No date'])
  })

  it('Next 7 days is after today and at most seven days on', () => {
    const today = '2026-10-06'
    expect(inNextSevenDays(dateOnlyDue('2026-10-06'), today)).toBe(false)
    expect(inNextSevenDays(dateOnlyDue('2026-10-07'), today)).toBe(true)
    expect(inNextSevenDays(dateOnlyDue('2026-10-13'), today)).toBe(true)
    expect(inNextSevenDays(dateOnlyDue('2026-10-14'), today)).toBe(false)
    expect(inNextSevenDays(NULL_DATE, today)).toBe(false)
  })

  it('filters by title in any case', () => {
    expect(matchesTitleFilter('Call the Dentist', 'dent')).toBe(true)
    expect(matchesTitleFilter('Call the Dentist', '  ')).toBe(true)
    expect(matchesTitleFilter('Call the Dentist', 'plumber')).toBe(false)
  })

  it('a drawn task goes into the project browsed if it can be written, else the Inbox', () => {
    expect(drawTargetProject('project:12', 3, () => true)).toBe(12)
    expect(drawTargetProject('project:12', 3, () => false)).toBe(3)
    expect(drawTargetProject('day', 3, () => true)).toBe(3)
    expect(drawTargetProject('next7', 3, () => true)).toBe(3)
    expect(drawTargetProject('inbox', 3, () => true)).toBe(3)
  })
})
