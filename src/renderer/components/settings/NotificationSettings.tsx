import { Checkbox } from '@/components/shared/Checkbox'
import { Switch } from '@/components/shared/Switch'
import { Button } from '@/components/shared/Button'
import { useState } from 'react'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import type { AppConfig } from '@/lib/vikunja-types'
import { useLocationReminders } from '@/hooks/use-location-reminders'
import { MapPin } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { TranslationKey } from '../../../shared/i18n'

interface NotificationSettingsProps {
  config: AppConfig
  onChange: (partial: Partial<AppConfig>) => void
}

const OFFSET_OPTIONS: ReadonlyArray<{ label: TranslationKey; value: number }> = [
  { label: 'settings.notifications.offset.none', value: 0 },
  { label: 'settings.notifications.offset.atDue', value: -1 },
  { label: 'settings.notifications.offset.min5', value: 300 },
  { label: 'settings.notifications.offset.min15', value: 900 },
  { label: 'settings.notifications.offset.min30', value: 1800 },
  { label: 'settings.notifications.offset.hour1', value: 3600 },
  { label: 'settings.notifications.offset.hour3', value: 10800 },
  { label: 'settings.notifications.offset.day1', value: 86400 },
]

/** While the master switch is off the sections are dimmed: take them out of the Tab order and the accessibility tree too. */
function inertWhen(off: boolean) {
  return (el: HTMLDivElement | null) => {
    if (el) el.inert = off
  }
}

