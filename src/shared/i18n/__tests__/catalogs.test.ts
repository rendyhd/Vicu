import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  catalogLanguages,
  checkCatalogs,
  checkSource,
  checkTranslation,
  unusedKeys,
} from '../../../../scripts/i18n.mjs'
import { COMPLETION_TOAST_ACTION, completionToastText } from '../../completion-hold'
import { PSEUDO_LANGUAGE, SOURCE_LANGUAGE, availableLanguages, currentLanguage, englishT, onLanguageChange, setLanguage, t } from '../index'
import { pseudoText } from '../pseudo'

// The catalogs in locales/ and the instance that reads them (docs/translating.md). The checks are
// the ones `npm run i18n:check` prints, so a translation that fails here fails there with the same words.

describe('the catalogs in locales/', () => {
  it('have no problems (npm run i18n:check lists them)', () => {
    expect(checkCatalogs()).toEqual([])
  })

  it('have no key that no code uses', () => {
    expect(unusedKeys(), 'remove these from locales/en.json and from the translations').toEqual([])
  })

  it('are the languages the app offers, without anyone listing them', () => {
    expect(availableLanguages(false)).toEqual(catalogLanguages())
    expect(availableLanguages(true)).toEqual([...catalogLanguages(), PSEUDO_LANGUAGE])
  })
})

describe('checkSource', () => {
  it('wants lowerCamelCase keys, text, and both English plural forms', () => {
    expect(checkSource({ nav: { inbox: 'Inbox' }, done: { toast_one: 'Done', toast_other: '{{count}} done' } })).toEqual([])
    expect(checkSource({ Nav: { inbox: 'Inbox' } })[0]).toMatch(/lowerCamelCase/)
    expect(checkSource({ nav: { 'in-box': 'Inbox' } })[0]).toMatch(/lowerCamelCase/)
    expect(checkSource({ nav: { inbox: '' } })[0]).toMatch(/empty/)
    expect(checkSource({ nav: { inbox: ' Inbox' } })[0]).toMatch(/space/)
    expect(checkSource({ nav: { inbox: 3 } })[0]).toMatch(/text or a group/)
    expect(checkSource({ note: 'Read <link>the guide</link>' })[0]).toMatch(/<link> is an HTML element without content/)
    expect(checkSource({ note: 'Read <guide>the guide</guide>, line<br/>two' })).toEqual([])
    expect(checkSource({ done: { toast_other: '{{count}} done' } })[0]).toMatch(/_one is missing/)
    expect(checkSource({ done: { toast_one: 'a', toast_other: 'b', toast_few: 'c' } })[0]).toMatch(/no plural form "few"/)
  })
})

describe('checkTranslation', () => {
  const source = {
    nav: { inbox: 'Inbox' },
    hello: 'Hello {{name}}',
    note: 'Read <guide>the guide</guide>',
    done: { toast_one: 'Completed', toast_other: '{{count}} completed' },
  }

  it('accepts a partial translation: a missing key reads English', () => {
    expect(checkTranslation('nl', { nav: { inbox: 'Inbox' } }, source)).toEqual([])
    expect(checkTranslation('nl', {}, source)).toEqual([])
  })

  it('refuses a key the source does not have', () => {
    expect(checkTranslation('nl', { nav: { outbox: 'Uit' } }, source)[0]).toMatch(/nav\.outbox: is not a key/)
  })

  it('refuses a changed, added or dropped placeholder', () => {
    expect(checkTranslation('nl', { hello: 'Hallo {{naam}}' }, source).join('\n')).toMatch(/\{\{naam\}\} is not in the English text/)
    expect(checkTranslation('nl', { hello: 'Hallo' }, source)[0]).toMatch(/\{\{name\}\} of the English text is missing/)
    expect(checkTranslation('nl', { hello: 'Hallo {{ name }}' }, source)).toEqual([])
  })

  it('refuses changed tags', () => {
    expect(checkTranslation('nl', { note: 'Lees de gids' }, source)[0]).toMatch(/tags differ/)
    expect(checkTranslation('nl', { note: 'Lees <a>de gids</a>' }, source)[0]).toMatch(/tags differ/)
    expect(checkTranslation('nl', { note: '<guide>De gids</guide> lezen' }, source)).toEqual([])
  })

  it('wants every plural form the language has, and no other', () => {
    expect(checkTranslation('nl', { done: { toast_one: 'Voltooid', toast_other: '{{count}} voltooid' } }, source)).toEqual([])
    expect(checkTranslation('nl', { done: { toast_other: '{{count}} voltooid' } }, source)[0]).toMatch(/_one is missing/)
    // Polish has one, few, many and other.
    const polish = { done: { toast_one: 'a', toast_few: '{{count}} b', toast_many: '{{count}} c', toast_other: '{{count}} d' } }
    expect(checkTranslation('pl', polish, source)).toEqual([])
    expect(checkTranslation('pl', { done: { toast_one: 'a', toast_other: 'd' } }, source).join('\n')).toMatch(/_few is missing/)
    // Japanese has only other.
    expect(checkTranslation('ja', { done: { toast_other: '{{count}}' } }, source)).toEqual([])
    expect(checkTranslation('ja', { done: { toast_one: 'a', toast_other: 'b' } }, source)[0]).toMatch(/ja has no plural form "one"/)
  })

  it('refuses an empty text and a file name that is not a language tag', () => {
    expect(checkTranslation('nl', { nav: { inbox: '' } }, source)[0]).toMatch(/empty/)
    expect(checkTranslation('dutch_NL', {}, source)[0]).toMatch(/not a language tag/)
    expect(checkTranslation('pt-br', {}, source)[0]).toMatch(/use "pt-BR\.json"/)
  })
})

