import { describe, expect, it } from 'vitest'
import { extractBangToday, parse } from '../index'
import { isDayFirstLocale } from '../extract-dates'
import { parsedDue } from '../../due-dates'
import type { ParserConfig } from '../types'

/**
 * Rules of docs/cross-app-semantics-v1.md section 5 that the corpus (nlp-corpus*.test.ts) only
 * samples: they are checked at other times of day and in other variations. Every call passes an
 * explicit reference time, so nothing depends on the clock.
 */

const bang: ParserConfig = { enabled: true, syntaxMode: 'todoist', bangToday: true, locale: 'en-US' }

const stored = (r: ReturnType<typeof parse>) => (r.dueDate ? new Date(parsedDue(r.dueDate, r.dueHasTime)) : null)
const ymd = (d: Date | null) =>
  d ? [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()] : null

// Tue 2026-10-06 in the evening: a date-only phrase for today must stay today, and a time that
// has passed rolls to tomorrow.
const evening = new Date(2026, 9, 6, 20, 15, 30)

describe('dates at other times of day', () => {
  it('keeps today for a bare weekday and a month-day typed after noon', () => {
    expect(ymd(stored(parse('Standup tuesday', bang, evening)))).toEqual([2026, 10, 6, 23, 59, 59])
    expect(ymd(stored(parse('Standup this tuesday', bang, evening)))).toEqual([2026, 10, 6, 23, 59, 59])
    expect(ymd(stored(parse('Party oct 6', bang, evening)))).toEqual([2026, 10, 6, 23, 59, 59])
  })

  it('moves a time that has passed to tomorrow and keeps one that is ahead', () => {
    expect(ymd(stored(parse('Call at 9am', bang, evening)))).toEqual([2026, 10, 7, 9, 0, 0])
    expect(ymd(stored(parse('Call at 9pm', bang, evening)))).toEqual([2026, 10, 6, 21, 0, 0])
  })

  it('makes "next week" the Monday of the following week from any weekday', () => {
    for (const day of [5, 6, 9, 11]) {
      const r = parse('Plan next week', bang, new Date(2026, 9, day, 10, 0, 0))
      expect(ymd(stored(r))).toEqual([2026, 10, 12, 23, 59, 59])
    }
    expect(ymd(stored(parse('Plan next week', bang, new Date(2026, 9, 12, 10, 0, 0))))).toEqual([2026, 10, 19, 23, 59, 59])
    expect(ymd(stored(parse('Plan next week at 3pm', bang, evening)))).toEqual([2026, 10, 12, 15, 0, 0])
  })

  it('keeps the exact time of a relative phrase', () => {
    expect(ymd(stored(parse('Call back in 2 hours', bang, evening)))).toEqual([2026, 10, 6, 22, 15, 0])
    expect(ymd(stored(parse('Check oven in 45 minutes', bang, evening)))).toEqual([2026, 10, 6, 21, 0, 0])
  })
})

describe('connectors', () => {
  it('are removed with the date', () => {
    expect(parse('Taxes due on friday', bang, evening).title).toBe('Taxes')
    expect(parse('Pay by oct 15', bang, evening).title).toBe('Pay')
    expect(parse('Meeting on friday at 3pm', bang, evening).title).toBe('Meeting')
  })

  it('stay when no date follows', () => {
    expect(parse('Pay the bill by', bang, evening).title).toBe('Pay the bill by')
    expect(parse('Taxes due', bang, evening).title).toBe('Taxes due')
  })
})

describe('weekday abbreviations', () => {
  it('count only with a connector or a time, and full names always', () => {
    expect(parse('Call sat', bang, evening).dueDate).toBeNull()
    expect(parse('Call sat', bang, evening).title).toBe('Call sat')
    expect(parse('Buy sun cream', bang, evening).dueDate).toBeNull()
    expect(ymd(stored(parse('Call on sat', bang, evening)))).toEqual([2026, 10, 10, 23, 59, 59])
    expect(ymd(stored(parse('Call sat 3pm', bang, evening)))).toEqual([2026, 10, 10, 15, 0, 0])
    expect(ymd(stored(parse('Call this sat', bang, evening)))).toEqual([2026, 10, 10, 23, 59, 59])
    expect(ymd(stored(parse('Call saturday', bang, evening)))).toEqual([2026, 10, 10, 23, 59, 59])
  })
})

