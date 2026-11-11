import { describe, expect, it } from 'vitest'
import {
  choiceIndex,
  encodePlanEvent,
  nextOccurrence,
  occursOn,
  planEventOccurrences,
  readPlanEvent,
  readPlanEvents,
  repeatChoices,
  repeatText,
  type PlanEvent,
} from '../plan-events'
import { eventBusyOfDay } from '../calendar-events'
import { addLocalDays } from '../due-dates'

const base = (fields: Partial<PlanEvent>): PlanEvent => ({
  title: 'Manager call',
  start: '2026-11-10',
  time: '10:00',
  minutes: 30,
  repeat: { kind: 'none' },
  ...fields,
})

const daysOf = (event: PlanEvent, from: string, count: number) =>
  Array.from({ length: count }, (_, i) => addLocalDays(from, i)).filter((day) => occursOn(event, day))

describe('Events: repeat rules', () => {
  it('does not repeat', () => {
    expect(daysOf(base({}), '2026-11-01', 60)).toEqual(['2026-11-10'])
  })

  it('every 2 weeks on Tuesday, from a Tuesday', () => {
    const event = base({ repeat: { kind: 'weekly', every: 2, days: [2] } })
    expect(daysOf(event, '2026-11-01', 40)).toEqual(['2026-11-10', '2026-11-24', '2026-12-08'])
  })

  it('every weekday, with a skipped day and an end', () => {
    const event = base({ repeat: { kind: 'weekly', every: 1, days: [1, 2, 3, 4, 5] }, skips: ['2026-11-12'], until: '2026-11-16' })
    expect(daysOf(event, '2026-11-09', 14)).toEqual(['2026-11-10', '2026-11-11', '2026-11-13', '2026-11-16'])
  })

  it('monthly on the 31st skips short months', () => {
    const event = base({ start: '2026-10-31', repeat: { kind: 'monthly-date', every: 1, date: 31 } })
    expect(daysOf(event, '2026-10-01', 100)).toEqual(['2026-10-31', '2026-12-31'])
  })

  it('monthly on the second Tuesday and on the last Friday', () => {
    const second = base({ start: '2026-11-10', repeat: { kind: 'monthly-weekday', every: 1, week: 2, weekday: 2 } })
    expect(daysOf(second, '2026-11-01', 95)).toEqual(['2026-11-10', '2026-12-08', '2027-01-12'])
    const last = base({ start: '2026-11-27', repeat: { kind: 'monthly-weekday', every: 1, week: -1, weekday: 5 } })
    expect(daysOf(last, '2026-11-01', 95)).toEqual(['2026-11-27', '2026-12-25', '2027-01-29'])
  })

  it('yearly on 29 February only in leap years', () => {
    const event = base({ start: '2028-02-29', time: null, minutes: 0, repeat: { kind: 'yearly', every: 1 } })
    expect(occursOn(event, '2029-02-28')).toBe(false)
    expect(occursOn(event, '2032-02-29')).toBe(true)
    expect(nextOccurrence(event, '2028-02-29')).toBeNull()
  })
})

describe('Events: on the Plan screen', () => {
  it('keeps the wall-clock time and counts timed events as busy, all-day ones not', () => {
    const timed = { ...base({ repeat: { kind: 'daily', every: 1 } }), id: 'a' }
    const allDay = { ...base({ title: 'Month-end close', time: null, minutes: 0 }), id: 'b' }
    const occurrences = planEventOccurrences([timed, allDay], ['2026-11-10', '2026-11-11'])
    expect(occurrences).toHaveLength(3)
    const first = occurrences.find((o) => o.planEventId === 'a' && o.day === '2026-11-10')!
    expect(new Date(first.start).getHours()).toBe(10)
    expect((new Date(first.end).getTime() - new Date(first.start).getTime()) / 60_000).toBe(30)
    expect(eventBusyOfDay(occurrences, '2026-11-10')).toEqual([[600, 630]])
    expect(occurrences.find((o) => o.planEventId === 'b')?.allDay).toBe(true)
  })

  it('reads only valid entries and writes no defaults', () => {
    expect(readPlanEvent({ title: ' ', start: '2026-11-10' })).toBeNull()
    expect(readPlanEvent({ title: 'x', start: '2026-11-10', time: '25:00', minutes: 30 })).toBeNull()
    expect(readPlanEvent({ title: 'x', start: '2026-11-10', time: '10:00', minutes: 30, repeat: { kind: 'weekly', days: [] } })).toBeNull()
    const event = base({ busy: true, skips: [] })
    expect(encodePlanEvent(event)).toEqual({ title: 'Manager call', start: '2026-11-10', time: '10:00', minutes: 30, repeat: { kind: 'none' } })
    expect(readPlanEvents({ 'event.x': encodePlanEvent(event), 'event.': {}, other: 1 }).map((e) => e.id)).toEqual(['x'])
  })

  it('offers the choices of the day drawn on, and words them', () => {
    // Tuesday 24 November 2026: the fourth and the last Tuesday.
    const choices = repeatChoices('2026-11-24')
    expect(choices.map((c) => c.label)).toEqual([
      'Does not repeat',
      'Every day',
      'Every weekday',
      'Every Tuesday',
      'Every 2 weeks on Tuesday',
      'Monthly on the 24th',
      'Monthly on the fourth Tuesday',
      'Monthly on the last Tuesday',
      'Every year on November 24',
    ])
    expect(choices.every((c) => occursOn(base({ start: '2026-11-24', repeat: c.repeat }), '2026-11-24'))).toBe(true)
    expect(repeatText({ kind: 'weekly', every: 1, days: [1, 2, 3, 4, 5] })).toBe('Every weekday')
    expect(choiceIndex(choices, { kind: 'weekly', every: 2, days: [2] })).toBe(4)
  })
})
