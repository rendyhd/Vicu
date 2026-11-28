import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog } from '@/components/overlay/Dialog'
import { Button } from '@/components/shared/Button'
import { useAppConfig } from '@/hooks/use-app-config'
import { useSharedProjectActions } from '@/hooks/use-project-actions'
import { useProjectCategoryActions } from '@/hooks/use-project-categories'
import { parseReviewFooter } from '@/lib/review-metadata'
import { projectActions, useProjectActionsStore, type ProjectDialogRequest } from '@/stores/project-actions-store'
import type { Project } from '@/lib/vikunja-types'
import { ProjectDialog } from './ProjectDialog'
import { ShareProjectDialog } from './ShareProjectDialog'

function ReviewCadenceDialog({
  project,
  returnFocusTo,
  onClose,
}: {
  project: Project
  returnFocusTo: HTMLElement | null
  onClose: () => void
}) {
  const { t } = useTranslation()
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
          {t('projects.cadence.title', { title: project.title })}
        </h2>
        <div>
          <label htmlFor={inputId} className="mb-1 block text-xs text-[var(--text-secondary)]">{t('projects.cadence.every')}</label>
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
            {valid ? t('projects.cadence.help', { days: defaultDays }) : t('projects.cadence.invalid')}
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>{t('projects.cadence.cancel')}</Button>
          <Button variant="primary" type="submit" disabled={!valid}>{t('projects.cadence.save')}</Button>
        </div>
      </form>
    </Dialog>
  )
}

/** The name of a new project category, or a new name for one: blank is refused with "Enter a name". */
function CategoryNameDialog({
  title,
  initialName,
  confirmLabel,
  returnFocusTo,
  onSubmit,
  onClose,
}: {
  title: string
  initialName: string
  confirmLabel: string
  returnFocusTo: HTMLElement | null
  onSubmit: (name: string) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const titleId = useId()
  const inputId = useId()
  const errorId = useId()
  const [name, setName] = useState(initialName)
  const [blank, setBlank] = useState(false)

  const save = () => {
    const trimmed = name.trim()
    if (!trimmed) {
      setBlank(true)
      return
    }
    onSubmit(trimmed)
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
        <h2 id={titleId} className="text-sm font-semibold text-[var(--text-primary)]">{title}</h2>
        <div>
          <label htmlFor={inputId} className="mb-1 block text-xs text-[var(--text-secondary)]">{t('projects.categoryDialog.name')}</label>
          <input
            id={inputId}
            value={name}
            onChange={(event) => {
              setName(event.target.value)
              setBlank(false)
            }}
            aria-invalid={blank}
            aria-describedby={blank ? errorId : undefined}
            data-autofocus
            className="w-full rounded-control border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-1.5 text-sm text-[var(--text-primary)]"
          />
          {blank && <p id={errorId} className="mt-1 text-xs text-danger">{t('projects.categoryDialog.enterName')}</p>}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>{t('projects.categoryDialog.cancel')}</Button>
          <Button variant="primary" type="submit">{confirmLabel}</Button>
        </div>
      </form>
    </Dialog>
  )
}

/** The category dialogs: a new one (alone, with a project in it, or above a project) and a rename. */
function CategoryDialog({
  dialog,
  returnFocusTo,
}: {
  dialog: Extract<ProjectDialogRequest, { kind: 'category-new' | 'category-rename' }>
  returnFocusTo: HTMLElement | null
}) {
  const { t } = useTranslation()
  const categories = useProjectCategoryActions()
  if (dialog.kind === 'category-rename') {
    return (
      <CategoryNameDialog
        title={t('projects.categoryDialog.rename')}
        initialName={dialog.name}
        confirmLabel={t('projects.categoryDialog.save')}
        returnFocusTo={returnFocusTo}
        onSubmit={(name) => categories.rename(dialog.categoryId, name)}
        onClose={projectActions.closeDialog}
      />
    )
  }
  const { project, above } = dialog
  return (
    <CategoryNameDialog
      title={t('projects.categoryDialog.new')}
      initialName=""
      confirmLabel={t('projects.categoryDialog.create')}
      returnFocusTo={returnFocusTo}
      onSubmit={(name) => {
        if (above) void categories.addAbove(above, name)
        else if (project) void categories.createWithProject(name, project)
        else void categories.create(name)
      }}
      onClose={projectActions.closeDialog}
    />
  )
}

/** The dialogs the project menu opens, drawn once for the whole app (AppShell). */
export function ProjectActionsHost() {
  const dialog = useProjectActionsStore((s) => s.dialog)
  const returnFocusTo = useProjectActionsStore((s) => s.returnFocusTo)
  if (!dialog) return null

  if (dialog.kind === 'category-new' || dialog.kind === 'category-rename') {
    const key = dialog.kind === 'category-rename' ? `rename-${dialog.categoryId}` : `new-${dialog.project?.id ?? dialog.above?.id ?? 0}`
    return <CategoryDialog key={key} dialog={dialog} returnFocusTo={returnFocusTo} />
  }

  if (dialog.kind === 'share') {
    return (
      <ShareProjectDialog
        key={`share-${dialog.project.id}`}
        project={dialog.project}
        returnFocusTo={returnFocusTo}
        onClose={projectActions.closeDialog}
      />
    )
  }
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
