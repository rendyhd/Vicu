import { useState } from 'react'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import type { AppConfig } from '@/lib/vikunja-types'

interface NotificationSettingsProps {
  config: AppConfig
  onChange: (partial: Partial<AppConfig>) => void
}

const OFFSET_OPTIONS = [
  { label: 'None', value: 0 },
  { label: 'At due time', value: -1 },
  { label: '5 min before', value: 300 },
  { label: '15 min before', value: 900 },
  { label: '30 min before', value: 1800 },
  { label: '1 hour before', value: 3600 },
  { label: '3 hours before', value: 10800 },
  { label: '1 day before', value: 86400 },
]

export function NotificationSettings({ config, onChange }: NotificationSettingsProps) {
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
    <div className="mx-6 max-w-lg space-y-4 pb-8 pt-4">
      {/* Master toggle */}
      <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-5">
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => onChange({ notifications_enabled: e.target.checked })}
            className="h-4 w-4 rounded border-[var(--border-color)] accent-accent-blue"
          />
          <span className="text-sm font-semibold text-[var(--text-primary)]">Enable desktop notifications</span>
        </label>
        {window.api.platform === 'darwin' && (
          <p className="mt-2 text-xs text-[var(--text-secondary)]">
            On macOS, the first notification will prompt you to allow notifications from Vicu.
          </p>
        )}
      </div>

      {/* ── Scheduled Reminders ── */}
      <div className={cn(
        'rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-5',
        !enabled && 'pointer-events-none opacity-40'
      )}>
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">Scheduled Reminders</h2>
        <p className="mb-4 mt-1 text-xs text-[var(--text-secondary)]">
          Daily notifications that summarize your overdue, due today, and upcoming tasks.
        </p>

        <div className="space-y-4">
          {/* Primary time */}
          <div className="flex items-center gap-3">
            <label className="flex flex-1 cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={config.notifications_daily_reminder_enabled !== false}
                onChange={(e) => onChange({ notifications_daily_reminder_enabled: e.target.checked })}
                className="h-4 w-4 rounded border-[var(--border-color)] accent-accent-blue"
              />
              <span className="text-sm text-[var(--text-primary)]">Morning reminder</span>
            </label>
            <div className="flex items-center gap-1.5">
              <input
                type="time"
                value={config.notifications_daily_reminder_time || '08:00'}
                onChange={(e) => onChange({ notifications_daily_reminder_time: e.target.value })}
                className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1 text-sm text-[var(--text-primary)] focus:border-accent-blue focus:outline-none"
              />
            </div>
          </div>

          {/* Secondary time */}
          <div className="flex items-center gap-3">
            <label className="flex flex-1 cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={config.notifications_secondary_reminder_enabled ?? false}
                onChange={(e) => onChange({ notifications_secondary_reminder_enabled: e.target.checked })}
                className="h-4 w-4 rounded border-[var(--border-color)] accent-accent-blue"
              />
              <span className="text-sm text-[var(--text-primary)]">Afternoon reminder</span>
            </label>
            <div className="flex items-center gap-1.5">
              <input
                type="time"
                value={config.notifications_secondary_reminder_time || '16:00'}
                onChange={(e) => onChange({ notifications_secondary_reminder_time: e.target.value })}
                className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1 text-sm text-[var(--text-primary)] focus:border-accent-blue focus:outline-none"
              />
            </div>
          </div>

          {/* Include */}
          <div className="border-t border-[var(--border-color)] pt-3">
            <span className="text-xs font-medium text-[var(--text-secondary)]">Include</span>
            <div className="mt-2 space-y-2">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={config.notifications_overdue_enabled !== false}
                  onChange={(e) => onChange({ notifications_overdue_enabled: e.target.checked })}
                  className="h-4 w-4 rounded border-[var(--border-color)] accent-accent-blue"
                />
                <span className="text-sm text-[var(--text-primary)]">Overdue tasks</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={config.notifications_due_today_enabled !== false}
                  onChange={(e) => onChange({ notifications_due_today_enabled: e.target.checked })}
                  className="h-4 w-4 rounded border-[var(--border-color)] accent-accent-blue"
                />
                <span className="text-sm text-[var(--text-primary)]">Tasks due today</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={config.notifications_upcoming_enabled ?? false}
                  onChange={(e) => onChange({ notifications_upcoming_enabled: e.target.checked })}
                  className="h-4 w-4 rounded border-[var(--border-color)] accent-accent-blue"
                />
                <span className="text-sm text-[var(--text-primary)]">Tasks due tomorrow</span>
              </label>
            </div>
          </div>

          {/* Behavior */}
          <div className="border-t border-[var(--border-color)] pt-3">
            <div className="space-y-2">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={config.notifications_sound !== false}
                  onChange={(e) => onChange({ notifications_sound: e.target.checked })}
                  className="h-4 w-4 rounded border-[var(--border-color)] accent-accent-blue"
                />
                <span className="text-sm text-[var(--text-primary)]">Play sound</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={config.notifications_persistent ?? false}
                  onChange={(e) => onChange({ notifications_persistent: e.target.checked })}
                  className="h-4 w-4 rounded border-[var(--border-color)] accent-accent-blue"
                />
                <span className="text-sm text-[var(--text-primary)]">Stay until dismissed</span>
              </label>
            </div>
          </div>
        </div>
      </div>

      {/* ── Task Reminders ── */}
      <div className={cn(
        'rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-5',
        !enabled && 'pointer-events-none opacity-40'
      )}>
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">Task Reminders</h2>
        <p className="mb-4 mt-1 text-xs text-[var(--text-secondary)]">
          Reminders you set on individual tasks using the bell icon.
        </p>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={config.notifications_task_reminder_sound !== false}
                onChange={(e) => onChange({ notifications_task_reminder_sound: e.target.checked })}
                className="h-4 w-4 rounded border-[var(--border-color)] accent-accent-blue"
              />
              <span className="text-sm text-[var(--text-primary)]">Play sound</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={config.notifications_task_reminder_persistent ?? false}
                onChange={(e) => onChange({ notifications_task_reminder_persistent: e.target.checked })}
                className="h-4 w-4 rounded border-[var(--border-color)] accent-accent-blue"
              />
              <span className="text-sm text-[var(--text-primary)]">Stay until dismissed</span>
            </label>
          </div>

          {/* Default reminder */}
          <div className="border-t border-[var(--border-color)] pt-3">
            <span className="text-xs font-medium text-[var(--text-secondary)]">Default reminder</span>
            <p className="mb-2 mt-0.5 text-xs text-[var(--text-secondary)]">
              Automatically add a reminder when you set a due date on a task.
            </p>
            <div className="flex flex-col gap-2">
              <select
                value={offsetDropdownValue}
                onChange={(e) => handleOffsetChange(Number(e.target.value))}
                className="w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1.5 text-sm text-[var(--text-primary)] focus:border-accent-blue focus:outline-none"
              >
                {OFFSET_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>

              {offsetDropdownValue !== 0 && (
                <select
                  value={config.notifications_default_reminder_relative_to || 'due_date'}
                  onChange={(e) =>
                    onChange({
                      notifications_default_reminder_relative_to: e.target.value as
                        | 'due_date'
                        | 'start_date'
                        | 'end_date',
                    })
                  }
                  className="w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1.5 text-sm text-[var(--text-primary)] focus:border-accent-blue focus:outline-none"
                >
                  <option value="due_date">Relative to due date</option>
                  <option value="start_date">Relative to start date</option>
                  <option value="end_date">Relative to end date</option>
                </select>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Test */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleTestNotification}
          className={cn(
            'rounded-md px-4 py-2 text-sm font-medium transition-colors',
            'border border-[var(--border-color)] text-[var(--text-primary)]',
            'hover:bg-[var(--bg-secondary)]'
          )}
        >
          Test Notification
        </button>
        {testStatus === 'sent' && (
          <span className="text-xs text-accent-green">Notification sent</span>
        )}
      </div>
    </div>
  )
}
