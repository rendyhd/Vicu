import { SOURCE_LANGUAGE, setLanguage, textDirection, type LanguageInfo } from '../../shared/i18n'

// The language of this window. Main owns the answer (the Language setting, or the system's
// preference) and sends it to all three windows; until it arrives the window shows English. No
// React here: Quick Entry and Quick View use this module without it (the hook is in
// hooks/use-language.ts, and components translate with `useTranslation()`).

let current: LanguageInfo = { language: SOURCE_LANGUAGE, system: SOURCE_LANGUAGE }
const listeners = new Set<() => void>()

/** The language in use and what "System default" stands for. */
export function getLanguageInfo(): LanguageInfo {
  return current
}

export function subscribeLanguageInfo(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function isLanguageInfo(value: unknown): value is LanguageInfo {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return typeof v.language === 'string' && v.language.length > 0 && typeof v.system === 'string' && v.system.length > 0
}

async function apply(info: LanguageInfo): Promise<void> {
  await setLanguage(info.language)
  current = { language: info.language, system: info.system }
  if (typeof document !== 'undefined') {
    // Screen readers pick their voice, and the engine its fonts and hyphenation, from `lang`.
    document.documentElement.lang = info.language
    document.documentElement.dir = textDirection(info.language)
  }
  for (const listener of [...listeners]) listener()
}

/** What a window's preload offers: ask once, then follow changes. */
export interface LanguageSource {
  getLanguage(): Promise<unknown>
  onLanguageChanged(cb: (info: LanguageInfo) => void): unknown
}

/** Loads the language from main and keeps following it. Resolves when the first answer is shown (or failed). */
export async function initLanguage(source: LanguageSource): Promise<void> {
  source.onLanguageChanged((info) => { if (isLanguageInfo(info)) void apply(info) })
  try {
    const info = await source.getLanguage()
    if (isLanguageInfo(info)) await apply(info)
  } catch {
    // Keep English; main may not be ready.
  }
}
