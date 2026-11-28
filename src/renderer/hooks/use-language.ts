import { useSyncExternalStore } from 'react'
import type { LanguageInfo } from '../../shared/i18n'
import { getLanguageInfo, subscribeLanguageInfo } from '@/lib/language'

/**
 * The language in use and what "System default" stands for; the component renders again when
 * either changes. To translate text, a component uses `useTranslation()` instead.
 */
export function useLanguageInfo(): LanguageInfo {
  return useSyncExternalStore(subscribeLanguageInfo, getLanguageInfo, getLanguageInfo)
}
