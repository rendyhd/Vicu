import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TranslationKey } from '../../../shared/i18n'
import { Archive, ArrowRight, Check, CheckCircle2, PauseCircle, Plus, Sparkles, Trash2 } from 'lucide-react'
import { usePro } from '@/hooks/use-pro'
import { useProPrefs } from '@/hooks/use-pro-prefs'
import { cn } from '@/lib/cn'
import { confirmDelete } from '@/lib/confirm-bridge'
import { taskDescendants } from '@/lib/task-hierarchy'
import { pathOf } from '@/lib/ai/workspace'
import { computeStatus, parseReviewFooter } from '@/lib/review-metadata'
import {
  logChange,
  logComplete,
  logDelete,
  nextStepDue,
  sessionCounts,
  summaryText,
  withSuggestion,
  draftChanges,
  type SessionLog,
} from '@/lib/guided/cards'
import { useAiWorkspace } from '@/hooks/use-ai'
import { useGuidedWorld } from '@/hooks/use-guided-world'
import { useOrganizeSuggestions } from '@/hooks/use-organize-suggestions'
import { useMarkReviewed, useRestoreReviewDescription } from '@/hooks/use-review'
import { useCompleteTask, useCreateTask, useDeleteTask, useSetProjectArchived, useUpdateTask } from '@/hooks/use-task-mutations'
import { announce } from '@/stores/announcer-store'
import { toast } from '@/stores/toast-store'
import { Button } from '@/components/shared/Button'
import { SmartListIcon } from '@/components/shared/SmartListIcon'
import { TaskDueBadge } from '@/components/task-list/TaskDueBadge'
import { AI_LIMITS } from '../../../shared/ai/contract'
import { ago, healthLine, projectHealth, reviewQueue } from '../../../shared/guided'
import { sortTasksByOrder } from '../../../shared/task-order'
import type { Project, Task } from '@/lib/vikunja-types'
import { FieldLabel, GuidedCardShell, GuidedFrame, ProjectChoice, SUGGESTED, SuggestionLine, WhenChoices, isSessionKey } from './GuidedParts'
import { GuidedSummary } from './GuidedSummary'

// The project review session (docs/cross-app-semantics-v1.md section 14.4): the projects due for
// review, one page each: the health line, "Still working on it?", the untouched tasks with the
// card's choices, the next step, then Mark reviewed or Skip. With Ask set up, one request per page
// suggests a decision for its tasks and the next step (docs/ai-assistant-v1.md section 9).

const HINTS = [
  ['R', 'guided.review.markReviewed'],
  ['S', 'guided.skip'],
  ['A', 'guided.review.archive'],
  ['Esc', 'guided.exit'],
] as const satisfies ReadonlyArray<readonly [string, TranslationKey]>

interface Props {
  onExit: () => void
  onDone: (summary: string) => void
  doneLabel?: string
}

interface PageResult {
  reviewed: Project[]
  archived: Project[]
  created: Task[]
}

