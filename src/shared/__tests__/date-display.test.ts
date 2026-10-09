import { describe, expect, it } from 'vitest'
import { formatDateDisplay, isClockFormat, localeUsesHour12, resolveHour12 } from '../date-display'

const now = new Date(2026, 9, 7, 9, 30)
const evening = new Date(2026, 9, 10, 15, 0)

describe('localeUsesHour12', () => {
  it('follows the region', () => {
    expect(localeUsesHour12('en-US')).toBe(true)
    expect(localeUsesHour12('en-GB')).toBe(false)
    expect(localeUsesHour12('de-DE')).toBe(false)
  })

  it('does not throw on a malformed tag', () => {
    expect(localeUsesHour12('not a locale!')).toBe(false)
  })
})

describe('resolveHour12', () => {
  it('lets the Settings choice win over the locale', () => {
    expect(resolveHour12('en-US', '24h')).toBe(false)
    expect(resolveHour12('en-GB', '12h')).toBe(true)
  })

  it('uses the locale for System', () => {
    expect(resolveHour12('en-US', 'system')).toBe(true)
    expect(resolveHour12('en-GB', 'system')).toBe(false)
  })

  it('recognises the three choices only', () => {
    expect(['system', '12h', '24h'].every(isClockFormat)).toBe(true)
    expect(isClockFormat('auto')).toBe(false)
    expect(isClockFormat(undefined)).toBe(false)
  })
})

describe('other locales', () => {
  it('keep the phrase structure with their own order and clock', () => {
    const text = formatDateDisplay('chip', evening, now, false, { locale: 'de-DE', hour12: false })
    expect(text).toContain('15:00')
    expect(text).toMatch(/^[A-Za-z.]+,? .*10/)
    expect(text).not.toMatch(/\d{4}-\d{2}/)
  })

  it('keep the relative words', () => {
    const tomorrow = new Date(2026, 9, 8, 12, 0)
    expect(formatDateDisplay('row', tomorrow, now, true, { locale: 'de-DE', hour12: false })).toBe('Tomorrow')
  })

  it('treat English regions without a pinned pattern as day-first, except the month-first ones', () => {
    expect(formatDateDisplay('chip', evening, now, true, { locale: 'en-AU', hour12: true })).toBe('Sat 10 Oct')
    expect(formatDateDisplay('chip', evening, now, true, { locale: 'en-CA', hour12: true })).toBe('Sat, Oct 10')
    expect(formatDateDisplay('chip', evening, now, true, { locale: 'en', hour12: true })).toBe('Sat, Oct 10')
  })
})