describe('the instance', () => {
  afterEach(() => setLanguage(SOURCE_LANGUAGE))

  it('speaks English as soon as it is imported', () => {
    expect(currentLanguage()).toBe('en')
    expect(t('nav.inbox')).toBe('Inbox')
    expect(t('language.system', { language: 'Nederlands' })).toBe('System default (Nederlands)')
  })

  it('switches, tells its listeners, and the same `t` follows', async () => {
    const seen: string[] = []
    const stop = onLanguageChange((language) => seen.push(language))
    await setLanguage('nl')
    expect(currentLanguage()).toBe('nl')
    expect(t('nav.today')).toBe('Vandaag')
    expect(t('completion.toast', { count: 3 })).toBe('3 voltooid')
    expect(englishT('nav.today')).toBe('Today')
    await setLanguage('en')
    expect(t('nav.today')).toBe('Today')
    stop()
    await setLanguage('nl')
    expect(seen).toEqual(['nl', 'en'])
  })

  it('reads English for a language without a catalog', async () => {
    await setLanguage('xx')
    expect(t('nav.today')).toBe('Today')
  })

  it('lets the last of several quick changes win', async () => {
    void setLanguage('nl')
    void setLanguage(PSEUDO_LANGUAGE)
    await setLanguage('nl')
    expect(currentLanguage()).toBe('nl')
  })

  it('has the pseudo-language for development', async () => {
    await setLanguage(PSEUDO_LANGUAGE)
    expect(t('nav.today')).toBe(pseudoText('Today'))
    expect(t('completion.toast', { count: 2 })).toContain('2')
  })
})

describe('pseudoText', () => {
  it('accents and pads, and leaves placeholders and tags alone', () => {
    expect(pseudoText('Today')).toBe('[Ţöđáý ~~]')
    expect(pseudoText('{{count}} completed')).toMatch(/^\[\{\{count\}\} çöɱþļéţéđ ~+\]$/)
    expect(pseudoText('Read <guide>the guide</guide>')).toContain('<guide>')
    expect(pseudoText('Read <guide>the guide</guide>')).toContain('</guide>')
  })
})

// Text the cross-app contract pins (docs/cross-app-semantics-v1.md) is English in the fixture and
// in the pure module; the catalog's English must say the same, so a translation starts from it.
describe('English text the contract pins', () => {
  const fixture = JSON.parse(
    readFileSync(resolve(__dirname, '..', '..', '..', '..', 'test-fixtures', 'cross-app-semantics-v1.json'), 'utf8'),
  ).completion.toast as { single: string; many: string; action: string }

  it('the completion toast (section 7)', () => {
    expect(englishT('completion.toast', { count: 1 })).toBe(fixture.single)
    expect(englishT('completion.toast', { count: 1 })).toBe(completionToastText(1))
    for (const n of [2, 12]) {
      expect(englishT('completion.toast', { count: n })).toBe(fixture.many.replace('{n}', String(n)))
      expect(englishT('completion.toast', { count: n })).toBe(completionToastText(n))
    }
    expect(englishT('completion.undo')).toBe(fixture.action)
    expect(englishT('completion.undo')).toBe(COMPLETION_TOAST_ACTION)
  })
})

describe('typed keys', () => {
  it('a key that is not in locales/en.json does not compile (npm run typecheck)', () => {
    // @ts-expect-error not a key of the English catalog
    expect(englishT('nav.notThere')).toBe('nav.notThere')
  })
})
