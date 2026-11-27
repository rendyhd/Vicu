import { useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
import { CheckCircle2, Circle } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Button } from '@/components/shared/Button'
import { usePro } from '@/hooks/use-pro'
import { useProLedger, writeLedger } from '@/hooks/use-pro-ledger'
import { useProUiStore } from '@/stores/pro-ui-store'
import { useWeekStart } from '@/hooks/use-week-start'
import { useProjects } from '@/hooks/use-projects'
import { useAvailability } from '@/hooks/use-availability'
import type { Task } from '@/lib/vikunja-types'
import type { LocalDate } from '../../../shared/due-dates'
import { startOfWeek } from '../../../shared/due-dates'
import { mirrorText, proWeeklySteps, weeklyDoneSteps, weeklyMirror, withWeeklyDone, type ProWeeklyStepId } from '../../../shared/pro/weekly'
import { rankedInitiatives } from '../../../shared/pro/portfolio'
import type { TranslationKey } from '../../../shared/i18n'

/** The steps whose text is still here; the weekly note's is in the catalog. */
type OlderStep = Exclude<ProWeeklyStepId, 'note'>

const HINTS: Record<OlderStep, TranslationKey> = {
  verdicts: 'pro.weeklySteps.verdicts',
  unsent: 'pro.weeklySteps.unsent',
  escalations: 'pro.weeklySteps.escalations',
  portfolio: 'pro.weeklySteps.portfolio',
  value: 'pro.weeklySteps.value',
}

const ROUTES: Record<OlderStep, string> = {
  verdicts: '/waiting-on',
  unsent: '/people',
  escalations: '/sponsor',
  portfolio: '/portfolio',
  value: '/portfolio',
}


/**
 * The weekly execution review (cross-app semantics 21.11, plan 7.7.5): Pro's steps before the usual
 * weekly review, for the layers that are on, and the mirror. Nothing while Pro is off.
 */
export function WeeklyProSteps({ tasks, today }: { tasks: readonly Task[]; today: LocalDate }) {
  const pro = usePro()
  const navigate = useNavigate()
  const { ledger } = useProLedger()
  const { data: projects } = useProjects()
  const availability = useAvailability()
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const weekStart = useWeekStart()
  // Marked done by hand, remembered for this week on every device (21.11).
  const week = startOfWeek(today, weekStart)
  const done = useMemo(() => new Set(weeklyDoneSteps(ledger.settings?.value, week)), [ledger, week])
  const markDone = (step: ProWeeklyStepId) =>
    void writeLedger(queryClient, [{ op: 'settings', value: withWeeklyDone(ledger.settings?.value, week, step) }])

  const stalled = useMemo(() => {
    if (!pro.layer('portfolio') || !availability.on) return 0
    const parent = new Map((projects?.all ?? []).map((project) => [project.id, project.parent_project_id]))
    const within = (projectId: number, root: number) => {
      const seen = new Set<number>()
      for (let id: number | null | undefined = projectId; typeof id === 'number' && id > 0 && !seen.has(id); id = parent.get(id)) {
        if (id === root) return true
        seen.add(id)
      }
      return false
    }
    return rankedInitiatives(ledger).filter((entry) =>
      !tasks.some((task) => !task.done && within(task.project_id, entry.projectId) && availability.of(task)?.available !== false)).length
  }, [pro, availability, ledger, tasks, projects?.all])

  const steps = useMemo(
    () => (pro.on ? proWeeklySteps({ tasks, ledger, layers: pro.layers, today, stalledInitiatives: stalled }) : []),
    [pro, tasks, ledger, today, stalled],
  )
  const loggedAnyway = useMemo(
    () => rankedInitiatives(ledger).reduce((sum, entry) => sum + (entry.value.log_anyway ?? 0), 0),
    [ledger],
  )
  const mirror = useMemo(() => (pro.layer('power') ? weeklyMirror(tasks, ledger, today) : null), [pro, tasks, ledger, today])

  if (!pro.on || (steps.length === 0 && !mirror)) return null

  return (
    <section aria-label={t('pro.weeklySteps.review')} className="mb-4 flex flex-col gap-2" data-pro-weekly>
      {mirror && (
        <p className="rounded-card border border-accent-blue/40 bg-accent-blue/8 px-4 py-3 text-meta text-[var(--text-primary)]" data-pro-mirror>
          {mirrorText(mirror)}
        </p>
      )}
      {steps.length > 0 && (
        <ol className="flex flex-col gap-2" aria-label={t('pro.weeklySteps.steps')}>
          {steps.map((step) => {
            const stepDone = done.has(step.id) || step.count === 0
            const hint = step.id === 'portfolio' && loggedAnyway > 0
              ? t('pro.weeklySteps.portfolioLogged', { count: loggedAnyway })
              : step.id === 'note' ? t('pro.weekly.noteHint') : t(HINTS[step.id])
            return (
              <li key={step.id} className="flex items-center gap-3 rounded-card border border-[var(--border-color)] px-4 py-3" data-pro-weekly-step={step.id}>
                {stepDone
                  ? <CheckCircle2 aria-label={t('pro.weeklySteps.done')} className="h-5 w-5 shrink-0 text-accent-green" />
                  : <Circle aria-label={t('pro.weeklySteps.notDone')} className="h-5 w-5 shrink-0 text-[var(--text-secondary)]" />}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <h2 className={cn('text-task-title font-medium text-[var(--text-primary)]', stepDone && 'text-[var(--text-secondary)]')}>{step.title}</h2>
                    <span className="text-meta tabular-nums text-[var(--text-secondary)]">{step.count}</span>
                  </div>
                  <p className="text-meta text-[var(--text-secondary)]">{hint}</p>
                </div>
                {step.id === 'note'
                  ? <Button onClick={() => useProUiStore.getState().open('pro-weekly-note')} data-pro-weekly-note-open>{t('pro.weekly.noteOpen')}</Button>
                  : <Button onClick={() => void navigate({ to: ROUTES[step.id as OlderStep] })}>{t('pro.weeklySteps.open')}</Button>}
                {!stepDone && <Button variant="quiet" onClick={() => markDone(step.id)}>{t('pro.weeklySteps.markDone')}</Button>}
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
