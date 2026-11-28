import { describe, expect, it } from 'vitest'
import { occurrencesBetween, parseIcs, parseIcsDocuments, reduceIcs } from '../calendar/ics'
import { ianaZoneFor, tzidsIn, vtimezoneFromIana } from '../calendar/timezones'

const wrap = (...lines: string[]) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Vicu//Test//EN', ...lines, 'END:VCALENDAR'].join('\r\n')
const range = (from: string, to: string) => [new Date(from), new Date(to)] as const

describe('VFREEBUSY (a free/busy share)', () => {
  const feed = parseIcs(wrap(
    'BEGIN:VFREEBUSY',
    'UID:fb1',
    'DTSTART:20261109T000000Z',
    'DTEND:20261116T000000Z',
    'FREEBUSY:20261110T090000Z/20261110T100000Z,20261110T140000Z/PT30M',
    'FREEBUSY;FBTYPE=BUSY-TENTATIVE:20261111T120000Z/20261111T130000Z',
    'FREEBUSY;FBTYPE=FREE:20261111T150000Z/20261111T160000Z',
    'FREEBUSY;FBTYPE=BUSY-UNAVAILABLE:20261112T080000Z/20261112T083000Z',
    'END:VFREEBUSY',
  ))
  const [from, to] = range('2026-11-09T00:00:00Z', '2026-11-16T00:00:00Z')
  const all = occurrencesBetween(feed, 'fb', from, to)

  it('makes busy periods titled Busy, tentative ones tentative, and leaves FREE out', () => {
    expect(all.map((e) => [e.title, e.start, e.end, e.tentative, e.busy, e.allDay])).toEqual([
      ['Busy', '2026-11-10T09:00:00.000Z', '2026-11-10T10:00:00.000Z', false, true, false],
      ['Busy', '2026-11-10T14:00:00.000Z', '2026-11-10T14:30:00.000Z', false, true, false],
      ['Busy', '2026-11-11T12:00:00.000Z', '2026-11-11T13:00:00.000Z', true, true, false],
      ['Busy', '2026-11-12T08:00:00.000Z', '2026-11-12T08:30:00.000Z', false, true, false],
    ])
  })

  it('keeps only the periods that touch the range', () => {
    expect(occurrencesBetween(feed, 'fb', new Date('2026-11-11T00:00:00Z'), new Date('2026-11-12T00:00:00Z'))).toHaveLength(1)
  })
})

describe('time zones named without a VTIMEZONE', () => {
  it('maps Windows names, Outlook display names and long ids to IANA zones', () => {
    expect(ianaZoneFor('W. Europe Standard Time')).toBe('Europe/Berlin')
    expect(ianaZoneFor('Eastern Standard Time')).toBe('America/New_York')
    expect(ianaZoneFor('"Tokyo Standard Time"')).toBe('Asia/Tokyo')
    expect(ianaZoneFor('(UTC+01:00) Amsterdam, Berlin, Bern, Rome, Stockholm, Vienna')).toBe('Europe/Berlin')
    expect(ianaZoneFor('/mozilla.org/20050126_1/Europe/Paris')).toBe('Europe/Paris')
    expect(ianaZoneFor('America/Chicago')).toBe('America/Chicago')
    expect(ianaZoneFor('Nowhere Standard Time')).toBeNull()
  })

  it('finds the TZIDs a file uses, quoted or not', () => {
    expect([...tzidsIn('DTSTART;TZID="(UTC+01:00) Amsterdam, Berlin":20261110T090000\r\nDTEND;TZID=Asia/Tokyo:20261110T100000')]).toEqual([
      '(UTC+01:00) Amsterdam, Berlin',
      'Asia/Tokyo',
    ])
  })

  it('builds a zone with its clock changes', () => {
    const text = vtimezoneFromIana('Test NY', 'America/New_York')
    // 2026: summer time from 8 March 02:00, back on 1 November 02:00 (local).
    expect(text).toContain('DTSTART:20260308T020000\r\nTZOFFSETFROM:-0500\r\nTZOFFSETTO:-0400')
    expect(text).toContain('DTSTART:20261101T020000\r\nTZOFFSETFROM:-0400\r\nTZOFFSETTO:-0500')
  })

  it('reads a Windows-named zone at its real time, on both sides of a clock change', () => {
    const feed = parseIcs(wrap(
      'BEGIN:VEVENT',
      'UID:ny',
      'SUMMARY:New York call',
      'DTSTART;TZID=Eastern Standard Time:20261026T090000',
      'DTEND;TZID=Eastern Standard Time:20261026T093000',
      'RRULE:FREQ=WEEKLY;COUNT=2',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:tokyo',
      'SUMMARY:Tokyo call',
      'DTSTART;TZID=Tokyo Standard Time:20261110T090000',
      'DTEND;TZID=Tokyo Standard Time:20261110T100000',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:iana',
      'SUMMARY:Paris call',
      'DTSTART;TZID=Europe/Paris:20261110T090000',
      'DTEND;TZID=Europe/Paris:20261110T100000',
      'END:VEVENT',
    ))
    const all = occurrencesBetween(feed, 'tz', new Date('2026-10-20T00:00:00Z'), new Date('2026-11-20T00:00:00Z'))
    expect(all.map((e) => [e.title, e.start])).toEqual([
      // 9:00 EDT (UTC-4), then 9:00 EST (UTC-5) after 1 November.
      ['New York call', '2026-10-26T13:00:00.000Z'],
      ['New York call', '2026-11-02T14:00:00.000Z'],
      ['Tokyo call', '2026-11-10T00:00:00.000Z'],
      ['Paris call', '2026-11-10T08:00:00.000Z'],
    ])
  })
})

