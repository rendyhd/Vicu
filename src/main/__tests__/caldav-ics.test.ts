import { describe, expect, it } from 'vitest'
import ICAL from 'ical.js'
import { expandIcs, rescheduleIcs } from '../caldav/ics'

const calendar = (...events: string[]) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Vicu tests//EN\r\n${events.join('\r\n')}\r\nEND:VCALENDAR\r\n`
const event = (lines: string) => `BEGIN:VEVENT\r\n${lines.replaceAll('\n', '\r\n')}\r\nEND:VEVENT`
const simple = event('UID:one\nDTSTART:20260610T090000Z\nDTEND:20260610T100000Z\nSUMMARY:Meeting\nDESCRIPTION:Keep these notes\nLOCATION:Office\nBEGIN:VALARM\nACTION:DISPLAY\nTRIGGER:-PT10M\nDESCRIPTION:Reminder\nEND:VALARM')
const day = (data: string, date = '2026-06-10') => expandIcs(data, new Date(`${date}T00:00:00Z`), new Date(`${date}T23:59:59Z`))

describe('CalDAV iCalendar parsing and editing', () => {
  it('reads UTC events and keeps unrelated resource content on resize', () => {
    const data = calendar(simple, event('UID:two\nDTSTART:20260610T120000Z\nDTEND:20260610T130000Z\nSUMMARY:Other'))
    expect(day(data)[0]).toMatchObject({ uid: 'one', title: 'Meeting', allDay: false, readOnly: false, start: new Date('2026-06-10T09:00:00Z') })
    const changed = rescheduleIcs(data, 'one', '', new Date('2026-06-10T09:15:00Z'), new Date('2026-06-10T10:30:00Z'))
    expect(changed).toContain('DESCRIPTION:Keep these notes')
    expect(changed).toContain('LOCATION:Office')
    expect(changed).toContain('BEGIN:VALARM')
    expect(changed).toContain('UID:two')
    expect(day(changed)[0].end.toISOString()).toBe('2026-06-10T10:30:00.000Z')
    expect(changed).toContain('SEQUENCE:1')
    expect(changed).toContain('LAST-MODIFIED:')
  })

  it('expands RRULE, RDATE and EXDATE without returning excluded instances', () => {
    const data = calendar(event('UID:r\nDTSTART:20260609T090000Z\nDTEND:20260609T100000Z\nRRULE:FREQ=DAILY;COUNT=3\nEXDATE:20260610T090000Z\nRDATE:20260612T090000Z\nSUMMARY:Daily'))
    expect(day(data)).toEqual([])
    expect(day(data, '2026-06-11')).toHaveLength(1)
    expect(day(data, '2026-06-12')).toHaveLength(1)
  })

  it('creates a detached override for only the edited recurring occurrence', () => {
    const data = calendar(event('UID:r\nDTSTART:20260609T090000Z\nDTEND:20260609T100000Z\nRRULE:FREQ=DAILY;COUNT=3\nSUMMARY:Daily\nDESCRIPTION:Original notes'))
    const occurrence = day(data)[0]
    const changed = rescheduleIcs(data, 'r', occurrence.recurrenceId, new Date('2026-06-10T12:00:00Z'), new Date('2026-06-10T13:30:00Z'))
    expect(day(changed)[0].start.toISOString()).toBe('2026-06-10T12:00:00.000Z')
    expect(day(changed, '2026-06-11')[0].start.toISOString()).toBe('2026-06-11T09:00:00.000Z')
    expect(changed.match(/RRULE:/g)).toHaveLength(1)
    expect(changed).toContain('RECURRENCE-ID:20260610T090000Z')
    expect(changed.match(/DESCRIPTION:Original notes/g)).toHaveLength(2)
    const again = rescheduleIcs(changed, 'r', occurrence.recurrenceId, new Date('2026-06-10T14:00:00Z'), new Date('2026-06-10T15:00:00Z'))
    expect(again.match(/RECURRENCE-ID:/g)).toHaveLength(1)
    expect(day(again)[0].start.toISOString()).toBe('2026-06-10T14:00:00.000Z')
  })

  it('includes moved-in detached exceptions and suppresses cancelled occurrences', () => {
    const master = event('UID:r\nDTSTART:20260609T090000Z\nDTEND:20260609T100000Z\nRRULE:FREQ=DAILY;COUNT=4\nSUMMARY:Daily')
    const moved = event('UID:r\nRECURRENCE-ID:20260612T090000Z\nDTSTART:20260610T160000Z\nDTEND:20260610T170000Z\nSUMMARY:Moved')
    const cancelled = event('UID:r\nRECURRENCE-ID:20260610T090000Z\nDTSTART:20260610T090000Z\nDTEND:20260610T100000Z\nSTATUS:CANCELLED')
    const occurrences = day(calendar(master, moved, cancelled))
    expect(occurrences).toHaveLength(1)
    expect(occurrences[0].title).toBe('Moved')
  })

  it('reads all-day DTEND as exclusive and defaults a missing end to one day', () => {
    const data = calendar(event('UID:a\nDTSTART;VALUE=DATE:20260610\nDTEND;VALUE=DATE:20260612\nSUMMARY:Trip'))
    const localDay = (value: string, date: number) => expandIcs(value, new Date(2026, 5, date), new Date(2026, 5, date + 1))
    expect(localDay(data, 10)[0]).toMatchObject({ allDay: true })
    expect(localDay(data, 11)).toHaveLength(1)
    expect(localDay(data, 12)).toHaveLength(0)
    expect(localDay(calendar(event('UID:a\nDTSTART;VALUE=DATE:20260610\nSUMMARY:Day')), 10)[0].allDay).toBe(true)
  })

  it('understands DURATION and removes it when writing DTEND', () => {
    const data = calendar(event('UID:d\nDTSTART:20260610T090000Z\nDURATION:PT45M\nSUMMARY:Short'))
    expect(day(data)[0].end.toISOString()).toBe('2026-06-10T09:45:00.000Z')
    const changed = rescheduleIcs(data, 'd', '', new Date('2026-06-10T09:00:00Z'), new Date('2026-06-10T10:00:00Z'))
    expect(changed).not.toContain('DURATION:')
  })

  it('resolves bare IANA TZIDs across DST and preserves recurrence identity on edit', () => {
    const data = calendar(event('UID:z\nDTSTART;TZID=America/New_York:20260307T090000\nDTEND;TZID=America/New_York:20260307T100000\nRRULE:FREQ=DAILY;COUNT=3\nSUMMARY:New York'))
    expect(day(data, '2026-03-07')[0].start.toISOString()).toBe('2026-03-07T14:00:00.000Z')
    const occurrence = day(data, '2026-03-08')[0]
    expect(occurrence.start.toISOString()).toBe('2026-03-08T13:00:00.000Z')
    const changed = rescheduleIcs(data, 'z', occurrence.recurrenceId, new Date('2026-03-08T15:00:00Z'), new Date('2026-03-08T16:00:00Z'))
    expect(changed).toContain('RECURRENCE-ID;TZID=America/New_York:20260308T090000')
    expect(day(changed, '2026-03-08')).toHaveLength(1)
    expect(day(changed, '2026-03-08')[0].start.toISOString()).toBe('2026-03-08T15:00:00.000Z')
  })

  it('uses embedded VTIMEZONE definitions without global timezone registration', () => {
    const zone = 'BEGIN:VTIMEZONE\r\nTZID:Custom/Office\r\nBEGIN:STANDARD\r\nDTSTART:19700101T000000\r\nTZOFFSETFROM:+0230\r\nTZOFFSETTO:+0230\r\nEND:STANDARD\r\nEND:VTIMEZONE'
    const data = calendar(zone, event('UID:z\nDTSTART;TZID=Custom/Office:20260610T090000\nDTEND;TZID=Custom/Office:20260610T100000\nSUMMARY:Office'))
    expect(day(data)[0].start.toISOString()).toBe('2026-06-10T06:30:00.000Z')
    expect(ICAL.TimezoneService.has('Custom/Office')).toBe(false)
  })

  it('preserves organizer and attendee parameters for server-managed scheduling', () => {
    const data = calendar(event('UID:i\nDTSTART:20260610T090000Z\nDTEND:20260610T100000Z\nORGANIZER:mailto:owner@example.com\nATTENDEE;PARTSTAT=ACCEPTED:mailto:guest@example.com'))
    expect(day(data)[0].readOnly).toBe(false)
    const changed = rescheduleIcs(data, 'i', '', new Date('2026-06-10T12:00:00Z'), new Date('2026-06-10T13:00:00Z'))
    expect(changed).toContain('ORGANIZER:mailto:owner@example.com')
    expect(changed).toContain('ATTENDEE;PARTSTAT=ACCEPTED:mailto:guest@example.com')
    expect(changed).toContain('SEQUENCE:1')
  })

  it('does not let a single-occurrence gesture modify a THISANDFUTURE override', () => {
    const data = calendar(
      event('UID:r\nDTSTART:20260609T090000Z\nDTEND:20260609T100000Z\nRRULE:FREQ=DAILY;COUNT=3'),
      event('UID:r\nRECURRENCE-ID;RANGE=THISANDFUTURE:20260610T090000Z\nDTSTART:20260610T120000Z\nDTEND:20260610T130000Z'),
    )
    const [occurrence] = day(data)
    expect(occurrence.readOnly).toBe(true)
    expect(() => rescheduleIcs(data, 'r', occurrence.recurrenceId, new Date(), new Date())).toThrow('Range exceptions are read-only')
  })

  it('moves instantaneous events, including midnight, without writing an invalid equal DTEND', () => {
    const data = calendar(event('UID:point\nDTSTART:20260610T000000Z\nSUMMARY:Instant'))
    const [occurrence] = day(data)
    expect(occurrence.start).toEqual(occurrence.end)
    const start = new Date('2026-06-10T00:15:00Z')
    const changed = rescheduleIcs(data, 'point', '', start, start)
    expect(changed).not.toContain('DTEND:')
    expect(day(changed)[0].start).toEqual(start)
  })

  it('does not expand pathological secondly recurrences indefinitely', () => {
    const data = calendar(event('UID:r\nDTSTART:20200101T090000Z\nDURATION:PT1S\nRRULE:FREQ=SECONDLY\nSUMMARY:Too much'))
    expect(() => day(data)).toThrow('too large')
  })
})
