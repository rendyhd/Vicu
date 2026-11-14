import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useSetSyncedPreference } from '@/hooks/use-synced-prefs'
import { useWeekStart } from '@/hooks/use-week-start'
import {
  WEEK_START_CHOICES,
  WEEK_START_KEY,
  weekStartLabel,
  weekStartOffer,
  writeWeekStart,
  type WeekStart,
} from '../../../shared/week-start'

/**
 * "Week starts on" (Settings, Preferences; cross-app semantics 2.1): Monday, Sunday or Saturday, a
 * synced setting, so the choice reaches every device of the account. Calendars, the This week
 * window and which week Next week means follow it; repeat rules do not.
 *
 * While the Vikunja account's own week start is one of the three and differs from the one in use,
 * a line under the choices offers it. Vicu only reads that setting, and only here.
 */
export function WeekStartSetting() {
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
      <label className="mb-2 block text-xs text-[var(--text-secondary)]">Week starts on</label>
      <div className="flex gap-3" role="radiogroup" aria-label="Week starts on">
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
            {opt.label}
          </label>
        ))}
      </div>
      <p className="mt-1.5 text-xs text-[var(--text-secondary)]">
        Calendars, This week and Next week follow it. Syncs to your other devices.
      </p>
      {offer && (
        <p className="mt-1 text-xs text-[var(--text-secondary)]">
          Vikunja is set to {weekStartLabel(offer)}.{' '}
          <button
            type="button"
            onClick={() => choose(offer)}
            className="rounded-control font-medium text-accent-blue hover:underline"
          >
            Use {weekStartLabel(offer)}
          </button>
        </p>
      )}
    </div>
  )
}
