import { Checkbox } from '@/components/shared/Checkbox'
import { PlannerOptions } from '@/components/planner/PlannerOptions'
import type { AppConfig } from '@/lib/vikunja-types'
import { isPlannerEnabled } from '@/lib/vikunja-types'

interface PlannerSettingsProps {
  config: AppConfig
  onChange: (partial: Partial<AppConfig>) => void
}

/** Settings → General → Plan. Off by default and per device (contract 16.9). */
export function PlannerSettings({ config, onChange }: PlannerSettingsProps) {
  const enabled = isPlannerEnabled(config)
  return (
    <div className="rounded-card border border-[var(--border-color)] bg-[var(--bg-primary)] p-5">
      <h2 className="mb-1 text-sm font-semibold text-[var(--text-primary)]">Plan</h2>
      <p className="mb-4 text-xs text-[var(--text-secondary)]">
        A screen to give tasks a time on a timeline. A time you set shows on every device, whether this is on or not.
      </p>
      <label className="flex cursor-pointer items-center gap-2">
        <Checkbox
          checked={enabled}
          data-plan-enable
          onChange={(event) => onChange({ planner_enabled: event.target.checked })}
        />
        <span className="text-sm text-[var(--text-primary)]">Show Plan in the sidebar</span>
      </label>
      {enabled && (
        <div className="mt-4 border-t border-[var(--border-color)] pt-4">
          <PlannerOptions />
        </div>
      )}
    </div>
  )
}
