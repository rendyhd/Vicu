import { app } from 'electron'
import { availableLanguages, resolveLanguage, setLanguage, type LanguageInfo } from '../shared/i18n'
import { loadConfig, type AppConfig } from './config'
import { sendToAppWindows } from './offline/service'

// The language of the main process and, through it, of every window (src/shared/i18n). Main owns
// the answer: the Language setting, or what the computer prefers when that is "System default".
// The windows ask when they load (`get-language`) and follow `language-changed`; menus and the
// tray rebuild through `onMainLanguageChange`.

type LanguageConfig = Pick<AppConfig, 'language'> | null

/** The languages the computer's user prefers, most wanted first. */
function systemLanguages(): string[] {
  try {
    const preferred = app.getPreferredSystemLanguages()
    if (preferred.length > 0) return preferred
  } catch { /* not available on this system: fall through */ }
  try {
    return [app.getLocale()]
  } catch {
    return []
  }
}

/** The language to show for a config, and what "System default" stands for. */
export function languageFor(config: LanguageConfig = loadConfig()): LanguageInfo {
  return resolveLanguage(config?.language, systemLanguages(), availableLanguages())
}

let applied: string | null = null
const listeners = new Set<() => void>()

/** Runs after the main process changed language (rebuild a menu); returns the function that stops it. */
export function onMainLanguageChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/**
 * Makes the main process speak the configured language and tells the windows, when it differs
 * from what is in use. Called once before the first menu is built and after every config save.
 */
export async function applyLanguage(config: LanguageConfig = loadConfig()): Promise<void> {
  const info = languageFor(config)
  const snapshot = JSON.stringify(info)
  if (snapshot === applied) return
  const first = applied === null
  applied = snapshot
  await setLanguage(info.language)
  if (first) return
  for (const listener of [...listeners]) {
    try {
      listener()
    } catch (err) {
      console.warn('[i18n] a language listener failed:', err instanceof Error ? err.message : err)
    }
  }
  sendToAppWindows('language-changed', info)
}

/** The answer to a window's `get-language` call. */
export function languageForWindow(): LanguageInfo {
  return languageFor()
}
