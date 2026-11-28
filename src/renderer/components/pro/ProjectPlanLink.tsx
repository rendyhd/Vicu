import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { CalendarRange } from 'lucide-react'
import { useProjectPlans } from '@/hooks/use-project-plans'
import { toLocalDate } from '../../../shared/due-dates'
import { planWeekOf, planWeeks } from '../../../shared/pro/project-plan'

/** On a project's page: a link to its 90-day plan, with the week while the plan runs. */
export function ProjectPlanLink({ projectId }: { projectId: number }) {
  const { t } = useTranslation()
  const { byProject } = useProjectPlans()
  const plan = byProject.get(projectId)
  if (!plan) return null
  const week = plan.closed ? null : planWeekOf(plan, toLocalDate(new Date()))
  return (
    <div className="px-6 pb-2">
      <Link
        to="/project-plan/$projectId"
        params={{ projectId: String(projectId) }}
        className="inline-flex items-center gap-1.5 rounded-control text-meta text-accent-blue hover:underline"
        data-pro-plan-link={projectId}
      >
        <CalendarRange className="h-3.5 w-3.5" aria-hidden />
        {week !== null ? t('pro.plan.link.week', { week: week + 1, weeks: planWeeks(plan).length }) : t('pro.plan.link.plain')}
      </Link>
    </div>
  )
}
