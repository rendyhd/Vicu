import { describe, expect, it } from 'vitest'
import { readEventText, repeatFromParsed } from '../event-quick-add'

// Local times, so the suite reads the same in every zone (run under TZ Pacific/Auckland and
// America/New_York too). Wednesday 11 November 2026, 09:00.
const reference = new Date(2026, 10, 11, 9, 0)
const read = (text: string, day = '2026-11-11') => readEventText(text, { day, reference, locale: 'en-US' })

describe('quick-add text for an Event', () => {
  it('reads the title, the weekday, the time, the length and the repeat', () => {
    expect(read('Manager call every Tue 10:00 for 30m')).toEqual({
      title: 'Manager call',
      day: '2026-11-17',
      startMinute: 600,
      minutes: 30,
      repeat: { kind: 'weekly', every: 1, days: [2] },
    })
  })

  it('reads the full weekday name too', () => {
    const text = read('Manager call every tuesday 10am for 45 min')
    expect(text.repeat).toEqual({ kind: 'weekly', every: 1, days: [2] })
    expect(text.startMinute).toBe(600)
    expect(text.minutes).toBe(45)
    expect(text.title).toBe('Manager call')
  })

  it('every weekday is Monday to Friday', () => {
    const text = read('Standup every weekday 9:15 for 15m')
    expect(text.title).toBe('Standup')
    expect(text.repeat).toEqual({ kind: 'weekly', every: 1, days: [1, 2, 3, 4, 5] })
    expect(text.startMinute).toBe(555)
    expect(text.minutes).toBe(15)
  })

  it('an interval repeats from the box day when the text names no day', () => {
    expect(read('Review every 2 weeks').repeat).toEqual({ kind: 'weekly', every: 2, days: [3] })
    expect(read('Review every 2 weeks', '2026-11-13').repeat).toEqual({ kind: 'weekly', every: 2, days: [5] })
    expect(read('Close the books every month', '2026-11-30').repeat).toEqual({ kind: 'monthly-date', every: 1, date: 30 })
    expect(read('Water the plants every 3 days').repeat).toEqual({ kind: 'daily', every: 3 })
    expect(read('Anniversary every year').repeat).toEqual({ kind: 'yearly', every: 1 })
    const plain = read('Review every 2 weeks')
    expect(plain.day).toBeNull()
    expect(plain.startMinute).toBeNull()
    expect(plain.title).toBe('Review')
  })

  it('a length without a time is still the length', () => {
    expect(read('Gym for 1h')).toEqual({ title: 'Gym', day: null, startMinute: null, minutes: 60, repeat: null })
  })

  it('a time and a length on the box day, without a repeat', () => {
    expect(read('Lunch 12:30 for 45m')).toEqual({ title: 'Lunch', day: '2026-11-11', startMinute: 750, minutes: 45, repeat: null })
  })

  it('a date names the first day', () => {
    const text = read('Dentist tomorrow 8:30 for 1h')
    expect(text.day).toBe('2026-11-12')
    expect(text.startMinute).toBe(510)
    expect(text.minutes).toBe(60)
  })

  it('labels, projects, priorities and !today stay in the title', () => {
    expect(read('#work @team call !').title).toBe('#work @team call !')
  })

  it('only words left keep the text as typed', () => {
    expect(read('Plain title').title).toBe('Plain title')
  })

  it('maps the parser repeat onto the Event rule', () => {
    expect(repeatFromParsed({ interval: 2, unit: 'week' }, '2026-11-17')).toEqual({ kind: 'weekly', every: 2, days: [2] })
    expect(repeatFromParsed({ interval: 1, unit: 'month' }, '2026-11-24')).toEqual({ kind: 'monthly-date', every: 1, date: 24 })
    expect(repeatFromParsed({ interval: 100, unit: 'day' }, '2026-11-24')).toBeNull()
    expect(repeatFromParsed({ interval: 0, unit: 'year' }, '2026-11-24')).toBeNull()
  })
})
