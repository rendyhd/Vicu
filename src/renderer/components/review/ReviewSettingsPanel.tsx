import type { AppConfig } from '@/lib/vikunja-types'

interface ReviewSettingsPanelProps {
  config: AppConfig
  onChange: (partial: Partial<AppConfig>) => void
}

const DEFAULT_REVIEW = { enabled: true, default_cadence_days: 14, exclude_inbox: true } as const

export function ReviewSettingsPanel({ config, onChange }: ReviewSettingsPanelProps) {
  const review = config.review ?? DEFAULT_REVIEW

  const update = (patch: Partial<typeof review>) => {
    onChange({ review: { ...review, ...patch } })
  }

  return (
    <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-5">
      <h2 className="mb-1 text-sm font-semibold text-[var(--text-primary)]">Review</h2>
      <p className="mb-4 text-xs text-[var(--text-secondary)]">
        Periodic project review, GTD-style. Marker is stored in each project&apos;s description so it syncs across clients.
      </p>

      <div className="space-y-3">
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={review.enabled}
            onChange={(e) => update({ enabled: e.target.checked })}
            className="h-4 w-4 rounded border-[var(--border-color)] accent-accent-blue"
          />
          <span className="text-sm text-[var(--text-primary)]">Enable project review tracking</span>
        </label>

        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm text-[var(--text-primary)]">Default review cadence (days)</div>
            <p className="text-xs text-[var(--text-secondary)]">
              How often projects should be reviewed unless overridden per project.
            </p>
          </div>
          <input
            type="number"
            min={1}
            max={365}
            value={review.default_cadence_days}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10)
              update({ default_cadence_days: Number.isFinite(n) ? Math.min(365, Math.max(1, n)) : 14 })
            }}
            disabled={!review.enabled}
            className="w-20 rounded border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1 text-sm text-[var(--text-primary)] disabled:opacity-50"
          />
        </div>

        <label className="flex cursor-pointer items-start gap-2">
          <input
            type="checkbox"
            checked={review.exclude_inbox}
            disabled={!review.enabled}
            onChange={(e) => update({ exclude_inbox: e.target.checked })}
            className="mt-0.5 h-4 w-4 rounded border-[var(--border-color)] accent-accent-blue disabled:opacity-50"
          />
          <div>
            <div className="text-sm text-[var(--text-primary)]">Exclude Inbox from review list</div>
            <p className="text-xs text-[var(--text-secondary)]">
              Your Inbox is for capture, not for periodic review.
            </p>
          </div>
        </label>
      </div>
    </div>
  )
}
