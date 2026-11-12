import { useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { CheckCircle2, Circle } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Button } from '@/components/shared/Button'
import { usePro } from '@/hooks/use-pro'
import { useProLedger } from '@/hooks/use-pro-ledger'
import { useProjects } from '@/hooks/use-projects'
import { useAvailability } from '@/hooks/use-availability'
import type { Task } from '@/lib/vikunja-types'
import type { LocalDate } from '../../../shared/due-dates'
import { mirrorText, proWeeklySteps, weeklyMirror, type ProWeeklyStepId } from '../../../shared/pro/weekly'
import { rankedInitiatives } from '../../../shared/pro/portfolio'

const HINTS: Record<ProWeeklyStepId, string> = {
  verdicts: 'Promises others made you that are due: kept, not yet, or another verdict.',
  unsent: 'What was agreed in a meeting and not sent in a recap yet.',
  escalations: 'Escalations drafted or on the agenda, and decisions you are owed.',
  portfolio: 'Initiatives not ready, over the cap or without an available task.',
  value: 'Initiatives closed this week without the value they delivered.',
}

const ROUTES: Record<ProWeeklyStepId, string> = {
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
  const [done, setDone] = useState<ReadonlySet<ProWeeklyStepId>>(new Set())

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
    <section aria-label="Execution review" className="mb-4 flex flex-col gap-2" data-pro-weekly>
      {mirror && (
        <p className="rounded-card border border-accent-blue/40 bg-accent-blue/8 px-4 py-3 text-meta text-[var(--text-primary)]" data-pro-mirror>
          {mirrorText(mirror)}
        </p>
      )}
      {steps.length > 0 && (
        <ol className="flex flex-col gap-2" aria-label="Execution steps">
          {steps.map((step) => {
            const stepDone = done.has(step.id) || step.count === 0
            const hint = step.id === 'portfolio' && loggedAnyway > 0
              ? `${HINTS.portfolio} ${loggedAnyway} ${loggedAnyway === 1 ? 'task was' : 'tasks were'} logged anyway.`
              : HINTS[step.id]
            return (
              <li key={step.id} className="flex items-center gap-3 rounded-card border border-[var(--border-color)] px-4 py-3" data-pro-weekly-step={step.id}>
                {stepDone
                  ? <CheckCircle2 aria-label="Done" className="h-5 w-5 shrink-0 text-accent-green" />
                  : <Circle aria-label="Not done" className="h-5 w-5 shrink-0 text-[var(--text-secondary)]" />}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <h2 className={cn('text-task-title font-medium text-[var(--text-primary)]', stepDone && 'text-[var(--text-secondary)]')}>{step.title}</h2>
                    <span className="text-meta tabular-nums text-[var(--text-secondary)]">{step.count}</span>
                  </div>
                  <p className="text-meta text-[var(--text-secondary)]">{hint}</p>
                </div>
                <Button onClick={() => void navigate({ to: ROUTES[step.id] })}>Open</Button>
                {!stepDone && <Button variant="quiet" onClick={() => setDone((prev) => new Set(prev).add(step.id))}>Mark done</Button>}
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
