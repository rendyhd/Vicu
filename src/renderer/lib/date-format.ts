import { localeUsesHour12, type DateFormat } from './date-display'

// The locale and clock dates are phrased with in this window. Main owns the answer (the system
// locale, plus the Settings clock choice) and sends it to all three windows; until it arrives the
// browser's own language and its hour cycle are used. No React here: Quick Entry and Quick View
// use this module without it (the hook is in hooks/use-date-format.ts).

function browserFormat(): DateFormat {
  const locale = typeof navigator !== 'undefined' && navigator.language ? navigator.language : 'en-US'
  return { locale, hour12: localeUsesHour12(locale) }
}

let current: DateFormat = browserFormat()
const listeners = new Set<() => void>()

export function getDateFormat(): DateFormat {
  return current
}

export function setDateFormat(next: DateFormat): void {
  if (next.locale === current.locale && next.hour12 === current.hour12) return
  current = { locale: next.locale, hour12: next.hour12 }
  for (const listener of [...listeners]) listener()
}

export function subscribeDateFormat(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function isDateFormat(value: unknown): value is DateFormat {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return typeof v.locale === 'string' && v.locale.length > 0 && typeof v.hour12 === 'boolean'
}

/** What a window's preload offers: ask once, then follow changes. */
export interface DateFormatSource {
  getDateFormat(): Promise<unknown>
  onDateFormatChanged(cb: (format: DateFormat) => void): unknown
}

/** Loads the format from main and keeps following it. Resolves when the first answer is in (or failed). */
export async function initDateFormat(source: DateFormatSource): Promise<void> {
  source.onDateFormatChanged((format) => { if (isDateFormat(format)) setDateFormat(format) })
  try {
    const format = await source.getDateFormat()
    if (isDateFormat(format)) setDateFormat(format)
  } catch {
    // Keep the browser's format; main may not be ready.
  }
}
