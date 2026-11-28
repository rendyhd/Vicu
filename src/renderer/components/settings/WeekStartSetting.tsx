import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { TranslationKey } from '../../../shared/i18n'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useSetSyncedPreference } from '@/hooks/use-synced-prefs'
import { useWeekStart } from '@/hooks/use-week-start'
import {
  WEEK_START_CHOICES,
  WEEK_START_KEY,
  weekStartOffer,
  writeWeekStart,
  type WeekStart,
} from '../../../shared/week-start'

const DAY_NAMES: Record<WeekStart, TranslationKey> = {
  monday: 'settings.weekStart.monday',
  sunday: 'settings.weekStart.sunday',
  saturday: 'settings.weekStart.saturday',
}

/** The same names inside a sentence (some languages write them in lowercase there). */
const DAY_NAMES_IN_TEXT: Record<WeekStart, TranslationKey> = {
  monday: 'settings.weekStart.inText.monday',
  sunday: 'settings.weekStart.inText.sunday',
  saturday: 'settings.weekStart.inText.saturday',
}

/**
 * "Week starts on" (Settings, Preferences; cross-app semantics 2.1): Monday, Sunday or Saturday, a
 * synced setting, so the choice reaches every device of the account. Calendars, the This week
 * window and which week Next week means follow it; repeat rules do not.
 *
 * While the Vikunja account's own week start is one of the three and differs from the one in use,
 * a line under the choices offers it. Vicu only reads that setting, and only here.
 */
export function WeekStartSetting() {
  const { t } = useTranslation()
  const weekStart = useWeekStart()
  const set = useSetSyncedPreference()
  // Read while the setting is on screen. No answer (offline, a token without the right): no offer.
  const { data: vikunja = null } = useQuery({
    queryKey: ['vikunja-week-start'],
    queryFn: async () => (await api.getUser())?.week_start ?? null,
    staleTime: 60_000,
    retry: false,
  })
  const offer = weekStartOffer(vikunja, weekStart)
  const choose = (next: WeekStart) => set.mutate({ key: WEEK_START_KEY, value: writeWeekStart(next) })

  return (
    <div>
      <label className="mb-2 block text-xs text-[var(--text-secondary)]">{t('settings.weekStart.label')}</label>
      <div className="flex gap-3" role="radiogroup" aria-label={t('settings.weekStart.label')}>
        {WEEK_START_CHOICES.map((opt) => (
          <label
            key={opt.value}
            className={cn(
              'flex cursor-pointer items-center gap-1.5 rounded-control border px-3 py-1.5 text-xs font-medium transition-colors',
              weekStart === opt.value
                ? 'border-accent-blue bg-accent-blue/10 text-accent-blue'
                : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:border-[var(--text-secondary)]'
            )}
          >
            <input
              type="radio"
              name="week_start"
              value={opt.value}
              checked={weekStart === opt.value}
              onChange={() => choose(opt.value)}
              className="sr-only"
            />
            {t(DAY_NAMES[opt.value])}
          </label>
        ))}
      </div>
      <p className="mt-1.5 text-xs text-[var(--text-secondary)]">
        {t('settings.weekStart.note')}
      </p>
      {offer && (
        <p className="mt-1 text-xs text-[var(--text-secondary)]">
          {t('settings.weekStart.vikunjaIs', { day: t(DAY_NAMES_IN_TEXT[offer]) })}{' '}
          <button
            type="button"
            onClick={() => choose(offer)}
            className="rounded-control font-medium text-accent-blue hover:underline"
          >
            {t('settings.weekStart.use', { day: t(DAY_NAMES[offer]) })}
          </button>
        </p>
      )}
    </div>
  )
}
