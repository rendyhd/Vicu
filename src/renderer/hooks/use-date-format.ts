import { useSyncExternalStore } from 'react'
import type { DateFormat } from '@/lib/date-display'
import { getDateFormat, subscribeDateFormat } from '@/lib/date-format'

/** The locale and clock for dates; the component renders again when the clock setting changes. */
export function useDateFormat(): DateFormat {
  return useSyncExternalStore(subscribeDateFormat, getDateFormat, getDateFormat)
}
