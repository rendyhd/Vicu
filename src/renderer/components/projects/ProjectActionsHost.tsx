import { useId, useState } from 'react'
import { Dialog } from '@/components/overlay/Dialog'
import { Button } from '@/components/shared/Button'
import { useAppConfig } from '@/hooks/use-app-config'
import { useSharedProjectActions } from '@/hooks/use-project-actions'
import { parseReviewFooter } from '@/lib/review-metadata'
import { projectActions, useProjectActionsStore } from '@/stores/project-actions-store'
import type { Project } from '@/lib/vikunja-types'
import { ProjectDialog } from './ProjectDialog'

function ReviewCadenceDialog({
  project,
  returnFocusTo,
  onClose,
}: {
  project: Project
  returnFocusTo: HTMLElement | null
  onClose: () => void
}) {
  const titleId = useId()
  const inputId = useId()
  const helpId = useId()
  const { data: config } = useAppConfig()
  const { setReviewCadence } = useSharedProjectActions()
  const defaultDays = config?.review?.default_cadence_days ?? 14
  const [value, setValue] = useState(() => String(parseReviewFooter(project.description).cadenceDaysOverride ?? ''))
  const days = value.trim() === '' ? null : Number.parseInt(value, 10)
  const valid = days === null || (Number.isFinite(days) && days >= 1 && days <= 365)

  const save = () => {
    if (!valid) return
    setReviewCadence(project, days)
    onClose()
  }

  return (
    <Dialog open onClose={onClose} labelledBy={titleId} returnFocusTo={returnFocusTo} className="w-[340px]">
      <form
        className="space-y-4 p-5"
        onSubmit={(event) => {
          event.preventDefault()
          save()
        }}
      >
        <h2 id={titleId} className="text-sm font-semibold text-[var(--text-primary)]">
          Review cadence for “{project.title}”
        </h2>
        <div>
          <label htmlFor={inputId} className="mb-1 block text-xs text-[var(--text-secondary)]">Review every (days)</label>
          <input
            id={inputId}
            type="number"
            min={1}
            max={365}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={String(defaultDays)}
            aria-describedby={helpId}
            aria-invalid={!valid}
            data-autofocus
            className="w-24 rounded-control border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-1.5 text-sm text-[var(--text-primary)]"
          />
          <p id={helpId} className={valid ? 'mt-1 text-xs text-[var(--text-secondary)]' : 'mt-1 text-xs text-danger'}>
            {valid ? `Leave empty to use the default of ${defaultDays} days.` : 'Enter a number from 1 to 365.'}
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={!valid}>Save</Button>
        </div>
      </form>
    </Dialog>
  )
}

/** The dialogs the project menu opens, drawn once for the whole app (AppShell). */
export function ProjectActionsHost() {
  const dialog = useProjectActionsStore((s) => s.dialog)
  const returnFocusTo = useProjectActionsStore((s) => s.returnFocusTo)
  if (!dialog) return null

  if (dialog.kind === 'cadence') {
    return (
      <ReviewCadenceDialog
        key={`cadence-${dialog.project.id}`}
        project={dialog.project}
        returnFocusTo={returnFocusTo}
        onClose={projectActions.closeDialog}
      />
    )
  }
  return (
    <ProjectDialog
      key={dialog.kind === 'edit' ? `edit-${dialog.project.id}` : `create-${dialog.parentId}`}
      project={dialog.kind === 'edit' ? dialog.project : null}
      initialParentId={dialog.kind === 'create' ? dialog.parentId : undefined}
      returnFocusTo={returnFocusTo}
      onClose={projectActions.closeDialog}
    />
  )
}