describe('reducing a copy (what is kept on disk)', () => {
  const text = wrap(
    'BEGIN:VTIMEZONE',
    'TZID:Custom Zone',
    'BEGIN:STANDARD',
    'DTSTART:19700101T000000',
    'TZOFFSETFROM:+0300',
    'TZOFFSETTO:+0300',
    'END:STANDARD',
    'END:VTIMEZONE',
    'BEGIN:VEVENT',
    'UID:series',
    'SUMMARY:Board meeting',
    'LOCATION:Room 1',
    'DESCRIPTION:Secret agenda',
    'ATTENDEE;CN=Sam:mailto:sam@example.com',
    'ORGANIZER:mailto:boss@example.com',
    'DTSTART;TZID=Custom Zone:20261102T090000',
    'DTEND;TZID=Custom Zone:20261102T100000',
    'RRULE:FREQ=DAILY;COUNT=3',
    'EXDATE;TZID=Custom Zone:20261103T090000',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'DESCRIPTION:Reminder',
    'TRIGGER:-PT10M',
    'END:VALARM',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:series',
    'RECURRENCE-ID;TZID=Custom Zone:20261104T090000',
    'SUMMARY:Board meeting (moved)',
    'DTSTART;TZID=Custom Zone:20261104T110000',
    'DTEND;TZID=Custom Zone:20261104T120000',
    'END:VEVENT',
    'BEGIN:VTODO',
    'UID:todo',
    'SUMMARY:A task',
    'END:VTODO',
  )
  const [from, to] = range('2026-11-01T00:00:00Z', '2026-11-08T00:00:00Z')

  it('keeps times, rules and titles, and nothing else', () => {
    const reduced = reduceIcs(text, false)
    expect(reduced).toContain('SUMMARY:Board meeting')
    expect(reduced).toContain('LOCATION:Room 1')
    for (const gone of ['Secret agenda', 'ATTENDEE', 'ORGANIZER', 'VALARM', 'VTODO', 'A task']) expect(reduced).not.toContain(gone)
    const before = occurrencesBetween(parseIcs(text), 'c', from, to)
    const after = occurrencesBetween(parseIcs(reduced), 'c', from, to)
    expect(after).toEqual(before)
    expect(after.map((e) => [e.title, e.start])).toEqual([
      ['Board meeting', '2026-11-02T06:00:00.000Z'],
      ['Board meeting (moved)', '2026-11-04T08:00:00.000Z'],
    ])
  })

  it('Busy only keeps no title or place at all (20.8)', () => {
    const reduced = reduceIcs(text, true)
    for (const gone of ['Board meeting', 'Room 1', 'SUMMARY', 'LOCATION']) expect(reduced).not.toContain(gone)
    const after = occurrencesBetween(parseIcs(reduced), 'c', from, to)
    expect(after.map((e) => e.start)).toEqual(['2026-11-02T06:00:00.000Z', '2026-11-04T08:00:00.000Z'])
  })

  it('is the same when done twice', () => {
    const once = reduceIcs(text, true)
    expect(reduceIcs(once, true)).toBe(once)
  })
})

describe('one calendar from several documents (CalDAV)', () => {
  it('reads each document with its own overrides', () => {
    const a = wrap('BEGIN:VEVENT', 'UID:a', 'SUMMARY:A', 'DTSTART:20261110T090000Z', 'DTEND:20261110T100000Z', 'END:VEVENT')
    const b = wrap(
      'BEGIN:VEVENT', 'UID:b', 'SUMMARY:B', 'DTSTART:20261110T120000Z', 'DTEND:20261110T130000Z', 'RRULE:FREQ=DAILY;COUNT=2', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:b', 'RECURRENCE-ID:20261111T120000Z', 'STATUS:CANCELLED', 'DTSTART:20261111T120000Z', 'DTEND:20261111T130000Z', 'END:VEVENT',
    )
    const all = occurrencesBetween(parseIcsDocuments([a, b]), 'c', new Date('2026-11-09T00:00:00Z'), new Date('2026-11-13T00:00:00Z'))
    expect(all.map((e) => e.title)).toEqual(['A', 'B'])
  })
})

describe('the limit of events per range', () => {
  it('stops at the limit, keeping the earliest', () => {
    const feed = parseIcs(wrap('BEGIN:VEVENT', 'UID:many', 'SUMMARY:Tick', 'DTSTART:20261101T000000Z', 'DTEND:20261101T000500Z', 'RRULE:FREQ=MINUTELY;INTERVAL=10', 'END:VEVENT'))
    const found = occurrencesBetween(feed, 'c', new Date('2026-11-01T00:00:00Z'), new Date('2026-11-02T00:00:00Z'), 50)
    expect(found).toHaveLength(50)
    expect(found[0].start).toBe('2026-11-01T00:00:00.000Z')
  })
})
