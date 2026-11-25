import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlarmClock, ArrowLeft, ArrowRight, CheckCircle2, Hourglass, Trash2 } from 'lucide-react'
import { cn } from '@/lib/cn'
import { confirmDelete } from '@/lib/confirm-bridge'
import { labelChipStyle } from '@/lib/label-style'
import { taskDescendants } from '@/lib/task-hierarchy'
import { pathOf } from '@/lib/ai/workspace'
import {
  draftChanges,
  draftOf,
  logChange,
  logComplete,
  logDelete,
  sessionCounts,
  summaryText,
  withSuggestion,
  type CardDraft,
  type SessionLog,
  type SuggestedField,
} from '@/lib/guided/cards'
import { useAiWorkspace } from '@/hooks/use-ai'
import { useGuidedWorld } from '@/hooks/use-guided-world'
import { useWorkMode } from '@/hooks/use-work-mode'
import { useIsDark } from '@/hooks/use-is-dark'
import { useOrganizeSuggestions } from '@/hooks/use-organize-suggestions'
import { useCompleteTask, useDeleteTask, useUpdateTask } from '@/hooks/use-task-mutations'
import { announce } from '@/stores/announcer-store'
import { useDayKey } from '@/stores/day-store'
import { Button } from '@/components/shared/Button'
import { SmartListIcon } from '@/components/shared/SmartListIcon'
import { TaskDueBadge } from '@/components/task-list/TaskDueBadge'
import { addedAgo, guidedQueue, GUIDED_QUEUE_NAMES, type GuidedQueueId } from '../../../shared/guided'
import { toLocalDate } from '@/lib/due-dates'
import { FieldLabel, GuidedCardShell, GuidedFrame, ProjectChoice, SUGGESTED, SuggestionLine, WhenChoices, isSessionKey } from './GuidedParts'
import { GuidedSummary } from './GuidedSummary'

// A card session (docs/cross-app-semantics-v1.md sections 14.2 and 14.3): the queue is taken when
// the session starts, one task at a time, the card's choices written together on Next through the
// usual offline-aware mutations, Complete and Delete at once, then a summary with Undo all.

export const SESSION_TITLES: Record<GuidedQueueId, string> = {
  inbox: 'Sort the Inbox',
  overdue: 'Sort out overdue',
  waiting: 'Waiting a long time',
}

export function sessionIcon(queue: GuidedQueueId): React.ReactNode {
  if (queue === 'inbox') return <SmartListIcon list="inbox" className="h-4 w-4" />
  if (queue === 'overdue') return <AlarmClock aria-hidden="true" className="h-4 w-4 text-status-overdue" />
  return <Hourglass aria-hidden="true" className="h-4 w-4 text-[var(--text-secondary)]" />
}

const HINTS = [
  ['Enter', 'Next'],
  ['←', 'Back'],
  ['S', 'Skip'],
  ['1 2 3 4', 'When'],
  ['D', 'Pick a date'],
  ['0', 'No date'],
  ['P', 'Project'],
  ['E', 'Title'],
  ['C', 'Complete'],
  ['Del', 'Delete'],
  ['Esc', 'Exit'],
] as const

interface CardState {
  draft: CardDraft
  suggested: ReadonlySet<SuggestedField>
}

interface Props {
  queueId: GuidedQueueId
  onExit: () => void
  /** The session ended and the person pressed Done; `summary` says what it changed. */
  onDone: (summary: string) => void
  doneLabel?: string
}

