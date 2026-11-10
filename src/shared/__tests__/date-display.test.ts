import { describe, expect, it } from 'vitest'
import { dateFormatFor, formatDateDisplay, isClockFormat, localeUsesHour12, normalizeLocaleTag, resolveHour12 } from '../date-display'

describe('normalizeLocaleTag', () => {
  it('keeps a valid BCP 47 tag', () => {
    expect(normalizeLocaleTag('en-US')).toBe('en-US')
    expect(normalizeLocaleTag('de-DE')).toBe('de-DE')
    expect(normalizeLocaleTag('zh-Hant-TW')).toBe('zh-Hant-TW')
  })

  it('turns the macOS region override into the region (en-US@rg=nlzzzz)', () => {
    expect(normalizeLocaleTag('en-US@rg=nlzzzz')).toBe('en-NL')
    expect(normalizeLocaleTag('en_US@rg=gbzzzz;calendar=gregorian')).toBe('en-GB')
    expect(normalizeLocaleTag('en@rg=nlzzzz')).toBe('en-NL')
    expect(normalizeLocaleTag('nl_NL')).toBe('nl-NL')
  })

  it('falls back instead of throwing', () => {
    expect(normalizeLocaleTag('')).toBe('en-US')
    expect(normalizeLocaleTag(undefined)).toBe('en-US')
    expect(normalizeLocaleTag('not a locale!')).toBe('en-US')
  })

  it('gives dateFormatFor a tag the Intl APIs accept', () => {
    const fmt = dateFormatFor('en-US@rg=nlzzzz', 'system')
    expect(fmt).toEqual({ locale: 'en-NL', hour12: false })
    expect(() => new Date(2026, 10, 10).toLocaleDateString(fmt.locale, { weekday: 'short', day: 'numeric' })).not.toThrow()
    expect(formatDateDisplay('row', evening, now, false, fmt)).toBe('Sat, 15:00')
  })
})

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
