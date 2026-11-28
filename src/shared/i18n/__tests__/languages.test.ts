import { describe, expect, it } from 'vitest'
import {
  PSEUDO_LANGUAGE,
  SYSTEM_LANGUAGE,
  canonicalTag,
  languageName,
  matchLanguage,
  normalizeLanguageSetting,
  resolveLanguage,
  textDirection,
} from '../languages'

describe('canonicalTag', () => {
  it('spells a tag the usual way and drops extensions', () => {
    expect(canonicalTag('pt-br')).toBe('pt-BR')
    expect(canonicalTag('pt_BR')).toBe('pt-BR')
    expect(canonicalTag('ZH-hant-tw')).toBe('zh-Hant-TW')
    expect(canonicalTag('en-US-u-hc-h23')).toBe('en-US')
  })

  it('answers null for what is not a tag', () => {
    for (const bad of ['', 'system', 'not a tag', '12', null, undefined, 5, {}]) expect(canonicalTag(bad)).toBeNull()
  })
})

describe('matchLanguage', () => {
  const available = ['en', 'nl', 'pt-BR', 'zh-Hans', 'sr-Latn']

  it('takes the tag itself, then its shorter forms', () => {
    expect(matchLanguage(['nl'], available)).toBe('nl')
    expect(matchLanguage(['nl-BE'], available)).toBe('nl')
    expect(matchLanguage(['pt-BR'], available)).toBe('pt-BR')
    expect(matchLanguage(['en-GB'], available)).toBe('en')
  })

  it('takes another region of the same language before English', () => {
    expect(matchLanguage(['pt-PT'], available)).toBe('pt-BR')
    expect(matchLanguage(['pt'], available)).toBe('pt-BR')
  })

  it('never crosses scripts', () => {
    expect(matchLanguage(['zh-CN'], available)).toBe('zh-Hans')
    expect(matchLanguage(['zh-TW'], available)).toBeNull()
    expect(matchLanguage(['zh-TW'], ['en', 'zh'])).toBeNull()
    expect(matchLanguage(['zh-CN'], ['en', 'zh'])).toBe('zh')
    expect(matchLanguage(['sr-RS'], available)).toBeNull() // Cyrillic unless the tag says Latin
    expect(matchLanguage(['sr-Latn-RS'], available)).toBe('sr-Latn')
  })

  it('goes down the list of preferences', () => {
    expect(matchLanguage(['fr-FR', 'nl-NL', 'en-US'], available)).toBe('nl')
    expect(matchLanguage(['fr', 'de'], available)).toBeNull()
    expect(matchLanguage([], available)).toBeNull()
    expect(matchLanguage(['??', 7, 'nl'], available)).toBe('nl')
  })

  it('ignores how a tag is spelled', () => {
    expect(matchLanguage(['PT_br'], available)).toBe('pt-BR')
    expect(matchLanguage(['nl-NL-u-ca-gregory'], available)).toBe('nl')
  })
})

describe('resolveLanguage', () => {
  const available = ['en', 'nl', 'pt-BR']

  it('follows the system for "system", an unset or an unreadable setting', () => {
    for (const setting of [SYSTEM_LANGUAGE, undefined, null, '', 42, 'not a tag']) {
      expect(resolveLanguage(setting, ['nl-NL', 'en-US'], available)).toEqual({ language: 'nl', system: 'nl' })
    }
  })

  it('shows English when the system prefers nothing it has', () => {
    expect(resolveLanguage(SYSTEM_LANGUAGE, ['fr-FR'], available)).toEqual({ language: 'en', system: 'en' })
    expect(resolveLanguage(SYSTEM_LANGUAGE, [], available)).toEqual({ language: 'en', system: 'en' })
  })

  it('takes the chosen language over the system', () => {
    expect(resolveLanguage('pt-BR', ['nl-NL'], available)).toEqual({ language: 'pt-BR', system: 'nl' })
    expect(resolveLanguage('en', ['nl-NL'], available)).toEqual({ language: 'en', system: 'nl' })
  })

  it('falls back to the system when the chosen language is gone', () => {
    expect(resolveLanguage('de', ['nl-NL'], available)).toEqual({ language: 'nl', system: 'nl' })
  })
})

describe('normalizeLanguageSetting', () => {
  it('keeps "system" and tags, and reads anything else as "system"', () => {
    expect(normalizeLanguageSetting('system')).toBe('system')
    expect(normalizeLanguageSetting('nl')).toBe('nl')
    expect(normalizeLanguageSetting('pt-br')).toBe('pt-BR')
    expect(normalizeLanguageSetting(undefined)).toBe('system')
    expect(normalizeLanguageSetting('two words')).toBe('system')
  })
})

describe('languageName', () => {
  it('names a language in that language, with a capital', () => {
    expect(languageName('nl')).toBe('Nederlands')
    expect(languageName('de')).toBe('Deutsch')
    expect(languageName('en')).toBe('English')
    expect(languageName('fr')).toBe('Français')
  })

  it('can name it in another language', () => {
    expect(languageName('nl', 'en')).toBe('Dutch')
  })

  it('labels the pseudo-language', () => {
    expect(languageName(PSEUDO_LANGUAGE)).toMatch(/Pseudo/)
  })
})

describe('textDirection', () => {
  it('is right to left for Arabic and Hebrew script', () => {
    expect(textDirection('ar')).toBe('rtl')
    expect(textDirection('he')).toBe('rtl')
    expect(textDirection('fa-IR')).toBe('rtl')
    expect(textDirection('nl')).toBe('ltr')
    expect(textDirection('ja')).toBe('ltr')
  })
})