describe('a weekday next to another date', () => {
  const dateRaw = (r: ReturnType<typeof parse>) => r.tokens.filter((t) => t.type === 'date').map((t) => t.raw)

  it('stays in the title and the other date is used', () => {
    const r = parse('Call Ana about Saturday tomorrow at 3pm', bang, evening)
    expect(r.title).toBe('Call Ana about Saturday')
    expect(ymd(stored(r))).toEqual([2026, 10, 7, 15, 0, 0])
    expect(dateRaw(r)).toEqual(['tomorrow at 3pm'])

    const cases: Array<[string, string, number[]]> = [
      ['Party saturday 10/17', 'Party saturday', [2026, 10, 17, 23, 59, 59]],
      ['Call mom Monday in 3 days', 'Call mom Monday', [2026, 10, 9, 23, 59, 59]],
      ['Plan Monday next month', 'Plan Monday', [2026, 11, 6, 23, 59, 59]],
      ['Call Ana about Saturday in 2 hours', 'Call Ana about Saturday', [2026, 10, 6, 22, 15, 0]],
      // The abbreviation counts because of "on", and then gives way all the same.
      ['Pay rent on sat tomorrow', 'Pay rent on sat', [2026, 10, 7, 23, 59, 59]],
    ]
    for (const [input, title, due] of cases) {
      const parsed = parse(input, bang, evening)
      expect(parsed.title, input).toBe(title)
      expect(ymd(stored(parsed)), input).toEqual(due)
    }

    // A comma between them still counts as directly.
    const comma = parse('Call Ana about Saturday, tomorrow', bang, evening)
    expect(ymd(stored(comma))).toEqual([2026, 10, 7, 23, 59, 59])
    expect(dateRaw(comma)).toEqual(['tomorrow'])
  })

  it('keeps its time, and stays the date when a word comes between', () => {
    expect(ymd(stored(parse('Call wed 3pm', bang, evening)))).toEqual([2026, 10, 7, 15, 0, 0])
    expect(ymd(stored(parse('Call saturday at 3pm', bang, evening)))).toEqual([2026, 10, 10, 15, 0, 0])

    // chrono starts "on Monday" with the connector; it is still a word between the two.
    const apart = parse('Meeting about Friday on Monday', bang, evening)
    expect(ymd(stored(apart))).toEqual([2026, 10, 9, 23, 59, 59])
    expect(dateRaw(apart)).toEqual(['Friday'])
  })

  it('is one phrase with "this week" or "next week" after it', () => {
    const next = parse('Meet friday next week', bang, evening)
    expect(next.title).toBe('Meet')
    expect(ymd(stored(next))).toEqual([2026, 10, 16, 23, 59, 59])
    expect(ymd(stored(parse('Meet friday this week', bang, evening)))).toEqual([2026, 10, 9, 23, 59, 59])
    expect(ymd(stored(parse('Meet friday next week', bang, new Date(2026, 9, 4, 12, 0, 0))))).toEqual([2026, 10, 9, 23, 59, 59])
    expect(ymd(stored(parse('Meet friday next week at 3pm', bang, evening)))).toEqual([2026, 10, 16, 15, 0, 0])

    // An abbreviation still needs its marker: "fri next week" is only "next week".
    const abbreviated = parse('Meet fri next week', bang, evening)
    expect(abbreviated.title).toBe('Meet fri')
    expect(ymd(stored(abbreviated))).toEqual([2026, 10, 12, 23, 59, 59])
  })
})

describe('weekend and weekday', () => {
  it('are words, not dates', () => {
    for (const input of ['Plan the weekend', 'Plan this weekend', 'Plan next weekend', 'Review weekday schedule']) {
      const r = parse(input, bang, evening)
      expect(r.dueDate, input).toBeNull()
      expect(r.title, input).toBe(input)
    }
    const trip = parse('Weekend trip tomorrow', bang, evening)
    expect(trip.title).toBe('Weekend trip')
    expect(ymd(stored(trip))).toEqual([2026, 10, 7, 23, 59, 59])
  })
})

// [input, title, stored due] for a reference of Tue 2026-10-06 20:15:30; null is no due date.
function expectParses(cases: Array<[string, string, number[] | null]>, config: ParserConfig = bang): void {
  for (const [input, title, due] of cases) {
    const r = parse(input, config, evening)
    expect(r.title, input).toBe(title)
    expect(ymd(stored(r)), input).toEqual(due)
  }
}

