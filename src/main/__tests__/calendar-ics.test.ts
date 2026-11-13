import { describe, expect, it } from 'vitest'
import { occurrencesBetween, parseIcs } from '../calendar/ics'
import { eventBusyOfDay, normaliseFeedUrl, allDayEventsOn, timedEventsOn } from '../../shared/calendar-events'

// A feed with the cases that break calendar clients: a weekly series with a moved and a removed
// occurrence, a zone the feed defines itself, an all-day event, a free event and a cancelled one.
const FEED = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Vicu//Test//EN',
  'BEGIN:VTIMEZONE',
  'TZID:W. Europe Standard Time',
  'BEGIN:STANDARD',
  'DTSTART:16010101T030000',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10',
  'END:STANDARD',
  'BEGIN:DAYLIGHT',
  'DTSTART:16010101T020000',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0200',
  'RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=3',
  'END:DAYLIGHT',
  'END:VTIMEZONE',
  'BEGIN:VEVENT',
  'UID:standup',
  'SUMMARY:Standup',
  'DTSTART;TZID=W. Europe Standard Time:20261102T093000',
  'DTEND;TZID=W. Europe Standard Time:20261102T094500',
  'RRULE:FREQ=WEEKLY;BYDAY=MO,WE',
  'EXDATE;TZID=W. Europe Standard Time:20261104T093000',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:standup',
  'RECURRENCE-ID;TZID=W. Europe Standard Time:20261109T093000',
  'SUMMARY:Standup (moved)',
  'DTSTART;TZID=W. Europe Standard Time:20261109T110000',
  'DTEND;TZID=W. Europe Standard Time:20261109T111500',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:holiday',
  'SUMMARY:Holiday',
  'DTSTART;VALUE=DATE:20261111',
  'DTEND;VALUE=DATE:20261112',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:focus',
  'SUMMARY:Maybe lunch',
  'TRANSP:TRANSPARENT',
  'DTSTART:20261111T100000Z',
  'DTEND:20261111T103000Z',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:gone',
  'SUMMARY:Cancelled',
  'STATUS:CANCELLED',
  'DTSTART:20261111T130000Z',
  'DTEND:20261111T140000Z',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n')

describe('calendar ICS reading', () => {
  const feed = parseIcs(FEED)
  const all = occurrencesBetween(feed, 'c1', new Date('2026-11-01T00:00:00Z'), new Date('2026-11-16T00:00:00Z'))

  it('expands the series with its override and removed occurrence, in the feed\'s own zone', () => {
    const standups = all.filter((event) => event.title.startsWith('Standup'))
    expect(standups.map((event) => [event.title, event.start])).toEqual([
      ['Standup', '2026-11-02T08:30:00.000Z'],
      // 4 Nov is an EXDATE.
      ['Standup (moved)', '2026-11-09T10:00:00.000Z'],
      ['Standup', '2026-11-11T08:30:00.000Z'],
    ])
  })

  it('reads all-day, free and cancelled events', () => {
    const holiday = all.find((event) => event.title === 'Holiday')
    expect(holiday?.allDay).toBe(true)
    expect(all.find((event) => event.title === 'Maybe lunch')?.busy).toBe(false)
    expect(all.some((event) => event.title === 'Cancelled')).toBe(false)
  })

  it('counts only timed, busy events as busy time of a day', () => {
    const day = '2026-11-11'
    expect(allDayEventsOn(all, day).map((event) => event.title)).toEqual(['Holiday'])
    expect(timedEventsOn(all, day).map(({ event }) => event.title).sort()).toEqual(['Maybe lunch', 'Standup'])
    const busy = eventBusyOfDay(all, day)
    expect(busy).toHaveLength(1)
    expect(busy[0][1] - busy[0][0]).toBe(15)
    expect(eventBusyOfDay(all, day, () => false)).toEqual([])
  })

  it('takes webcal links and refuses other schemes', () => {
    expect(normaliseFeedUrl(' webcal://example.com/a.ics ')).toBe('https://example.com/a.ics')
    expect(normaliseFeedUrl('file:///etc/passwd')).toBeNull()
    expect(normaliseFeedUrl('not a link')).toBeNull()
  })
  it('stops expanding repeating events when the budget of one read is spent', () => {
    const events = Array.from({ length: 50 }, (_, n) =>
      ['BEGIN:VEVENT', `UID:tiny-${n}`, 'DTSTAMP:20200101T000000Z', 'DTSTART:20251231T235000Z', 'DTEND:20251231T235001Z', 'RRULE:FREQ=SECONDLY', `SUMMARY:Tick ${n}`, 'END:VEVENT'].join('\r\n'),
    )
    const text = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//EN', ...events, 'END:VCALENDAR'].join('\r\n')
    const feed = parseIcs(text)
    const day = [new Date('2026-01-01T00:00:00Z'), new Date('2026-01-02T00:00:00Z')] as const
    // Each event needs 600 steps to reach the day. A budget of 1,000 steps ends inside the second one.
    const small = occurrencesBetween(feed, 'cal', day[0], day[1], Infinity, { steps: 1000, ms: 60_000 })
    expect(small.length).toBeGreaterThan(0)
    expect(small.length).toBeLessThan(1000)
    expect(new Set(small.map((event) => event.title)).size).toBeLessThanOrEqual(2)
    // A time budget that is already spent stops at the first check, 256 steps in.
    expect(occurrencesBetween(feed, 'cal', day[0], day[1], Infinity, { steps: 1e9, ms: -1 }).length).toBe(0)
  })
})
