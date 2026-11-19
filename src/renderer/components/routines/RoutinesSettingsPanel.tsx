import { useTranslation } from 'react-i18next'
import { Checkbox } from '@/components/shared/Checkbox'
import { Switch } from '@/components/shared/Switch'
import { isRoutinesEnabled, type AppConfig } from '@/lib/vikunja-types'
import { useRoutines } from '@/hooks/use-routines'
import { useSetSyncedPreference } from '@/hooks/use-synced-prefs'
import { routineHiddenKey } from '../../../shared/synced-prefs'
import { TODAY_ROUTINES_LIMITS, todayRoutinesLimit } from '../../../shared/today-routines'

interface RoutinesSettingsPanelProps {
  config: AppConfig
  onChange: (partial: Partial<AppConfig>) => void
}

export function RoutinesSettingsPanel({ config, onChange }: RoutinesSettingsPanelProps) {
  const { t } = useTranslation()
  const enabled = isRoutinesEnabled(config)
  const inToday = config.routines_in_today !== false
  const limit = todayRoutinesLimit(config.routines_today_limit)

  return (
    <div className="rounded-card border border-[var(--border-color)] bg-[var(--bg-primary)] p-5">
      <h2 className="mb-1 text-sm font-semibold text-[var(--text-primary)]">{t('settings.routines.title')}</h2>
      <p className="mb-4 text-xs text-[var(--text-secondary)]">
        {t('settings.routines.note')}
      </p>

      <div className="space-y-3">
        <label className="flex cursor-pointer items-center gap-2">
          <Switch
            checked={enabled}
            onCheckedChange={(checked) => onChange({ routines_enabled: checked })}
          />
          <span className="text-sm text-[var(--text-primary)]">{t('settings.routines.enable')}</span>
        </label>

        <label className="flex cursor-pointer items-start gap-2">
          <Checkbox
            checked={inToday}
            disabled={!enabled}
            onChange={(e) => onChange({ routines_in_today: e.target.checked })}
            className="mt-0.5"
          />
          <div>
            <div className="text-sm text-[var(--text-primary)]">{t('settings.routines.inToday')}</div>
            <p className="text-xs text-[var(--text-secondary)]">
              {t('settings.routines.inTodayNote')}
            </p>
          </div>
        </label>

        {enabled && inToday && (
          <div className="pl-6">
            <label htmlFor="routines-today-limit" className="text-sm text-[var(--text-primary)]">{t('settings.routines.limit')}</label>
            <p className="mb-2 mt-0.5 text-xs text-[var(--text-secondary)]">
              {t('settings.routines.limitNote')}
            </p>
            <select
              id="routines-today-limit"
              value={String(limit)}
              onChange={(e) => onChange({ routines_today_limit: todayRoutinesLimit(e.target.value === 'all' ? 'all' : Number(e.target.value)) })}
              className="w-40 rounded-control border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1.5 text-sm text-[var(--text-primary)]"
            >
              {TODAY_ROUTINES_LIMITS.map((choice) => (
                <option key={choice} value={String(choice)}>
                  {choice === 'all' ? t('settings.routines.all') : choice}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {enabled && <HiddenSharedRoutines />}
    </div>
  )
}

/** The shared routines this account hid (section 6.9), to show again. Nothing while there are none. */
function HiddenSharedRoutines() {
  const { t } = useTranslation()
  const { hiddenShared } = useRoutines()
  const setPref = useSetSyncedPreference()
  if (hiddenShared.length === 0) return null
  return (
    <div className="mt-5 border-t border-[var(--border-color)] pt-4">
      <h3 className="mb-1 text-sm font-medium text-[var(--text-primary)]">{t('settings.routines.hidden.title')}</h3>
      <p className="mb-3 text-xs text-[var(--text-secondary)]">{t('settings.routines.hidden.note')}</p>
      <ul className="space-y-1.5">
        {hiddenShared.map((carrier) => (
          <li key={carrier.payload.definition.id} className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm text-[var(--text-primary)]">{carrier.payload.definition.name}</span>
            <button
              type="button"
              onClick={() => setPref.mutate({ key: routineHiddenKey(carrier.payload.definition.id), value: null })}
              className="rounded-control px-2 py-1 text-xs font-medium text-accent-blue hover:bg-[var(--bg-hover)]"
            >
              {t('settings.routines.hidden.show')}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