describe('a label, project or priority inside a date phrase', () => {
  it('splits the phrase, and the first part is the date', () => {
    expectParses([
      ['Call tomorrow @home 3pm', 'Call 3pm', [2026, 10, 7, 23, 59, 59]],
      ['Call tomorrow p1 3pm', 'Call 3pm', [2026, 10, 7, 23, 59, 59]],
      ['Dentist tomorrow #Health at 3pm', 'Dentist at 3pm', [2026, 10, 7, 23, 59, 59]],
      // 15:00 has passed in the evening, so the time alone is tomorrow.
      ['Call 3pm @home tomorrow', 'Call tomorrow', [2026, 10, 7, 15, 0, 0]],
      ['Call tomorrow @home', 'Call', [2026, 10, 7, 23, 59, 59]],
    ])
    expectParses([['Call tomorrow *home 3pm', 'Call 3pm', [2026, 10, 7, 23, 59, 59]]], { ...bang, syntaxMode: 'vikunja' })
    expect(parse('Call tomorrow @home 3pm', bang, evening).labels).toEqual(['home'])
  })

  it('keeps a connector on its own side', () => {
    expectParses([
      ['Pay rent by @money friday', 'Pay rent by', [2026, 10, 9, 23, 59, 59]],
      ['Meet on @home friday', 'Meet on', [2026, 10, 9, 23, 59, 59]],
      ['Report due @work tomorrow', 'Report due', [2026, 10, 7, 23, 59, 59]],
    ])
  })

  it('keeps a weekday apart from the date after it', () => {
    expectParses([['Call Ana about Saturday @call tomorrow', 'Call Ana about tomorrow', [2026, 10, 10, 23, 59, 59]]])
  })
})

describe('ranges', () => {
  it('use their first date and leave the rest in the title', () => {
    expectParses([
      ['Trip friday to sunday', 'Trip to sunday', [2026, 10, 9, 23, 59, 59]],
      ['Trip tomorrow to friday', 'Trip to friday', [2026, 10, 7, 23, 59, 59]],
      ['Out monday through friday', 'Out through friday', [2026, 10, 12, 23, 59, 59]],
      ['Trip friday till sunday', 'Trip till sunday', [2026, 10, 9, 23, 59, 59]],
      ['Trip oct 10 - oct 12', 'Trip - oct 12', [2026, 10, 10, 23, 59, 59]],
      ['Trip oct 10 – oct 12', 'Trip – oct 12', [2026, 10, 10, 23, 59, 59]],
      ['Conference oct 10 until oct 12', 'Conference until oct 12', [2026, 10, 10, 23, 59, 59]],
      ['Meeting tomorrow 3pm to 5pm', 'Meeting to 5pm', [2026, 10, 7, 15, 0, 0]],
      ['Meeting tomorrow 3pm until 5pm', 'Meeting until 5pm', [2026, 10, 7, 15, 0, 0]],
    ])
  })

  it('are not a date when written as one word', () => {
    expectParses([
      ['Meeting tomorrow 3-5pm', 'Meeting 3-5pm', [2026, 10, 7, 23, 59, 59]],
      // chrono's other reading inside the range, 3 May, does not count either.
      ['Meeting 3-5 pm', 'Meeting 3-5 pm', null],
      ['Ship friday-sunday', 'Ship friday-sunday', null],
    ])
  })

  it('keep "to" as a word of the title', () => {
    expectParses([
      ['Remember to call tomorrow', 'Remember to call', [2026, 10, 7, 23, 59, 59]],
      ['Walk to friday market', 'Walk to market', [2026, 10, 9, 23, 59, 59]],
    ])
  })
})

