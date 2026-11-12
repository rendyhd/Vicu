import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowRight, CheckCircle2, Circle, ListChecks, Mic } from 'lucide-react'
import { cn } from '@/lib/cn'
import { toLocalDate } from '@/lib/due-dates'
import { pathOf } from '@/lib/ai/workspace'
import { useAiReady, useAiWorkspace } from '@/hooks/use-ai'
import { useGuidedWorld } from '@/hooks/use-guided-world'
import { useOpenTask } from '@/hooks/use-open-task'
import { writeSyncedPrefs } from '@/hooks/use-synced-prefs'
import { useDayKey } from '@/stores/day-store'
import { useDictationStore } from '@/stores/dictation-store'
import { announce } from '@/stores/announcer-store'
import { useWeeklyReviewStore } from '@/stores/weekly-review-store'
import { Button } from '@/components/shared/Button'
import { PageHeader } from '@/components/shared/PageHeader'
import { ReadingScroll } from '@/components/layout/ReadingScroll'
import { NewTaskComposer } from '@/components/task-list/NewTaskComposer'
import { TaskDueBadge } from '@/components/task-list/TaskDueBadge'
import { WeeklyProSteps } from '@/components/pro/WeeklyProSteps'
import type { Task } from '@/lib/vikunja-types'
import { ago, weeklyReviewAge, weeklySteps, type WeeklyStep, type WeeklyStepId } from '../../shared/guided'
import { WEEKLY_REVIEW_LAST_KEY } from '../../shared/synced-prefs'

// The weekly review (docs/cross-app-semantics-v1.md section 14.7): the steps in GTD order, Next to
// the first one not done, any step can be opened, and Finish records the day in the synced
// preference `weekly_review.last`.

const SESSION_STEPS: ReadonlySet<WeeklyStepId> = new Set(['inbox', 'overdue', 'review', 'waiting'])

const STEP_HINTS: Record<WeeklyStepId, string> = {
  inbox: 'Give each new task a project and a date, or let it go.',
  mind: 'Get what is on your mind out of your head and into the Inbox.',
  done: 'What you finished in the last 7 days.',
  overdue: 'Pick a date you can keep, take the date away, or finish it.',
  upcoming: 'What is due in the next two weeks.',
  review: 'Each project due for review, one at a time.',
  waiting: 'Tasks untouched for two months or more: keep, finish or let go.',
}