export function GuidedSortSession({ queueId, onExit, onDone, doneLabel }: Props) {
  const data = useGuidedWorld()
  const { hiddenLabelId } = useWorkMode()
  const ws = useAiWorkspace()
  const dayKey = useDayKey()
  const today = useMemo(() => toLocalDate(new Date()), [dayKey])
  const updateTask = useUpdateTask()
  const completeTask = useCompleteTask()
  const deleteTask = useDeleteTask()
  const isDark = useIsDark()

  const [queue, setQueue] = useState<number[] | null>(null)
  const [index, setIndex] = useState(0)
  const [cards, setCards] = useState<ReadonlyMap<number, CardState>>(new Map())
  const [log, setLog] = useState<SessionLog>(new Map())
  const [picker, setPicker] = useState<'when' | 'project' | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)

  // The queue is taken once, when the session starts (14.2).
  useEffect(() => {
    if (queue === null && data.world && !data.isLoading) setQueue(guidedQueue(queueId, data.world))
  }, [queue, data.world, data.isLoading, queueId])

  // A task done or deleted by the time its card comes is passed over.
  const presentFrom = useCallback((from: number, step: 1 | -1): number => {
    if (!queue) return -1
    for (let i = from; i >= 0 && i < queue.length; i += step) {
      if (data.openTask(queue[i])) return i
    }
    return -1
  }, [queue, data])

  const current = queue ? presentFrom(index, 1) : -1
  const finished = queue !== null && current === -1
  const taskId = current >= 0 && queue ? queue[current] : null
  const task = taskId !== null ? data.openTask(taskId) : undefined
  const previous = current > 0 ? presentFrom(current - 1, -1) : -1

  const inboxId = data.world?.inboxId ?? 0
  const suggestions = useOrganizeSuggestions({
    session: queueId,
    listName: GUIDED_QUEUE_NAMES[queueId],
    defaultProjectId: inboxId,
    ids: queue ?? [],
    index: Math.max(current, 0),
    task: data.openTask,
    resetKey: queueId,
  })
  const suggestion = task ? suggestions.suggestion(task.id) : undefined

  const card: CardState | null = task ? (cards.get(task.id) ?? withSuggestion(task, suggestion)) : null

  const edit = (next: Partial<CardDraft>, field: SuggestedField) => {
    if (!task || !card) return
    const suggested = new Set(card.suggested)
    suggested.delete(field)
    setCards((prev) => new Map(prev).set(task.id, { draft: { ...card.draft, ...next }, suggested }))
  }

  const advance = () => {
    setPicker(null)
    setIndex(current + 1)
  }

  const next = () => {
    if (!task || !card) return
    const changes = draftChanges(task, card.draft)
    if (Object.keys(changes).length > 0) {
      updateTask.mutate({ id: task.id, changes, original: task })
      setLog((prev) => logChange(prev, task, changes))
    }
    advance()
  }

  const back = () => {
    if (previous < 0 || !queue) return
    const id = queue[previous]
    const now = data.openTask(id)
    // The previous card again, with its values as they are now (14.3).
    if (now) setCards((prev) => new Map(prev).set(id, { draft: draftOf(now), suggested: new Set() }))
    setPicker(null)
    setIndex(previous)
  }

  const complete = () => {
    if (!task) return
    completeTask.mutate(task)
    setLog((prev) => logComplete(prev, task))
    advance()
  }

  const remove = async () => {
    if (!task) return
    const children = taskDescendants(task).length
    const ok = await confirmDelete(
      children > 0 ? `Delete this task and ${children} ${children === 1 ? 'subtask' : 'subtasks'}?` : 'Delete this task? This cannot be undone.',
      children > 0 ? { force: true, confirmLabel: 'Delete all', destructive: true } : {},
    )
    if (!ok) return
    deleteTask.mutate({ task })
    setLog((prev) => logDelete(prev, task))
    announce(`Deleted ${task.title}`)
    advance()
  }

  // Keyboard: the hints along the bottom.
  const keys = useRef({ next, back, skip: advance, complete, remove, onExit })
  keys.current = { next, back, skip: advance, complete, remove, onExit }
  const quick = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (finished || !task) return
    const onKey = (event: KeyboardEvent) => {
      if (!isSessionKey(event)) return
      const k = keys.current
      const key = event.key
      let handled = true
      if (key === 'Enter' || key === 'ArrowRight') k.next()
      else if (key === 'ArrowLeft') k.back()
      else if (key === 's' || key === 'S') k.skip()
      else if (key === 'c' || key === 'C') k.complete()
      else if (key === 'Delete' || key === 'Backspace') void k.remove()
      else if (key === 'e' || key === 'E' || key === 'F2') titleRef.current?.focus()
      else if (key === 'Escape') k.onExit()
      else if (key === 'p' || key === 'P') setPicker('project')
      else if (key === 'd' || key === 'D') setPicker('when')
      else if (key >= '0' && key <= '4') {
        // The When buttons in their order: Today, Tomorrow, This weekend, Next week; 0 is No date.
        const buttons = quick.current?.querySelectorAll<HTMLButtonElement>('[aria-keyshortcuts]')
        const target = [...(buttons ?? [])].find((button) => button.getAttribute('aria-keyshortcuts') === key)
        if (target) target.click()
        else handled = false
      } else handled = false
      if (handled) event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [finished, task])

  const title = SESSION_TITLES[queueId]
  const icon = sessionIcon(queueId)

  if (queue === null) {
    return (
      <GuidedFrame title={title} icon={icon} position={null} onExit={onExit}>
        <p className="text-center text-meta text-[var(--text-secondary)]" role="status">Loading your tasks…</p>
      </GuidedFrame>
    )
  }

  if (finished || !task || !card) {
    return (
      <GuidedFrame title={title} icon={icon} position={null} onExit={onExit} exitLabel="Close">
        <GuidedSummary
          empty={queue.length === 0}
          emptyText={EMPTY_TEXT[queueId]}
          log={log}
          summary={summaryText(sessionCounts(log))}
          doneLabel={doneLabel}
          onDone={() => onDone(summaryText(sessionCounts(log)))}
        />
      </GuidedFrame>
    )
  }

  const status = suggestions.failure ?? (suggestions.active && suggestions.pending(task.id) ? 'Asking for suggestions…' : null)
  const added = addedAgo(task, today)
  const projectPath = pathOf(ws, card.draft.projectId) || 'Project'
  const close = suggestion?.close ?? null

  return (
    <GuidedFrame title={title} icon={icon} position={{ current: current + 1, total: queue.length }} status={status} onExit={onExit} hints={HINTS}>
      <GuidedCardShell
        footer={
          <>
            <Button onClick={complete} aria-keyshortcuts="C" className={cn(close === 'done' && SUGGESTED)}>
              <CheckCircle2 aria-hidden="true" className="h-4 w-4" /> Complete
              {close === 'done' && <span className="text-caption text-accent-blue">Suggested</span>}
            </Button>
            <Button danger onClick={() => void remove()} aria-keyshortcuts="Delete" className={cn(close === 'delete' && SUGGESTED)}>
              <Trash2 aria-hidden="true" className="h-4 w-4" /> Delete
              {close === 'delete' && <span className="text-caption text-accent-blue">Suggested</span>}
            </Button>
            <Button variant="quiet" onClick={advance} aria-keyshortcuts="S">Skip</Button>
            <span className="flex-1" />
            <Button variant="quiet" onClick={back} disabled={previous < 0} aria-keyshortcuts="ArrowLeft">
              <ArrowLeft aria-hidden="true" className="h-4 w-4" /> Back
            </Button>
            <Button variant="primary" onClick={next} aria-keyshortcuts="Enter">
              Next <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Button>
          </>
        }
      >
        <div className="mb-2 text-meta text-[var(--text-secondary)]">{pathOf(ws, task.project_id)}</div>
        <label className="sr-only" htmlFor="guided-title">Title</label>
        <input
          id="guided-title"
          ref={titleRef}
          value={card.draft.title}
          onChange={(e) => edit({ title: e.target.value }, 'title')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault()
              next()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              e.currentTarget.blur()
            }
          }}
          aria-keyshortcuts="E"
          className={cn(
            '-mx-2 w-[calc(100%+1rem)] rounded-control border bg-transparent px-2 py-1 text-page-title text-[var(--text-primary)] focus:outline-none focus-visible:border-accent-blue',
            card.suggested.has('title') ? SUGGESTED : 'border-transparent hover:border-[var(--border-color)]',
          )}
        />
        <SuggestionLine reason={suggestion?.reason} pending={suggestions.active && suggestions.pending(task.id)} />
        <div className="mt-3 flex flex-wrap items-center gap-2 text-meta text-[var(--text-secondary)]">
          {added && <span>{added}</span>}
          <TaskDueBadge dueDate={task.due_date} />
          {(task.labels ?? []).filter((label) => label.id !== hiddenLabelId).map((label) => (
            <span key={label.id} className="vicu-chip rounded-chip px-2 py-px text-chip" style={labelChipStyle(label.hex_color, isDark)}>{label.title}</span>
          ))}
        </div>

        <div ref={quick} className="mt-6 space-y-5">
          <div>
            <FieldLabel>When</FieldLabel>
            <WhenChoices
              value={card.draft.due}
              onChange={(due) => edit({ due }, 'when')}
              suggested={card.suggested.has('when')}
              pickerOpen={picker === 'when'}
              onPickerOpenChange={(open) => setPicker(open ? 'when' : null)}
            />
          </div>
          <div>
            <FieldLabel>Project</FieldLabel>
            <ProjectChoice
              projectId={card.draft.projectId}
              path={projectPath}
              onChange={(projectId) => edit({ projectId }, 'project')}
              suggested={card.suggested.has('project')}
              pickerOpen={picker === 'project'}
              onPickerOpenChange={(open) => setPicker(open ? 'project' : null)}
            />
          </div>
        </div>
      </GuidedCardShell>
    </GuidedFrame>
  )
}

const EMPTY_TEXT: Record<GuidedQueueId, string> = {
  inbox: 'Nothing in the Inbox to sort.',
  overdue: 'Nothing is overdue.',
  waiting: 'No task has waited 60 days or more.',
}
