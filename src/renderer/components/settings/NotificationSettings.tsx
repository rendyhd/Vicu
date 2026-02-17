import { useState } from 'react'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import type { AppConfig } from '@/lib/vikunja-types'

interface NotificationSettingsProps {
  config: AppConfig
  onChange: (partial: Partial<AppConfig>) => void
}

export function NotificationSettings({ config, onChange }: NotificationSettingsProps) {
  const [testStatus, setTestStatus] = useState<'idle' | 'sent'>('idle')
  const enabled = config.notifications_enabled ?? false

  const handleTestNotification = async () => {
    await api.testNotification()
    setTestStatus('sent')
    setTimeout(() => setTestStatus('idle'), 3000)
  }

  return (
    <div className="mx-6 max-w-lg space-y-6 pb-8 pt-4">
      <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-5">
        <h2 className="mb-4 text-sm font-semibold text-[var(--text-primary)]">Notifications</h2>

        <div className="space-y-4">
          {/* Master toggle */}
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => onChange({ notifications_enabled: e.target.checked })}
              className="h-4 w-4 rounded border-[var(--border-color)] accent-accent-blue"
            />
            <span className="text-sm text-[var(--text-primary)]">Enable desktop notifications</span>
          </label>

          {/* Daily Reminder */}
          <div className={cn(
            'space-y-3 border-t border-[var(--border-color)] pt-4',
            !enabled && 'pointer-events-none opacity-40'
          )}>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
              Daily Reminder
            </h3>

            <div className="flex items-center gap-3">
              <label className="flex flex-1 cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={config.notifications_daily_reminder_enabled !== false}
                  onChange={(e) => onChange({ notifications_daily_reminder_enabled: e.target.checked })}
                  className="h-4 w-4 rounded border-[var(--border-color)] accent-accent-blue"
                />
                <span className="text-sm text-[var(--text-primary)]">Daily task reminder</span>
              </label>
              <div className="flex items-center gap-1.5">
                <label className="text-xs text-[var(--text-secondary)]">Time</label>
                <input
                  type="time"
                  value={config.notifications_daily_reminder_time || '08:00'}
                  onChange={(e) => onChange({ notifications_daily_reminder_time: e.target.value })}
                  className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1 text-sm text-[var(--text-primary)] focus:border-accent-blue focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Second Reminder */}
          <div className={cn(
            'space-y-3 border-t border-[var(--border-color)] pt-4',
            !enabled && 'pointer-events-none opacity-40'
          )}>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
              Second Reminder
            </h3>

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
                <label className="text-xs text-[var(--text-secondary)]">Time</label>
                <input
                  type="time"
                  value={config.notifications_secondary_reminder_time || '16:00'}
                  onChange={(e) => onChange({ notifications_secondary_reminder_time: e.target.value })}
                  className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1 text-sm text-[var(--text-primary)] focus:border-accent-blue focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* What to Include */}
          <div className={cn(
            'space-y-3 border-t border-[var(--border-color)] pt-4',
            !enabled && 'pointer-events-none opacity-40'
          )}>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
              What to Include
            </h3>

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

          {/* Behavior */}
          <div className={cn(
            'space-y-3 border-t border-[var(--border-color)] pt-4',
            !enabled && 'pointer-events-none opacity-40'
          )}>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
              Behavior
            </h3>

            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={config.notifications_persistent ?? false}
                onChange={(e) => onChange({ notifications_persistent: e.target.checked })}
                className="h-4 w-4 rounded border-[var(--border-color)] accent-accent-blue"
              />
              <span className="text-sm text-[var(--text-primary)]">Persistent notifications (stay until dismissed)</span>
            </label>

            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={config.notifications_sound !== false}
                onChange={(e) => onChange({ notifications_sound: e.target.checked })}
                className="h-4 w-4 rounded border-[var(--border-color)] accent-accent-blue"
              />
              <span className="text-sm text-[var(--text-primary)]">Play sound</span>
            </label>
          </div>

          {/* Test button */}
          <div className="border-t border-[var(--border-color)] pt-4">
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
        </div>
      </div>
    </div>
  )
}
