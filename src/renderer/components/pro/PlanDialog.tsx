import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Dialog } from '@/components/overlay/Dialog'
import { Button } from '@/components/shared/Button'
import { useGroups } from '@/hooks/use-groups'
import { useProjects } from '@/hooks/use-projects'
import { usePlanActions, useProjectPlans } from '@/hooks/use-project-plans'
import { toLocalDate } from '../../../shared/due-dates'
import { defaultPlanEnd } from '../../../shared/pro/project-plan'

const FIELD = 'w-full rounded-control border border-border bg-bg-page px-2 py-1.5 text-meta text-text'
const DAY = /^\d{4}-\d{2}-\d{2}$/

export interface PlanDialogProps {
  projectId: number
  onClose: () => void
  /** After saving a new plan, open its view (from the project menu). */
  openAfterSave?: boolean
}

/**
 * A project's 90-day plan (cross-app semantics 21.20): its first and last day and the group it
 * belongs to. A new plan starts today and runs 13 weeks; moving its start moves its end with it.
 */
export function PlanDialog({ projectId, onClose, openAfterSave = false }: PlanDialogProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { byProject } = useProjectPlans()
  const { groups } = useGroups()
  const { data: projects } = useProjects()
  const { save, remove } = usePlanActions()
  const existing = byProject.get(projectId) ?? null
  const projectName = projects?.flat.find((project) => project.id === projectId)?.title ?? ''
  const today = toLocalDate(new Date())
  const [start, setStart] = useState(existing?.start ?? today)
  const [end, setEnd] = useState(existing?.end ?? defaultPlanEnd(today))
  const [group, setGroup] = useState<number | null>(existing?.group ?? null)
  const [saving, setSaving] = useState(false)
  const inOrder = DAY.test(start) && DAY.test(end) && end >= start
  const title = existing ? t('pro.plan.dialog.edit') : t('pro.plan.dialog.new')
  // A group the plan names that is no group any more stays chosen until changed.
  const groupKnown = group === null || groups.some((entry) => entry.label === group)

  const changeStart = (value: string) => {
    setStart(value)
    if (!existing && DAY.test(value)) setEnd(defaultPlanEnd(value))
  }

  const submit = async () => {
    if (!inOrder) return
    setSaving(true)
    const ok = await save(projectId, { start, end, group })
    setSaving(false)
    if (!ok) return
    onClose()
    if (openAfterSave && !existing) void navigate({ to: '/project-plan/$projectId', params: { projectId: String(projectId) } })
  }

  return (
    <Dialog open label={title} onClose={onClose} className="w-[420px] max-w-[92vw] p-5">
      <h2 className="mb-1 text-card-title text-text">{title}</h2>
      {projectName && <p className="mb-3 text-meta text-text-secondary">{projectName}</p>}
      <div className="mb-3 grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1 block text-group text-text-secondary">{t('pro.plan.dialog.start')}</span>
          <input type="date" value={start} onChange={(event) => changeStart(event.target.value)} className={FIELD} data-pro-plan-start autoFocus />
        </label>
        <label className="block">
          <span className="mb-1 block text-group text-text-secondary">{t('pro.plan.dialog.end')}</span>
          <input type="date" value={end} min={start} onChange={(event) => setEnd(event.target.value)} className={FIELD} data-pro-plan-end />
        </label>
      </div>
      {!inOrder && <p className="mb-3 text-caption text-text-secondary" role="status">{t('pro.plan.dialog.order')}</p>}
      <label className="mb-4 block">
        <span className="mb-1 block text-group text-text-secondary">{t('pro.plan.dialog.group')}</span>
        <select value={group ?? ''} onChange={(event) => setGroup(event.target.value ? Number(event.target.value) : null)} className={FIELD} data-pro-plan-group>
          <option value="">{t('pro.plan.dialog.noGroup')}</option>
          {groups.map((entry) => <option key={entry.id} value={entry.label}>{entry.name}</option>)}
          {!groupKnown && group !== null && <option value={group}>{t('pro.plan.dialog.unknownGroup')}</option>}
        </select>
      </label>
      <div className="flex items-center justify-end gap-2">
        {existing && (
          <Button variant="quiet" danger className="mr-auto" onClick={() => { void remove(projectId); onClose() }} data-pro-plan-remove>
            {t('pro.plan.dialog.remove')}
          </Button>
        )}
        <Button variant="quiet" onClick={onClose}>{t('pro.plan.dialog.cancel')}</Button>
        <Button variant="primary" disabled={!inOrder || saving} onClick={() => void submit()} data-pro-plan-save>{t('pro.plan.dialog.save')}</Button>
      </div>
    </Dialog>
  )
}