describe('whole words', () => {
  it('a date inside another word is not a date', () => {
    for (const input of [
      "Prep tomorrow's slides",
      'Fix Friday’s build',
      'Tomorrow: call Ana',
      'Call Ana (tomorrow)',
      'Call Ana [tomorrow]',
      'Ship it tomorrow-ish',
      'Plan Friday/Saturday',
      'Book "friday" table',
      'Meet,friday',
      'Plan on(friday)',
    ]) {
      const r = parse(input, bang, evening)
      expect(r.dueDate, input).toBeNull()
      expect(r.title, input).toBe(input)
    }
  })

  it('a date may be followed by punctuation', () => {
    expectParses([
      ["Send Monday's report tomorrow", "Send Monday's report", [2026, 10, 7, 23, 59, 59]],
      ['Pay by friday, then relax', 'Pay , then relax', [2026, 10, 9, 23, 59, 59]],
      ['Meet on friday)', 'Meet )', [2026, 10, 9, 23, 59, 59]],
    ])
  })

  it('a bracket before a connector keeps the connector in the title', () => {
    expectParses([
      ['Meet (on friday)', 'Meet (on )', [2026, 10, 9, 23, 59, 59]],
      ['Report (due friday)', 'Report (due )', [2026, 10, 9, 23, 59, 59]],
      ['Call (at 9pm)', 'Call (at )', [2026, 10, 6, 21, 0, 0]],
    ])
  })
})

describe('phrases about the past', () => {
  it('are not dates', () => {
    for (const input of [
      'Review notes from last friday',
      'Review notes from past friday',
      'Friday last week recap',
      'Finish by last friday',
      'Notes from yesterday',
      'Sleep last night',
      'Follow up on last week',
      'Invoice from last month',
      'Review the last 2 days',
      'Sent 2 days ago',
      'Call a few days ago',
      'Read it half an hour ago',
    ]) {
      const r = parse(input, bang, evening)
      expect(r.dueDate, input).toBeNull()
      expect(r.title, input).toBe(input)
    }
  })

  it('leave the dates around them', () => {
    expectParses([
      ['Read 2 days before friday', 'Read 2 days before', [2026, 10, 9, 23, 59, 59]],
      ['Last day of school friday', 'Last day of school', [2026, 10, 9, 23, 59, 59]],
      ['Same as before tomorrow', 'Same as before', [2026, 10, 7, 23, 59, 59]],
      ['Call them earlier tomorrow', 'Call them earlier', [2026, 10, 7, 23, 59, 59]],
      ['Plan friday last weekend', 'Plan last weekend', [2026, 10, 9, 23, 59, 59]],
      // A time after it is a time of its own (15:00 has passed in the evening).
      ['Call last sat 3pm', 'Call last sat', [2026, 10, 7, 15, 0, 0]],
    ])
  })
})

describe('slash dates', () => {
  it('follow the locale order', () => {
    expect(ymd(stored(parse('Report 5/11', { ...bang, locale: 'en-US' }, evening)))).toEqual([2027, 5, 11, 23, 59, 59])
    expect(ymd(stored(parse('Report 5/11', { ...bang, locale: 'en-GB' }, evening)))).toEqual([2026, 11, 5, 23, 59, 59])
    expect(ymd(stored(parse('Report 5/11', { ...bang, locale: 'de-DE' }, evening)))).toEqual([2026, 11, 5, 23, 59, 59])
    // The first number cannot be a month, so the order flips.
    expect(ymd(stored(parse('Report 15/10', { ...bang, locale: 'en-US' }, evening)))).toEqual([2026, 10, 15, 23, 59, 59])
  })

  it('know which locales write day first', () => {
    expect(isDayFirstLocale('en-US')).toBe(false)
    expect(isDayFirstLocale('en-GB')).toBe(true)
    expect(isDayFirstLocale('de-DE')).toBe(true)
    expect(isDayFirstLocale('fr-FR')).toBe(true)
    expect(isDayFirstLocale('ja-JP')).toBe(false)
    expect(isDayFirstLocale('not a locale')).toBe(false)
  })
})

describe('shorthand recurrence', () => {
  it('counts only as the last word of what is left', () => {
    expect(parse('Water plants daily', bang, evening).recurrence).toEqual({ interval: 1, unit: 'day' })
    expect(parse('Water plants daily @home', bang, evening).recurrence).toEqual({ interval: 1, unit: 'day' })
    expect(parse('Daily review', bang, evening).recurrence).toBeNull()
    expect(parse('Daily review tomorrow', bang, evening).recurrence).toBeNull()
    expect(parse('Sync biweekly', bang, evening).recurrence).toEqual({ interval: 2, unit: 'week' })
    expect(parse('Sync fortnightly', bang, evening).recurrence).toEqual({ interval: 2, unit: 'week' })
  })

  it('lets a trailing ! through to the today shortcut', () => {
    const r = parse('Water plants daily!', bang, evening)
    expect(r.title).toBe('Water plants')
    expect(r.recurrence).toEqual({ interval: 1, unit: 'day' })
    expect(ymd(stored(r))).toEqual([2026, 10, 6, 23, 59, 59])
  })
})