export function WeeklyReviewView() {
  const data = useGuidedWorld()
  const ws = useAiWorkspace()
  const ai = useAiReady()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const openTask = useOpenTask()
  const dayKey = useDayKey()
  const today = useMemo(() => toLocalDate(new Date()), [dayKey])
  const { done, results, begin, markDone, reset } = useWeeklyReviewStore()
  const [open, setOpen] = useState<WeeklyStepId | null>(null)
  const [finished, setFinished] = useState<ReadonlyArray<{ step: WeeklyStepId; text: string }> | null>(null)
  const [composing, setComposing] = useState(false)

  useEffect(() => begin(today), [begin, today])

  const steps = useMemo(() => (data.world ? weeklySteps(data.world) : []), [data.world])
  // A step whose count is 0 is done from the start; `mind` never is.
  const isDone = (step: WeeklyStep) => done.has(step.id) || step.count === 0
  const firstOpen = steps.find((step) => !isDone(step)) ?? null

  const openStep = (step: WeeklyStep) => {
    if (SESSION_STEPS.has(step.id)) {
      void navigate({ to: '/guided/$session', params: { session: step.id }, search: { from: 'weekly' } })
      return
    }
    setOpen(step.id)
  }

  const finish = async () => {
    const ok = await writeSyncedPrefs(queryClient, { [WEEKLY_REVIEW_LAST_KEY]: today })
    if (!ok) return
    setFinished(results)
    reset()
    announce('Weekly review done')
  }

  const age = weeklyReviewAge(data.weeklyReviewLast, today)
  const subtitle = age === null ? 'Not done yet' : `Last done ${ago(age)}`

  if (finished) {
    return (
      <div className="flex h-full flex-col bg-[var(--bg-primary)]">
        <PageHeader title="Weekly review" icon={<ListChecks aria-hidden="true" className="h-5 w-5 text-accent-purple" />} subtitle="Done for this week" />
        <ReadingScroll columnClassName="flex flex-col gap-4 px-6 pb-8 pt-2">
          <div className="flex flex-col items-center gap-3 rounded-card border border-[var(--border-color)] p-8 text-center">
            <CheckCircle2 aria-hidden="true" className="h-10 w-10 text-accent-green" strokeWidth={1.5} />
            <p className="text-card-title text-[var(--text-primary)]" role="status">Weekly review done</p>
            {finished.length === 0 ? (
              <p className="text-meta text-[var(--text-secondary)]">Nothing was changed in the sessions.</p>
            ) : (
              <ul className="space-y-1 text-meta text-[var(--text-secondary)]">
                {finished.map((entry) => <li key={entry.step}><span className="font-medium text-[var(--text-primary)]">{steps.find((s) => s.id === entry.step)?.title ?? entry.step}:</span> {entry.text}</li>)}
              </ul>
            )}
            <Button variant="primary" onClick={() => void navigate({ to: '/inbox' })}>Close</Button>
          </div>
        </ReadingScroll>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-[var(--bg-primary)]">
      <PageHeader
        title="Weekly review"
        icon={<ListChecks aria-hidden="true" className="h-5 w-5 text-accent-purple" />}
        subtitle={subtitle}
        actions={
          <>
            {firstOpen && (
              <Button variant="primary" onClick={() => openStep(firstOpen)}>
                Next: {firstOpen.title} <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </Button>
            )}
            <Button variant={firstOpen ? 'secondary' : 'primary'} onClick={() => void finish()}>Finish</Button>
          </>
        }
      />
      <ReadingScroll columnClassName="flex flex-col px-6 pb-8 pt-2">
        {data.isLoading && <p className="py-4 text-meta text-[var(--text-secondary)]" role="status">Loading your tasks…</p>}
        {data.world && <WeeklyProSteps tasks={data.world.tasks as Task[]} today={today} />}
        <ol className="flex flex-col gap-2" aria-label="Steps">
          {steps.map((step, i) => {
            const stepDone = isDone(step)
            const expanded = open === step.id
            return (
              <li key={step.id} className={cn('rounded-card border border-[var(--border-color)]', expanded && 'bg-[var(--bg-secondary)]')}>
                <div className="flex items-center gap-3 px-4 py-3">
                  {stepDone
                    ? <CheckCircle2 aria-label="Done" className="h-5 w-5 shrink-0 text-accent-green" />
                    : <Circle aria-label="Not done" className="h-5 w-5 shrink-0 text-[var(--text-secondary)]" />}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="text-caption tabular-nums text-[var(--text-secondary)]">{i + 1}</span>
                      <h2 className={cn('text-task-title font-medium text-[var(--text-primary)]', stepDone && 'text-[var(--text-secondary)]')}>{step.title}</h2>
                      {step.count !== null && <span className="text-meta tabular-nums text-[var(--text-secondary)]">{step.count}</span>}
                    </div>
                    <p className="text-meta text-[var(--text-secondary)]">{results.find((r) => r.step === step.id)?.text ?? STEP_HINTS[step.id]}</p>
                  </div>
                  <Button onClick={() => (expanded ? setOpen(null) : openStep(step))} aria-expanded={SESSION_STEPS.has(step.id) ? undefined : expanded}>
                    {SESSION_STEPS.has(step.id) ? 'Open' : expanded ? 'Close' : 'Open'}
                  </Button>
                  {!stepDone && <Button variant="quiet" onClick={() => markDone(step.id)}>Mark done</Button>}
                </div>
                {expanded && (
                  <div className="border-t border-[var(--border-color)] px-4 py-3">
                    {step.id === 'mind' && (
                      ai.dictation ? (
                        <Button onClick={() => useDictationStore.getState().startLive({ brainDump: true })}>
                          <Mic aria-hidden="true" className="h-4 w-4" /> Start a brain dump
                        </Button>
                      ) : composing && data.world?.inboxId ? (
                        <NewTaskComposer projectId={data.world.inboxId} onCancel={() => setComposing(false)} onCreated={() => announce('Added to the Inbox')} />
                      ) : (
                        <Button onClick={() => setComposing(true)} disabled={!data.world?.inboxId}>Add to the Inbox</Button>
                      )
                    )}
                    {(step.id === 'done' || step.id === 'upcoming') && (
                      step.ids.length === 0 ? (
                        <p className="text-meta text-[var(--text-secondary)]">{step.id === 'done' ? 'Nothing finished in the last 7 days.' : 'Nothing due in the next two weeks.'}</p>
                      ) : (
                        <ul className="divide-y divide-[var(--border-color)]">
                          {step.ids.map((id) => {
                            const task = data.world?.task(id)
                            if (!task) return null
                            return (
                              <li key={id}>
                                <button type="button" onClick={() => openTask(id)} className="flex w-full items-center gap-2 py-2 text-left hover:bg-[var(--bg-hover)]">
                                  <span className={cn('min-w-0 flex-1 truncate text-task-title text-[var(--text-primary)]', task.done && 'line-through text-[var(--text-secondary)]')}>{task.title}</span>
                                  <span className="shrink-0 truncate text-meta text-[var(--text-secondary)]">{pathOf(ws, task.project_id)}</span>
                                  {!task.done && <TaskDueBadge dueDate={task.due_date} />}
                                </button>
                              </li>
                            )
                          })}
                        </ul>
                      )
                    )}
                    {!stepDone && (
                      <div className="mt-3">
                        <Button variant="quiet" onClick={() => { markDone(step.id); setOpen(null) }}>Mark done</Button>
                      </div>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      </ReadingScroll>
    </div>
  )
}
