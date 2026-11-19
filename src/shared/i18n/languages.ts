// Which language the app shows (docs/translating.md, CLAUDE.md "Translations"). Pure: no i18next,
// no Electron, no DOM; the system's languages and the catalogs on disk are passed in.

/** The language the app is written in. Its catalog (`locales/en.json`) is complete by definition. */
export const SOURCE_LANGUAGE = 'en'

/** The setting's value for "follow the system". Also what an unset or unreadable setting means. */
export const SYSTEM_LANGUAGE = 'system'

/**
 * A language made from English at run time (accented letters, longer text, brackets), offered in
 * development only. Anything on screen without the brackets is text that is still hardcoded.
 */
export const PSEUDO_LANGUAGE = 'en-XA'

/** What main tells a window: the language in use, and what "System default" stands for right now. */
export interface LanguageInfo {
  language: string
  system: string
}

/** The canonical spelling of a BCP 47 tag ("pt-br" and "pt_BR" become "pt-BR"), or null when it is none. */
export function canonicalTag(tag: unknown): string | null {
  if (typeof tag !== 'string' || tag.length === 0 || tag.length > 35) return null
  try {
    const locale = new Intl.Locale(tag.replace(/_/g, '-'))
    // Language codes are two or three letters; longer ones are reserved and no language has one,
    // so "system" or "dutch" is not a tag although its form would pass.
    if (locale.language.length > 3) return null
    // baseName drops extensions such as "-u-hc-h23", which say nothing about the language.
    return locale.baseName
  } catch {
    return null
  }
}

/** The script a tag is written in ("Latn", "Hant"), filled in from the language and region when left out. */
function scriptOf(tag: string): string {
  try {
    return new Intl.Locale(tag).maximize().script ?? ''
  } catch {
    return ''
  }
}

/**
 * The best of `available` for a reader who prefers `preferred` (most wanted first), or null when
 * none of those languages has a catalog.
 *
 * Per preferred tag: the tag itself, then its shorter forms ("pt-BR" reads "pt"), then any catalog
 * of the same language ("pt-PT" reads "pt-BR"). A catalog in another script never matches: a
 * reader of zh-TW (Traditional) gets English before Simplified Chinese.
 */
export function matchLanguage(preferred: readonly unknown[], available: readonly string[]): string | null {
  const byLower = new Map(available.map((tag) => [tag.toLowerCase(), tag]))
  for (const raw of preferred) {
    const tag = canonicalTag(raw)
    if (!tag) continue
    const script = scriptOf(tag)
    const parts = tag.split('-')
    for (let n = parts.length; n > 0; n--) {
      const hit = byLower.get(parts.slice(0, n).join('-').toLowerCase())
      if (hit && scriptOf(hit) === script) return hit
    }
    const language = parts[0].toLowerCase()
    const sibling = available.find((a) => a.split('-')[0].toLowerCase() === language && scriptOf(a) === script)
    if (sibling) return sibling
  }
  return null
}

/** The stored setting, tidied: a tag in its canonical spelling, or `SYSTEM_LANGUAGE`. */
export function normalizeLanguageSetting(raw: unknown): string {
  if (raw === SYSTEM_LANGUAGE) return SYSTEM_LANGUAGE
  return canonicalTag(raw) ?? SYSTEM_LANGUAGE
}

/**
 * The language to show: the setting when a catalog answers to it, else what the system prefers,
 * else English. A setting naming a language this version no longer has falls back the same way.
 */
export function resolveLanguage(
  setting: unknown,
  systemPreferred: readonly unknown[],
  available: readonly string[],
): LanguageInfo {
  const system = matchLanguage(systemPreferred, available) ?? SOURCE_LANGUAGE
  const chosen = normalizeLanguageSetting(setting)
  if (chosen === SYSTEM_LANGUAGE) return { language: system, system }
  return { language: matchLanguage([chosen], available) ?? system, system }
}

/**
 * A language's name for a picker, by default in the language itself ("Nederlands", "Deutsch"), so
 * a reader finds theirs whatever the app shows now. Falls back to the tag.
 */
export function languageName(tag: string, inLanguage: string = tag): string {
  if (tag === PSEUDO_LANGUAGE) return 'Pseudo (development)'
  try {
    const name = new Intl.DisplayNames([inLanguage], { type: 'language' }).of(tag)
    if (!name || name === tag) return tag
    // Many languages write their own name in lower case; a list of names starts each with a capital.
    return name.charAt(0).toLocaleUpperCase(inLanguage) + name.slice(1)
  } catch {
    return tag
  }
}

const RTL_SCRIPTS = new Set(['Arab', 'Hebr', 'Thaa', 'Syrc', 'Nkoo', 'Adlm', 'Rohg'])

/** The direction a language is written in, for the page's `dir`. */
export function textDirection(tag: string): 'ltr' | 'rtl' {
  return RTL_SCRIPTS.has(scriptOf(tag)) ? 'rtl' : 'ltr'
}
