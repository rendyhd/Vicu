import { describe, expect, it } from 'vitest'
import { importSeries, repeatFromRule, type IcsRule, type IcsSeries } from '../ics-import'

// The pure half of contract 20.10 on neutral input, for the cases a calendar reader may expand in
// its own way (RFC 5545 leaves a DTSTART the rule does not give undefined), so they are not vectors.

const rule = (fields: Partial<IcsRule>): IcsRule => ({
  freq: 'WEEKLY',
  interval: 1,
  byDay: [],
  byMonthDay: [],
  byMonth: [],
  bySetPos: [],
  otherParts: [],
  wkst: null,
  count: null,
  until: null,
  ...fields,
})

const series = (fields: Partial<IcsSeries>): IcsSeries => ({
  title: 'Odd start',
  start: '2026-11-10',
  time: '12:00',
  minutes: 30,
  days: 1,
  busy: true,
  cancelled: false,
  rule: null,
  exdates: [],
  irregular: false,
  ...fields,
})

const options = { importDay: '2026-11-10', busyOnly: false }

describe('calendar file import: which rules fit', () => {
  it('leaves a series to the reader when its first day is not one the rule gives', () => {
    expect(importSeries(series({ rule: rule({ byDay: ['WE'] }) }), options)).toBeNull()
    expect(importSeries(series({ rule: rule({ byDay: ['TU'] }) }), options)).toHaveLength(1)
  })

  it('leaves irregular and several-day all-day series to the reader', () => {
    expect(importSeries(series({ rule: rule({}), irregular: true }), options)).toBeNull()
    expect(importSeries(series({ time: null, days: 3, rule: rule({}) }), options)).toBeNull()
  })

  it('refuses parts the repeat rule cannot hold', () => {
    const start = '2026-11-10'
    expect(repeatFromRule(rule({ freq: 'HOURLY' }), start)).toBeNull()
    expect(repeatFromRule(rule({ otherParts: ['BYHOUR'] }), start)).toBeNull()
    expect(repeatFromRule(rule({ interval: 100 }), start)).toBeNull()
    expect(repeatFromRule(rule({ byDay: ['2TU'] }), start)).toBeNull()
    expect(repeatFromRule(rule({ bySetPos: [1] }), start)).toBeNull()
    expect(repeatFromRule(rule({ freq: 'DAILY', interval: 2, byDay: ['MO'] }), start)).toBeNull()
    expect(repeatFromRule(rule({ freq: 'MONTHLY', byMonthDay: [-1] }), start)).toBeNull()
    expect(repeatFromRule(rule({ freq: 'MONTHLY', byDay: ['TU'], bySetPos: [5] }), start)).toBeNull()
    expect(repeatFromRule(rule({ freq: 'MONTHLY', byDay: ['2TU'], bySetPos: [2] }), start)).toBeNull()
    expect(repeatFromRule(rule({ freq: 'YEARLY', byMonth: [11, 12] }), start)).toBeNull()
    // WKST matters only with an interval above 1.
    expect(repeatFromRule(rule({ wkst: 'SU', byDay: ['TU'] }), start)).toEqual({ kind: 'weekly', every: 1, days: [2] })
    expect(repeatFromRule(rule({ wkst: 'MO', interval: 2, byDay: ['TU'] }), start)).toEqual({ kind: 'weekly', every: 2, days: [2] })
  })
})