describe('every <weekday>', () => {
  it('is weekly with the due date on the next occurrence, today included', () => {
    const tuesday = parse('Gym every tuesday', bang, evening)
    expect(tuesday.recurrence).toEqual({ interval: 1, unit: 'week' })
    expect(ymd(stored(tuesday))).toEqual([2026, 10, 6, 23, 59, 59])
    expect(tuesday.title).toBe('Gym')
    expect(ymd(stored(parse('Gym every monday', bang, evening)))).toEqual([2026, 10, 12, 23, 59, 59])
  })

  it('applies a time after the weekday', () => {
    const r = parse('Gym every monday 10am', bang, evening)
    expect(ymd(stored(r))).toEqual([2026, 10, 12, 10, 0, 0])
    expect(r.title).toBe('Gym')
    expect(ymd(stored(parse('Gym every friday at 7:30pm', bang, evening)))).toEqual([2026, 10, 9, 19, 30, 0])
  })

  it('leaves the date to another date in the input', () => {
    const r = parse('Gym every friday starting oct 20', bang, evening)
    expect(r.recurrence).toEqual({ interval: 1, unit: 'week' })
    expect(ymd(stored(r))).toEqual([2026, 10, 20, 23, 59, 59])
    expect(r.title).toBe('Gym starting')
  })

  it('keeps the weekday out of the title when the date is dismissed', () => {
    const r = parse('Gym every friday', { ...bang, suppressTypes: ['date'] }, evening)
    expect(r.recurrence).toEqual({ interval: 1, unit: 'week' })
    expect(r.dueDate).toBeNull()
    expect(r.title).toBe('Gym')
  })

  it('does not overlap the recurrence and date tokens', () => {
    for (const input of ['Gym every monday 10am', 'Gym every friday starting oct 20', 'Gym every friday']) {
      const sorted = [...parse(input, bang, evening).tokens].sort((a, b) => a.start - b.start)
      for (let i = 1; i < sorted.length; i++) expect(sorted[i].start).toBeGreaterThanOrEqual(sorted[i - 1].end)
    }
  })

  it('needs a full weekday name', () => {
    expect(parse('Gym every fri', bang, evening).recurrence).toBeNull()
  })
})

describe('the ! today shortcut', () => {
  it('is one rule whether the parser is on or off', () => {
    const off: ParserConfig = { enabled: false, syntaxMode: 'todoist', bangToday: true }
    for (const config of [bang, off]) {
      for (const input of ['call dentist !', 'call dentist!', '! call dentist', '!call dentist']) {
        const r = parse(input, config, evening)
        expect(r.title).toBe('call dentist')
        expect(ymd(stored(r))).toEqual([2026, 10, 6, 23, 59, 59])
        expect(r.dueHasTime).toBe(false)
      }
      const inside = parse('Hello! world', config, evening)
      expect(inside.title).toBe('Hello! world')
      expect(inside.dueDate).toBeNull()
      expect(parse('!', config, evening).title).toBe('')
      expect(ymd(stored(parse('!', config, evening)))).toEqual([2026, 10, 6, 23, 59, 59])
    }
  })

  it('does not apply when the shortcut is off', () => {
    for (const enabled of [true, false]) {
      const r = parse('call dentist !', { enabled, syntaxMode: 'todoist', bangToday: false }, evening)
      expect(r.dueDate).toBeNull()
      expect(r.title).toBe('call dentist !')
    }
  })

  it('leaves a priority token alone', () => {
    const r = parse('!high fix login', { ...bang, syntaxMode: 'vikunja' }, evening)
    expect(r.priority).toBe(3)
    expect(r.dueDate).toBeNull()
    expect(extractBangToday('!high fix login', evening).dueDate).toBeNull()
  })

  it('takes today from the reference', () => {
    expect(ymd(extractBangToday('x !', new Date(2026, 9, 6, 23, 30, 0)).dueDate)).toEqual([2026, 10, 6, 0, 0, 0])
  })
})
