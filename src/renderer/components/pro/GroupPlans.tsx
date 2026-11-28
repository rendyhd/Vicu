import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useDateFormat } from '@/hooks/use-date-format'
import { useProjects } from '@/hooks/use-projects'
import { usePlanData, useProjectPlans, type PlanEntry } from '@/hooks/use-project-plans'
import { formatDayMonthYear } from '@/lib/date-display'
import { startOfLocalDay } from '../../../shared/due-dates'

/** One plan of a group: a link to its view, its days and what it delivered. */
function GroupPlanRow({ entry }: { entry: PlanEntry }) {
  const { t } = useTranslation()
  const fmt = useDateFormat()
  const { data: projects } = useProjects()
  const data = usePlanData(entry.project, entry.plan)
  const name = projects?.flat.find((project) => project.id === entry.project)?.title
    ?? projects?.archived.find((project) => project.id === entry.project)?.title
    ?? t('pro.plan.title')
  const day = (value: string) => formatDayMonthYear(startOfLocalDay(value), fmt)
  return (
    <li>
      <Link
        to="/project-plan/$projectId"
        params={{ projectId: String(entry.project) }}
        className="flex flex-wrap items-baseline gap-x-3 px-2 py-2 hover:bg-bg-hover"
        data-pro-group-plan={entry.project}
      >
        <span className="min-w-0 flex-1 truncate text-task-title text-text">{name}</span>
        <span className="text-meta text-text-secondary">
          {entry.plan.closed ? t('pro.plan.daysClosed', { start: day(entry.plan.start), end: day(entry.plan.end) }) : t('pro.plan.days', { start: day(entry.plan.start), end: day(entry.plan.end) })}
        </span>
        {data.view && <span className="text-meta tabular-nums text-text-secondary">{t('pro.plan.totals', { delivered: data.view.delivered, total: data.view.total })}</span>}
      </Link>
    </li>
  )
}

/**
 * The 90-day plans of a group (cross-app semantics 21.20), open ones first, each a link to its
 * view. Nothing when the group has none, or while the promises layer is off.
 */
export function GroupPlans({ labelId }: { labelId: number }) {
  const { t } = useTranslation()
  const plans = useProjectPlans()
  const mine = plans.ofGroup(labelId)
  if (mine.length === 0) return null
  return (
    <section className="px-6 pb-6" aria-label={t('pro.plan.groupPlans')} data-pro-group-plans={labelId}>
      <h2 className="mb-1 text-group text-text-secondary">{t('pro.plan.groupPlans')}</h2>
      <ul className="divide-y divide-border">
        {mine.map((entry) => <GroupPlanRow key={entry.project} entry={entry} />)}
      </ul>
    </section>
  )
}