export function ProjectReviewSession({ onExit, onDone, doneLabel }: Props) {
  const { t } = useTranslation()
  const [queue, setQueue] = useState<number[] | null>(null)
  const [index, setIndex] = useState(0)
  const projectId = queue && index < queue.length ? queue[index] : undefined
  const data = useGuidedWorld(projectId)
  const [log, setLog] = useState<SessionLog>(new Map())
  const [result, setResult] = useState<PageResult>({ reviewed: [], archived: [], created: [] })
  const markReviewed = useMarkReviewed()
  const restoreReview = useRestoreReviewDescription()
  const setArchived = useSetProjectArchived()
  const deleteTask = useDeleteTask()

  useEffect(() => {
    if (queue === null && data.world && !data.isLoading) setQueue(reviewQueue(data.world))
  }, [queue, data.world, data.isLoading])

  const project = projectId !== undefined ? data.world?.project(projectId) as Project | undefined : undefined
  const finished = queue !== null && (index >= queue.length)

  const goOn = () => setIndex((i) => i + 1)

  const review = () => {
    if (!project) return
    markReviewed.mutate({ project }, {
      onSuccess: () => announce(t('guided.review.markedReviewed', { title: project.title })),
      onError: (error) => toast.error(t('guided.review.markFailed', { title: project.title, error: error.message })),
    })
    setResult((prev) => ({ ...prev, reviewed: [...prev.reviewed, project] }))
    goOn()
  }

  const archive = () => {
    if (!project || project.id === data.world?.inboxId) return
    setArchived.mutate({ project, archived: true })
    setResult((prev) => ({ ...prev, archived: [...prev.archived, project] }))
    announce(t('guided.review.archivedProject', { title: project.title }))
    goOn()
  }

  const keys = useRef({ review, archive, goOn, onExit })
  keys.current = { review, archive, goOn, onExit }
  useEffect(() => {
    if (finished || !project) return
    const onKey = (event: KeyboardEvent) => {
      if (!isSessionKey(event)) return
      const k = keys.current
      let handled = true
      if (event.key === 'r' || event.key === 'R') k.review()
      else if (event.key === 's' || event.key === 'S') k.goOn()
      else if (event.key === 'a' || event.key === 'A') k.archive()
      else if (event.key === 'Escape') k.onExit()
      else handled = false
      if (handled) event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [finished, project])

  const title = t('guided.review.title')
  const icon = <SmartListIcon list="review" className="h-4 w-4" />

  if (queue === null) {
    return (
      <GuidedFrame title={title} icon={icon} position={null} onExit={onExit}>
        <p className="text-center text-meta text-[var(--text-secondary)]" role="status">{t('guided.review.loadingProjects')}</p>
      </GuidedFrame>
    )
  }

  if (finished || !project || !data.world) {
    const reviewedText = [
      result.reviewed.length > 0 && t('guided.review.countReviewed', { count: result.reviewed.length }),
      result.archived.length > 0 && t('guided.review.countArchived', { count: result.archived.length }),
      result.created.length > 0 && t('guided.review.countTasksAdded', { count: result.created.length }),
    ].filter(Boolean).join(', ')
    const tasksText = summaryText(sessionCounts(log))
    const summary = reviewedText ? t('guided.review.projectsSummary', { summary: reviewedText }) : t('guided.review.noneReviewed')
    return (
      <GuidedFrame title={title} icon={icon} position={null} onExit={onExit} exitLabel={t('guided.close')}>
        <GuidedSummary
          empty={queue.length === 0}
          emptyText={t('guided.review.nothingDue')}
          log={log}
          summary={summary}
          extra={<p className="text-meta text-[var(--text-secondary)]">{t('guided.review.tasksSummary', { summary: tasksText })}</p>}
          canUndoMore={result.reviewed.length + result.archived.length + result.created.length > 0}
          onUndoMore={async () => {
            for (const created of result.created) await deleteTask.mutateAsync({ task: created, deleteSubtasks: false })
            for (const archived of result.archived) await setArchived.mutateAsync({ project: archived, archived: false })
            for (const reviewed of result.reviewed) restoreReview.mutate({ project: reviewed })
          }}
          doneLabel={doneLabel}
          onDone={() => onDone(t('guided.review.doneSummary', { summary, tasks: tasksText }))}
        />
      </GuidedFrame>
    )
  }

  return (
    <GuidedFrame title={title} icon={icon} position={{ current: index + 1, total: queue.length }} onExit={onExit} hints={HINTS}>
      <ReviewPage
        key={project.id}
        project={project}
        data={data}
        onLog={setLog}
        onCreated={(task) => setResult((prev) => ({ ...prev, created: [...prev.created, task] }))}
        onReview={review}
        onSkip={goOn}
        onArchive={project.id === data.world.inboxId ? null : archive}
      />
    </GuidedFrame>
  )
}

interface PageProps {
  project: Project
  data: ReturnType<typeof useGuidedWorld>
  onLog: (update: (log: SessionLog) => SessionLog) => void
  onCreated: (task: Task) => void
  onReview: () => void
  onSkip: () => void
  onArchive: (() => void) | null
}

function ReviewPage({ project, data, onLog, onCreated, onReview, onSkip, onArchive }: PageProps) {
  const { t } = useTranslation()
  // Pro (21.2): a project can be put on hold here instead of archived; not the Inbox.
  const proHold = usePro().layer('availability') && project.id !== data.world?.inboxId
  const proPrefs = useProPrefs()
  const held = proPrefs.projectOnHold(project.id)
  const ws = useAiWorkspace()
  const world = data.world!
  const updateTask = useUpdateTask()
  const completeTask = useCompleteTask()
  const deleteTask = useDeleteTask()
  const createTask = useCreateTask()
  const [handled, setHandled] = useState<ReadonlyMap<number, string>>(new Map())
  const [newTitle, setNewTitle] = useState<string | null>(null)

  const health = projectHealth(world, project.id)
  const status = computeStatus(parseReviewFooter(project.description), world.review.defaultCadence, new Date())
  const last = status.daysSinceReviewed === null ? t('guided.review.neverReviewed') : t('guided.review.lastReviewed', { ago: ago(status.daysSinceReviewed) })
  const path = world.path(project.id)

  // The page's tasks for the request: the untouched ones first, then the project's order (9.1).
  const pageIds = useMemo(() => {
    const open = world.tasks.filter((task) => task.project_id === project.id && task.done !== true)
    const rest = sortTasksByOrder(open, world.orderOf(project.id)).map((task) => task.id).filter((id) => !health.untouchedIds.includes(id))
    return [...health.untouchedIds, ...rest].slice(0, AI_LIMITS.organize_batch_max)
    // Taken once per page: a change on the page must not send it again.
  }, [project.id])
  const [untouched] = useState(() => health.untouchedIds)
  const suggestions = useOrganizeSuggestions({
    session: 'review',
    listName: path,
    defaultProjectId: project.id,
    ids: pageIds,
    index: 0,
    task: data.openTask,
    resetKey: `review-${project.id}`,
  })

  const nextStep = suggestions.nextStep
  const stepTaskId = nextStep?.task_id ?? (nextStep?.title ? null : health.firstOpen)
  const stepTask = stepTaskId !== null ? data.openTask(stepTaskId) : undefined
  const suggestedTitle = nextStep && nextStep.task_id === null ? nextStep.title : null
  const shownTitle = newTitle ?? suggestedTitle ?? ''

  const mark = (id: number, text: string) => setHandled((prev) => new Map(prev).set(id, text))

  const change = (task: Task, changes: Partial<Task>, text: string) => {
    if (Object.keys(changes).length === 0) return
    updateTask.mutate({ id: task.id, changes, original: task })
    onLog((log) => logChange(log, task, changes))
    mark(task.id, text)
  }

  const complete = (task: Task) => {
    completeTask.mutate(task)
    onLog((log) => logComplete(log, task))
    mark(task.id, t('guided.review.completed'))
  }

  const remove = async (task: Task) => {
    const children = taskDescendants(task).length
    const ok = await confirmDelete(
      children > 0 ? t('guided.deleteWithSubtasks', { count: children }) : t('guided.deleteTask'),
      children > 0 ? { force: true, confirmLabel: t('guided.deleteAll'), destructive: true } : {},
    )
    if (!ok) return
    deleteTask.mutate({ task })
    onLog((log) => logDelete(log, task))
    mark(task.id, t('guided.review.deleted'))
  }

  const addStep = () => {
    const title = shownTitle.trim()
    if (!title) return
    const due = nextStepDue(nextStep && nextStep.task_id === null ? nextStep : null)
    createTask.mutate(
      { projectId: project.id, task: { title, ...(due ? { due_date: due } : {}) } },
      {
        onSuccess: (task) => {
          onCreated(task)
          announce(t('guided.review.added', { title }))
        },
      },
    )
    setNewTitle('')
  }

  return (
    <GuidedCardShell
      footer={
        <>
          <Button variant="quiet" onClick={onSkip} aria-keyshortcuts="S">{t('guided.skip')}</Button>
          <span className="flex-1" />
          <Button variant="primary" onClick={onReview} aria-keyshortcuts="R">
            <Check aria-hidden="true" className="h-4 w-4" /> {t('guided.review.markReviewed')} <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </Button>
        </>
      }
    >
      {project.parent_project_id ? (
        <div className="mb-1 text-meta text-[var(--text-secondary)]">{pathOf(ws, project.parent_project_id)}</div>
      ) : null}
      <h2 className="text-page-title text-[var(--text-primary)]">{project.title}</h2>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-meta text-[var(--text-secondary)]">
        <span className={cn('rounded-full px-2 py-0.5 text-chip font-semibold', status.daysSinceReviewed === null ? 'bg-[var(--bg-hover)]' : 'bg-accent-purple/12 text-[var(--text-primary)]')}>{last}</span>
        <span>{healthLine(health)}</span>
      </div>
      {suggestions.failure && <p className="mt-2 text-caption text-[var(--text-secondary)]">{suggestions.failure}</p>}

      <section className="mt-6" aria-labelledby="still-working">
        <FieldLabel><span id="still-working">{t('guided.review.stillWorking')}</span></FieldLabel>
        <div className="flex flex-wrap gap-1.5">
          {proHold ? (
            <>
              <Button aria-pressed={!held} className={cn(!held && 'border-accent-blue bg-accent-blue/12')} onClick={() => held && void proPrefs.setProjectOnHold(project.id, false)}>
                {t('guided.review.keep')}
              </Button>
              <Button aria-pressed={held} className={cn(held && 'border-accent-blue bg-accent-blue/12')} onClick={() => !held && void proPrefs.setProjectOnHold(project.id, true)}>
                <PauseCircle aria-hidden="true" className="h-4 w-4" /> {t('guided.review.onHold')}
              </Button>
            </>
          ) : (
            <Button aria-pressed="true" className="border-accent-blue bg-accent-blue/12">{t('guided.review.keep')}</Button>
          )}
          {onArchive && (
            <Button onClick={onArchive} aria-keyshortcuts="A">
              <Archive aria-hidden="true" className="h-4 w-4" /> {t('guided.review.archive')}
            </Button>
          )}
        </div>
      </section>

      {untouched.length > 0 && (
        <section className="mt-6" aria-labelledby="untouched">
          <FieldLabel><span id="untouched">{t('guided.review.untouched')}</span></FieldLabel>
          <ul className="divide-y divide-[var(--border-color)] rounded-card border border-[var(--border-color)]">
            {untouched.map((id) => {
              const task = data.openTask(id)
              const done = handled.get(id)
              if (!task) {
                return done ? <li key={id} className="px-3 py-2 text-meta text-[var(--text-secondary)]">{done}</li> : null
              }
              return (
                <UntouchedRow
                  key={id}
                  task={task}
                  note={done}
                  pending={suggestions.active && suggestions.pending(id)}
                  suggestion={suggestions.suggestion(id)}
                  projectPath={(projectId) => pathOf(ws, projectId)}
                  onChange={(changes, text) => change(task, changes, text)}
                  onComplete={() => complete(task)}
                  onDelete={() => void remove(task)}
                />
              )
            })}
          </ul>
        </section>
      )}

      <section className="mt-6" aria-labelledby="next-step">
        <FieldLabel><span id="next-step">{t('guided.review.nextStep')}</span></FieldLabel>
        {stepTask ? (
          <div className="rounded-card border border-[var(--border-color)] p-3">
            <div className="flex items-center gap-2">
              {nextStep?.task_id === stepTask.id && <Sparkles aria-label={t('guided.suggested')} className="h-3.5 w-3.5 shrink-0 text-accent-blue" />}
              <span className="min-w-0 flex-1 truncate text-task-title text-[var(--text-primary)]">{stepTask.title}</span>
              <TaskDueBadge dueDate={stepTask.due_date} />
            </div>
            <div className="mt-2">
              <WhenChoices
                compact
                label={t('guided.review.whenFor', { title: stepTask.title })}
                value={stepTask.due_date}
                suggested={nextStep?.task_id === stepTask.id && nextStep.due !== null}
                onChange={(due) => change(stepTask, draftChanges(stepTask, { title: stepTask.title, projectId: stepTask.project_id, due }), t('guided.review.scheduled'))}
              />
            </div>
          </div>
        ) : (
          <p className="text-meta text-[var(--text-secondary)]">{t('guided.review.noOpenTask')}</p>
        )}
        <form
          className="mt-3 flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            addStep()
          }}
        >
          <label htmlFor="review-new-step" className="sr-only">{t('guided.review.newTaskFor', { title: project.title })}</label>
          <input
            id="review-new-step"
            value={shownTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder={t('guided.review.newTaskPlaceholder')}
            className={cn(
              'min-w-0 flex-1 rounded-control border bg-transparent px-2.5 py-1.5 text-task-title text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]',
              newTitle === null && suggestedTitle ? SUGGESTED : 'border-[var(--border-color)]',
            )}
          />
          <Button type="submit" disabled={!shownTitle.trim()}>
            <Plus aria-hidden="true" className="h-4 w-4" /> {t('guided.review.add')}
          </Button>
        </form>
      </section>
    </GuidedCardShell>
  )
}

interface RowProps {
  task: Task
  note?: string
  pending: boolean
  suggestion: ReturnType<ReturnType<typeof useOrganizeSuggestions>['suggestion']>
  projectPath: (projectId: number) => string
  onChange: (changes: Partial<Task>, text: string) => void
  onComplete: () => void
  onDelete: () => void
}

/** An untouched task on a review page: kept, given a date or none, moved, completed or deleted. */
function UntouchedRow({ task, note, pending, suggestion, projectPath, onChange, onComplete, onDelete }: RowProps) {
  const { t } = useTranslation()
  const applied = withSuggestion(task, suggestion)
  const suggestedChanges = suggestion ? draftChanges(task, applied.draft) : {}
  const hasSuggestedChange = Object.keys(suggestedChanges).length > 0
  const close = suggestion?.close ?? null
  return (
    <li className="px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-task-title text-[var(--text-primary)]">{task.title}</span>
        <TaskDueBadge dueDate={task.due_date} />
        {note && <span className="text-caption text-[var(--text-secondary)]">{note}</span>}
      </div>
      <SuggestionLine reason={suggestion?.reason} pending={pending} />
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {hasSuggestedChange && (
          <Button className={cn('min-h-7 px-2.5 text-meta', SUGGESTED)} onClick={() => onChange(suggestedChanges, t('guided.review.changedAsSuggested'))}>
            <Sparkles aria-hidden="true" className="h-3.5 w-3.5" /> {t('guided.review.useSuggestion')}
          </Button>
        )}
        <WhenChoices
          compact
          label={t('guided.review.whenFor', { title: task.title })}
          value={task.due_date}
          onChange={(due) => onChange(draftChanges(task, { title: task.title, projectId: task.project_id, due }), t('guided.review.scheduled'))}
        />
        <ProjectChoice
          compact
          projectId={task.project_id}
          path={projectPath(task.project_id)}
          onChange={(projectId) => onChange({ project_id: projectId }, t('guided.review.movedTo', { path: projectPath(projectId) }))}
        />
        <Button className={cn('min-h-7 px-2.5 text-meta', close === 'done' && SUGGESTED)} onClick={onComplete}>
          <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5" /> {t('guided.complete')}
        </Button>
        <Button danger className={cn('min-h-7 px-2.5 text-meta', close === 'delete' && SUGGESTED)} onClick={onDelete}>
          <Trash2 aria-hidden="true" className="h-3.5 w-3.5" /> {t('guided.delete')}
        </Button>
      </div>
    </li>
  )
}
