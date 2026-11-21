import { useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Dialog } from '@/components/overlay/Dialog'
import { Button } from '@/components/shared/Button'
import { Checkbox } from '@/components/shared/Checkbox'
import { useDateFormat } from '@/hooks/use-date-format'
import { usePlanActions, type PlanData } from '@/hooks/use-project-plans'
import { formatMonthYear } from '@/lib/date-display'
import { planNameBase } from '@/lib/pro/plan-display'
import { toast } from '@/stores/toast-store'
import type { Project } from '@/lib/vikunja-types'
import { startOfLocalDay, toLocalDate } from '../../../shared/due-dates'
import { carryOver, nextPlan, type ProjectPlan } from '../../../shared/pro/project-plan'

const FIELD = 'w-full rounded-control border border-border bg-bg-page px-2 py-1.5 text-meta text-text'

export interface ClosePlanDialogProps {
  project: Project
  plan: ProjectPlan
  data: PlanData
  onClose: () => void
}

/**
 * Closing a 90-day plan (cross-app semantics 21.20): what it delivered, what is open and what was
 * dropped, and whether the open work carries on in a new plan next to it.
 */
export function ClosePlanDialog({ project, plan, data, onClose }: ClosePlanDialogProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const fmt = useDateFormat()
  const { close, closeWithCarryOver } = usePlanActions()
  const view = data.view
  const delivered = view?.delivered ?? 0
  const open = Math.max(0, (view?.total ?? 0) - delivered)
  const dropped = view?.items.reduce((sum, item) => sum + item.dropped, 0) ?? 0
  const moving = useMemo(() => carryOver(data.tasks), [data.tasks])
  const moveCount = moving.items.length + moving.milestones.length
  const defaultName = useMemo(() => {
    const next = nextPlan(plan, project.id, toLocalDate(new Date()))
    const base = planNameBase(project.title, formatMonthYear(startOfLocalDay(plan.start), fmt))
    return t('pro.plan.close.nextName', { name: base, month: formatMonthYear(startOfLocalDay(next.start), fmt) })
  }, [plan, project.id, project.title, fmt, t])
  const [carry, setCarry] = useState(moveCount > 0)
  const [name, setName] = useState(defaultName)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const submit = async () => {
    setBusy(true)
    setProblem(null)
    if (!carry || moveCount === 0) {
      const ok = await close(project.id, plan)
      setBusy(false)
      if (ok) onClose()
      return
    }
    const outcome = await closeWithCarryOver({ project, plan, tasks: data.tasks, name })
    setBusy(false)
    if (outcome.ok) {
      onClose()
      toast.success(t('pro.plan.close.carried', { name: name.trim() }))
      void navigate({ to: '/project-plan/$projectId', params: { projectId: String(outcome.project) } })
      return
    }
    if (outcome.reason === 'offline') return setProblem(t('pro.plan.close.offline'))
    if (outcome.reason === 'create') return setProblem(t('pro.plan.close.createFailed'))
    // Some tasks moved: the new project is there, the old plan stays open.
    onClose()
    toast.error(outcome.error
      ? t('pro.plan.close.moveFailedWhy', { moved: outcome.moved, count: outcome.total, name: name.trim(), error: outcome.error })
      : t('pro.plan.close.moveFailed', { moved: outcome.moved, count: outcome.total, name: name.trim() }))
  }

  return (
    <Dialog open label={t('pro.plan.close.title')} onClose={onClose} className="w-[440px] max-w-[92vw] p-5">
      <h2 className="mb-1 text-card-title text-text">{t('pro.plan.close.title')}</h2>
      <p className="mb-3 text-meta text-text-secondary">{project.title}</p>
      <ul className="mb-4 space-y-0.5 text-meta text-text" data-pro-plan-close-counts>
        <li>{t('pro.plan.close.delivered', { count: delivered })}</li>
        <li>{t('pro.plan.close.open', { count: open })}</li>
        <li>{t('pro.plan.close.dropped', { count: dropped })}</li>
      </ul>
      <label className="mb-2 flex items-start gap-2 text-meta text-text">
        <Checkbox checked={carry && moveCount > 0} disabled={moveCount === 0} onChange={(event) => setCarry(event.target.checked)} className="mt-0.5" data-pro-plan-carry />
        <span>
          {t('pro.plan.close.carry')}
          <span className="block text-caption text-text-secondary">
            {moveCount > 0 ? t('pro.plan.close.carryHint', { count: moveCount }) : t('pro.plan.close.nothingOpen')}
          </span>
        </span>
      </label>
      {carry && moveCount > 0 && (
        <label className="mb-3 block">
          <span className="mb-1 block text-group text-text-secondary">{t('pro.plan.close.name')}</span>
          <input value={name} onChange={(event) => setName(event.target.value)} className={FIELD} data-pro-plan-next-name />
        </label>
      )}
      {problem && <p className="mb-3 text-meta text-danger" role="alert">{problem}</p>}
      <div className="flex items-center justify-end gap-2">
        <Button variant="quiet" onClick={onClose}>{t('pro.plan.dialog.cancel')}</Button>
        <Button variant="primary" disabled={busy || (carry && moveCount > 0 && !name.trim())} onClick={() => void submit()} data-pro-plan-close-confirm>
          {t('pro.plan.close.confirm')}
        </Button>
      </div>
    </Dialog>
  )
}
