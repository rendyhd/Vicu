import { useMemo } from 'react'
import { Folder } from 'lucide-react'
import { Button } from '@/components/shared/Button'
import { Checkbox } from '@/components/shared/Checkbox'
import { Switch } from '@/components/shared/Switch'
import { useProjects } from '@/hooks/use-projects'
import { useSharedProjectActions } from '@/hooks/use-project-actions'
import { normalizeHex } from '@/lib/constants'
import { parseReviewFooter } from '@/lib/review-metadata'
import type { AppConfig, Project } from '@/lib/vikunja-types'

/** Active projects someone excluded from review (the footer in their description says so). */
export function excludedFromReview(projects: readonly Project[]): Project[] {
  return projects
    .filter((project) => parseReviewFooter(project.description).state === 'excluded')
    .sort((a, b) => a.title.localeCompare(b.title))
}

/** The projects taken out of the Review list, each with a way back in. */
function ExcludedProjects() {
  const { data } = useProjects()
  const { setExcludedFromReview } = useSharedProjectActions()
  const excluded = useMemo(() => excludedFromReview(data?.flat ?? []), [data?.flat])
  if (excluded.length === 0) return null

  return (
    <div className="border-t border-[var(--border-color)] pt-3">
      <div className="text-sm text-[var(--text-primary)]">Excluded from review</div>
      <p className="mb-2 text-xs text-[var(--text-secondary)]">
        Projects you took out of the Review list. Include one to track it again.
      </p>
      <ul className="divide-y divide-[var(--border-color)] rounded-control border border-[var(--border-color)]">
        {excluded.map((project) => (
          <li key={project.id} className="flex items-center gap-2 px-3 py-1.5">
            <Folder aria-hidden="true" className="h-4 w-4 shrink-0" style={{ color: normalizeHex(project.hex_color) || 'var(--text-secondary)' }} />
            <span className="min-w-0 flex-1 truncate text-sm text-[var(--text-primary)]">{project.title}</span>
            <Button variant="secondary" onClick={() => setExcludedFromReview(project, false)} aria-label={`Include again: ${project.title}`}>
              Include again
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}

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
    <div className="rounded-card border border-[var(--border-color)] bg-[var(--bg-primary)] p-5">
      <h2 className="mb-1 text-sm font-semibold text-[var(--text-primary)]">Review</h2>
      <p className="mb-4 text-xs text-[var(--text-secondary)]">
        Periodic project review, GTD-style. Marker is stored in each project&apos;s description so it syncs across clients.
      </p>

      <div className="space-y-3">
        <label className="flex cursor-pointer items-center gap-2">
          <Switch
            checked={review.enabled}
            onCheckedChange={(checked) => update({ enabled: checked })}
          />
          <span className="text-sm text-[var(--text-primary)]">Enable project review tracking</span>
        </label>

        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm text-[var(--text-primary)]">Default review cadence (days)</div>
            <p className="text-xs text-[var(--text-secondary)]">
              How often projects should be reviewed unless overridden per project.
            </p>
          </div>
          <input
            type="number"
            aria-label="Default review cadence in days"
            min={1}
            max={365}
            value={review.default_cadence_days}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10)
              update({ default_cadence_days: Number.isFinite(n) ? Math.min(365, Math.max(1, n)) : 14 })
            }}
            disabled={!review.enabled}
            className="w-20 rounded-control border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1 text-sm text-[var(--text-primary)] disabled:opacity-50"
          />
        </div>

        <label className="flex cursor-pointer items-start gap-2">
          <Checkbox
            checked={review.exclude_inbox}
            disabled={!review.enabled}
            onChange={(e) => update({ exclude_inbox: e.target.checked })}
            className="mt-0.5"
          />
          <div>
            <div className="text-sm text-[var(--text-primary)]">Exclude Inbox from review list</div>
            <p className="text-xs text-[var(--text-secondary)]">
              Your Inbox is for capture, not for periodic review.
            </p>
          </div>
        </label>

        {review.enabled && <ExcludedProjects />}
      </div>
    </div>
  )
}
