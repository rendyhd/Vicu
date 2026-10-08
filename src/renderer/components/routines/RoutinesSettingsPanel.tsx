import { Checkbox } from '@/components/shared/Checkbox'
import { Switch } from '@/components/shared/Switch'
import { isRoutinesEnabled, type AppConfig } from '@/lib/vikunja-types'

interface RoutinesSettingsPanelProps {
  config: AppConfig
  onChange: (partial: Partial<AppConfig>) => void
}

export function RoutinesSettingsPanel({ config, onChange }: RoutinesSettingsPanelProps) {
  const enabled = isRoutinesEnabled(config)
  const inToday = config.routines_in_today !== false

  return (
    <div className="rounded-card border border-[var(--border-color)] bg-[var(--bg-primary)] p-5">
      <h2 className="mb-1 text-sm font-semibold text-[var(--text-primary)]">Routines</h2>
      <p className="mb-4 text-xs text-[var(--text-secondary)]">
        Daily health and home routines. Turning them off hides them and stops their reminders; your routines and their history are kept.
      </p>

      <div className="space-y-3">
        <label className="flex cursor-pointer items-center gap-2">
          <Switch
            checked={enabled}
            onCheckedChange={(checked) => onChange({ routines_enabled: checked })}
          />
          <span className="text-sm text-[var(--text-primary)]">Enable routines</span>
        </label>

        <label className="flex cursor-pointer items-start gap-2">
          <Checkbox
            checked={inToday}
            disabled={!enabled}
            onChange={(e) => onChange({ routines_in_today: e.target.checked })}
            className="mt-0.5"
          />
          <div>
            <div className="text-sm text-[var(--text-primary)]">Show routines in Today</div>
            <p className="text-xs text-[var(--text-secondary)]">
              Lists the routines still open today above your tasks. Finished ones are left out.
            </p>
          </div>
        </label>
      </div>
    </div>
  )
}
