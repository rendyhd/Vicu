import { createInstance, type ParseKeys, type TFunction } from 'i18next'
import { SOURCE_CATALOG, loadCatalog } from './catalogs'
import { SOURCE_LANGUAGE } from './languages'

// The app's text in the reader's language (docs/translating.md for translators, CLAUDE.md
// "Translations" for the rules in code). One i18next instance per process and window, ready as
// soon as this module is imported: English is in the bundle, so `t` never has to wait. Main picks
// the language (src/main/i18n.ts) and the windows follow it (src/renderer/lib/language.ts).
//
//   import { t } from '../shared/i18n'            anywhere outside React, called when the text is needed
//   const { t } = useTranslation()                in a component, so it draws again when the language changes
//
// Never call `t` at module scope (a table of labels filled at import keeps its first language):
// keep the key, a `TranslationKey`, and translate where the text is shown.

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation'
    // Every `t('some.key')` is checked against the English catalog by the compiler.
    resources: { translation: typeof SOURCE_CATALOG }
  }
}

/** A key of `locales/en.json` (plural keys without their `_one` / `_other` ending). */
export type TranslationKey = ParseKeys

const NAMESPACE = 'translation'

export const i18n = createInstance()

void i18n.init({
  lng: SOURCE_LANGUAGE,
  fallbackLng: SOURCE_LANGUAGE,
  resources: { [SOURCE_LANGUAGE]: { [NAMESPACE]: SOURCE_CATALOG } },
  // Synchronous: the resources are given, nothing is fetched.
  initAsync: false,
  // Text goes into React (which escapes) or native menus and notifications (plain text). A window
  // that writes HTML itself escapes what it writes, translated or not.
  interpolation: { escapeValue: false },
  // An empty translation is a missing one: show the English text.
  returnEmptyString: false,
  react: { useSuspense: false },
})

/** The text for a key in the language in use. Follows `setLanguage`; safe to keep and call later. */
export const t: TFunction = i18n.t

/** `t` fixed to English: what the cross-app fixtures pin, and what a log or a server reads. */
export const englishT: TFunction = i18n.getFixedT(SOURCE_LANGUAGE)

let switching: Promise<void> = Promise.resolve()

/**
 * Shows `tag` from now on: loads its catalog on first use, then switches. Missing keys, and a
 * language without a catalog, read English. Calls run one after another, so the last one wins.
 */
export function setLanguage(tag: string): Promise<void> {
  switching = switching.then(async () => {
    if (tag !== SOURCE_LANGUAGE && !i18n.hasResourceBundle(tag, NAMESPACE)) {
      const catalog = await loadCatalog(tag)
      if (catalog) i18n.addResourceBundle(tag, NAMESPACE, catalog, true, true)
    }
    if (i18n.language !== tag) await i18n.changeLanguage(tag)
  }).catch(() => { /* keep the language in use */ })
  return switching
}

/** The language in use. */
export function currentLanguage(): string {
  return i18n.language || SOURCE_LANGUAGE
}

/** Runs `listener` after every change of language; returns the function that stops it. */
export function onLanguageChange(listener: (language: string) => void): () => void {
  i18n.on('languageChanged', listener)
  return () => { i18n.off('languageChanged', listener) }
}

export { availableLanguages } from './catalogs'
export * from './languages'
