import { describe, expect, it } from 'vitest'
import { importPreview } from '../calendar/ics-import'
import { MAX_IMPORT_EVENTS } from '../../shared/ics-import'

// The preview of "Import calendar file..." (contract 20.10, plan phase 2f): both readings of the
// file, the limit, and the sentences for a file that is not a calendar.

const calendar = (...events: string[][]) => ['BEGIN:VCALENDAR', 'VERSION:2.0', ...events.flat(), 'END:VCALENDAR'].join('\r\n')
const vevent = (uid: string, lines: string[]) => ['BEGIN:VEVENT', `UID:${uid}`, ...lines, 'END:VEVENT']

describe('the import preview', () => {
  it('reads the file with titles and Busy only', () => {
    const text = calendar(
      vevent('a', ['SUMMARY:IMP Weekly call', 'DTSTART:20261116T100000', 'DTEND:20261116T103000', 'RRULE:FREQ=WEEKLY;BYDAY=MO']),
      vevent('b', ['SUMMARY:IMP Dentist', 'DTSTART:20261118T090000', 'DTEND:20261118T094500']),
      vevent('c', ['SUMMARY:IMP Focus', 'TRANSP:TRANSPARENT', 'DTSTART:20261119T130000', 'DTEND:20261119T150000']),
    )
    const result = importPreview(text, 'school.ics', '2026-11-11')
    if (!result.success) throw new Error(result.error)
    expect(result.data.fileName).toBe('school.ics')
    expect(result.data.events.map((e) => e.title)).toEqual(['IMP Weekly call', 'IMP Dentist', 'IMP Focus'])
    expect(result.data.events[0].repeat).toEqual({ kind: 'weekly', every: 1, days: [1] })
    expect(result.data.busyOnly.map((e) => e.title)).toEqual(['Busy', 'Busy', 'Free'])
    expect(result.data.busyOnly[2].busy).toBe(false)
  })

  it(`refuses more than ${MAX_IMPORT_EVENTS} Events`, () => {
    const many = Array.from({ length: MAX_IMPORT_EVENTS + 1 }, (_, i) =>
      vevent(`e${i}`, [`SUMMARY:IMP ${i}`, 'DTSTART;VALUE=DATE:20261201', 'DTEND;VALUE=DATE:20261202']),
    )
    const result = importPreview(calendar(...many), 'big.ics', '2026-11-11')
    expect(result).toEqual({ success: false, error: `This file makes ${MAX_IMPORT_EVENTS + 1} Events, more than the ${MAX_IMPORT_EVENTS} Vicu imports at once. Export a shorter range and try again.` })
  })

  it('says when a file is not a calendar', () => {
    expect(importPreview('name,date\nx,y', 'list.csv', '2026-11-11')).toEqual({ success: false, error: 'That file is not a calendar file (no BEGIN:VCALENDAR).' })
    expect(importPreview('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART:nonsense', 'broken.ics', '2026-11-11')).toEqual({ success: false, error: 'The file could not be read as a calendar.' })
  })
})