export function NotificationSettings({ config, onChange }: NotificationSettingsProps) {
  const { t } = useTranslation()
  const [testStatus, setTestStatus] = useState<'idle' | 'sent'>('idle')
  const enabled = config.notifications_enabled ?? false

  const handleTestNotification = async () => {
    await api.testNotification()
    setTestStatus('sent')
    setTimeout(() => setTestStatus('idle'), 3000)
  }

  const handleOffsetChange = (dropdownValue: number) => {
    onChange({ notifications_default_reminder_offset: dropdownValue })
  }

  const offsetDropdownValue = config.notifications_default_reminder_offset ?? 0

  return (
    <div className="space-y-4">
      {/* Master toggle */}
      <div className="rounded-card border border-[var(--border-color)] bg-[var(--bg-primary)] p-5">
        <label className="flex cursor-pointer items-center gap-2">
          <Switch
            checked={enabled}
            onCheckedChange={(checked) => onChange({ notifications_enabled: checked })}
          />
          <span className="text-sm font-semibold text-[var(--text-primary)]">{t('settings.notifications.enable')}</span>
        </label>
        {window.api.platform === 'darwin' && (
          <p className="mt-2 text-xs text-[var(--text-secondary)]">
            {t('settings.notifications.macNote')}
          </p>
        )}
      </div>

      {/* ── Scheduled Reminders ── */}
      <div className={cn(
        'rounded-card border border-[var(--border-color)] bg-[var(--bg-primary)] p-5',
        !enabled && 'pointer-events-none opacity-40'
      )} ref={inertWhen(!enabled)}>
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">{t('settings.notifications.scheduled.title')}</h2>
        <p className="mb-4 mt-1 text-xs text-[var(--text-secondary)]">
          {t('settings.notifications.scheduled.note')}
        </p>

        <div className="space-y-4">
          {/* Primary time */}
          <div className="flex items-center gap-3">
            <label className="flex flex-1 cursor-pointer items-center gap-2">
              <Checkbox
                checked={config.notifications_daily_reminder_enabled !== false}
                onChange={(e) => onChange({ notifications_daily_reminder_enabled: e.target.checked })}
              />
              <span className="text-sm text-[var(--text-primary)]">{t('settings.notifications.scheduled.morning')}</span>
            </label>
            <div className="flex items-center gap-1.5">
              <input
                type="time"
                aria-label={t('settings.notifications.scheduled.morningTime')}
                value={config.notifications_daily_reminder_time || '08:00'}
                onChange={(e) => onChange({ notifications_daily_reminder_time: e.target.value })}
                className="rounded-control border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1 text-sm text-[var(--text-primary)]"
              />
            </div>
          </div>

          {/* Secondary time */}
          <div className="flex items-center gap-3">
            <label className="flex flex-1 cursor-pointer items-center gap-2">
              <Checkbox
                checked={config.notifications_secondary_reminder_enabled ?? false}
                onChange={(e) => onChange({ notifications_secondary_reminder_enabled: e.target.checked })}
              />
              <span className="text-sm text-[var(--text-primary)]">{t('settings.notifications.scheduled.afternoon')}</span>
            </label>
            <div className="flex items-center gap-1.5">
              <input
                type="time"
                aria-label={t('settings.notifications.scheduled.afternoonTime')}
                value={config.notifications_secondary_reminder_time || '16:00'}
                onChange={(e) => onChange({ notifications_secondary_reminder_time: e.target.value })}
                className="rounded-control border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1 text-sm text-[var(--text-primary)]"
              />
            </div>
          </div>

          {/* Include */}
          <div className="border-t border-[var(--border-color)] pt-3">
            <span className="text-xs font-medium text-[var(--text-secondary)]">{t('settings.notifications.scheduled.include')}</span>
            <div className="mt-2 space-y-2">
              <label className="flex cursor-pointer items-center gap-2">
                <Checkbox
                  checked={config.notifications_overdue_enabled !== false}
                  onChange={(e) => onChange({ notifications_overdue_enabled: e.target.checked })}
                />
                <span className="text-sm text-[var(--text-primary)]">{t('settings.notifications.scheduled.overdue')}</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <Checkbox
                  checked={config.notifications_due_today_enabled !== false}
                  onChange={(e) => onChange({ notifications_due_today_enabled: e.target.checked })}
                />
                <span className="text-sm text-[var(--text-primary)]">{t('settings.notifications.scheduled.dueToday')}</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <Checkbox
                  checked={config.notifications_upcoming_enabled ?? false}
                  onChange={(e) => onChange({ notifications_upcoming_enabled: e.target.checked })}
                />
                <span className="text-sm text-[var(--text-primary)]">{t('settings.notifications.scheduled.dueTomorrow')}</span>
              </label>
            </div>
          </div>

          {/* Behavior */}
          <div className="border-t border-[var(--border-color)] pt-3">
            <div className="space-y-2">
              <label className="flex cursor-pointer items-center gap-2">
                <Checkbox
                  checked={config.notifications_sound !== false}
                  onChange={(e) => onChange({ notifications_sound: e.target.checked })}
                />
                <span className="text-sm text-[var(--text-primary)]">{t('settings.notifications.playSound')}</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <Checkbox
                  checked={config.notifications_persistent ?? false}
                  onChange={(e) => onChange({ notifications_persistent: e.target.checked })}
                />
                <span className="text-sm text-[var(--text-primary)]">{t('settings.notifications.stay')}</span>
              </label>
            </div>
          </div>
        </div>
      </div>

      {/* ── Task Reminders ── */}
      <div className={cn(
        'rounded-card border border-[var(--border-color)] bg-[var(--bg-primary)] p-5',
        !enabled && 'pointer-events-none opacity-40'
      )} ref={inertWhen(!enabled)}>
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">{t('settings.notifications.task.title')}</h2>
        <p className="mb-4 mt-1 text-xs text-[var(--text-secondary)]">
          {t('settings.notifications.task.note')}
        </p>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="flex cursor-pointer items-center gap-2">
              <Checkbox
                checked={config.notifications_task_reminder_sound !== false}
                onChange={(e) => onChange({ notifications_task_reminder_sound: e.target.checked })}
              />
              <span className="text-sm text-[var(--text-primary)]">{t('settings.notifications.playSound')}</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <Checkbox
                checked={config.notifications_task_reminder_persistent ?? false}
                onChange={(e) => onChange({ notifications_task_reminder_persistent: e.target.checked })}
              />
              <span className="text-sm text-[var(--text-primary)]">{t('settings.notifications.stay')}</span>
            </label>
          </div>

          {/* Default reminder */}
          <div className="border-t border-[var(--border-color)] pt-3">
            <span className="text-xs font-medium text-[var(--text-secondary)]">{t('settings.notifications.task.defaultReminder')}</span>
            <p className="mb-2 mt-0.5 text-xs text-[var(--text-secondary)]">
              {t('settings.notifications.task.defaultNote')}
            </p>
            <div className="flex flex-col gap-2">
              <select
                aria-label={t('settings.notifications.task.defaultReminder')}
                value={offsetDropdownValue}
                onChange={(e) => handleOffsetChange(Number(e.target.value))}
                className="w-full rounded-control border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1.5 text-sm text-[var(--text-primary)]"
              >
                {OFFSET_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {t(opt.label)}
                  </option>
                ))}
              </select>

              {offsetDropdownValue !== 0 && (
                <select
                  aria-label={t('settings.notifications.task.relativeLabel')}
                  value={config.notifications_default_reminder_relative_to || 'due_date'}
                  onChange={(e) =>
                    onChange({
                      notifications_default_reminder_relative_to: e.target.value as
                        | 'due_date'
                        | 'start_date'
                        | 'end_date',
                    })
                  }
                  className="w-full rounded-control border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1.5 text-sm text-[var(--text-primary)]"
                >
                  <option value="due_date">{t('settings.notifications.task.relativeDue')}</option>
                  <option value="start_date">{t('settings.notifications.task.relativeStart')}</option>
                  <option value="end_date">{t('settings.notifications.task.relativeEnd')}</option>
                </select>
              )}
            </div>
          </div>
        </div>
      </div>

      <PlacesCard />

      {/* Test */}
      <div className="flex items-center gap-3">
        <Button variant="secondary" onClick={handleTestNotification}>
          {t('settings.notifications.test')}
        </Button>
        {testStatus === 'sent' && (
          <span className="text-xs text-status-done">{t('settings.notifications.testSent')}</span>
        )}
      </div>
    </div>
  )
}

/**
 * The places saved on a phone (cross-app semantics section 11.7), read only: only the phone knows
 * where they are, so it saves them and reminds there. A task's reminder picker offers them.
 */
function PlacesCard() {
  const { t } = useTranslation()
  const { places } = useLocationReminders()
  return (
    <div className="rounded-card border border-[var(--border-color)] bg-[var(--bg-primary)] p-5">
      <h2 className="text-sm font-semibold text-[var(--text-primary)]">{t('settings.notifications.places.title')}</h2>
      <p className="mb-3 mt-1 text-xs text-[var(--text-secondary)]">
        {t('settings.notifications.places.note')}
      </p>
      {places.length === 0 ? (
        <p className="text-xs text-[var(--text-secondary)]">
          {t('settings.notifications.places.empty')}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {places.map((place) => (
            <li key={place.id} className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
              <MapPin className="h-3.5 w-3.5 text-[var(--text-secondary)]" aria-hidden="true" />
              {place.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
