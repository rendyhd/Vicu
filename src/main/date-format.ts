import { app } from 'electron'
import { dateFormatFor, isClockFormat, type DateFormat } from '../shared/date-display'
import { loadConfig, type AppConfig } from './config'
import { sendToAppWindows } from './offline/service'

/**
 * The locale and clock every window phrases dates with (docs/cross-app-semantics-v1.md section 8):
 * the system locale (`app.getSystemLocale()`), and its hour cycle unless Settings forces the 12-hour
 * or 24-hour clock. Windows cannot see an OS custom format, hence the Settings choice.
 */
export function currentDateFormat(config: Pick<AppConfig, 'clock_format'> | null = loadConfig()): DateFormat {
  let locale = 'en-US'
  try {
    locale = app.getSystemLocale() || locale
  } catch { /* not ready or unavailable: keep the default */ }
  const clock = config?.clock_format
  return dateFormatFor(locale, isClockFormat(clock) ? clock : 'system')
}

/** What the windows were last told, or null while none has asked (they ask when they load). */
let lastSent: string | null = null

/** The answer to a window's `get-date-format` call; remembers it as what the windows know. */
export function dateFormatForWindow(): DateFormat {
  const format = currentDateFormat()
  lastSent = JSON.stringify(format)
  return format
}

/** After a config change: tells all three windows the new format when it differs from what they know. */
export function announceDateFormatIfChanged(config: Pick<AppConfig, 'clock_format'> | null): void {
  if (lastSent === null) return
  const format = currentDateFormat(config)
  const snapshot = JSON.stringify(format)
  if (snapshot === lastSent) return
  lastSent = snapshot
  sendToAppWindows('date-format-changed', format)
}
