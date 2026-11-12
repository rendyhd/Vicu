import { useCallback, useMemo, useRef, useState } from 'react'
import { useAppConfig } from './use-app-config'
import { useAiReady } from './use-ai'
import { useFilters } from './use-filters'
import { usePlannerPrefs, usePlanRange, usePlanRoutines, useSavePlannerConfig, toTaskChanges } from './use-planner'
import { useProjectAccessMap } from './use-project-access'
import { useProjectTasks } from './use-project-tasks'
import { useTasks } from './use-tasks'
import { useCompleteTask, useUncompleteTask, useUpdateTask } from './use-task-mutations'
import { usePlanSuggestions } from './use-plan-suggestions'
import { usePlanBusy } from './use-plan-busy'
import { usePro } from './use-pro'
import { useProLedger } from './use-pro-ledger'
import { useFocusBlock } from './use-focus-block'
import { estimateOf, type ProLedger } from '../../shared/pro/ledger'
import { NULL_DATE } from '@/lib/constants'
import type { Task, TaskQueryParams } from '@/lib/vikunja-types'
import { addLocalDays, startOfLocalDay, toLocalDate, type LocalDate } from '../../shared/due-dates'
import { blockOf, atClock, freeRanges, minutesOfDay, clockMinutes, type BlockChanges } from '../../shared/time-blocks'
import {
  PROJECT_GROUP_MAX,
  acceptChanges,
  canWaitChanges,
  comingUpTasks,
  dayBusy,
  draftBlocks,
  inboxCandidates,
  leftoverChanges,
  leftoversQueue,
  onDayTasks,
  planMeter,
  tasksToPlace,
  withStartReminder,
  withoutStartReminder,
  withoutTasks,
  type LeftoverAction,
  type MinuteRange,
} from '../../shared/plan-day'

export const PLAN_STEPS = ['Leftovers', 'Choose', 'Arrange', 'Ready'] as const

const LENGTH_CYCLE = [15, 30, 45, 60, 90, 120]

const HANDLED_LABEL: Record<LeftoverAction, string> = {
  today: 'Moved to today',
  tomorrow: 'Moved to tomorrow',
  no_date: 'Date removed',
  done: 'Done',
}

/** Every task the session changed: how it was, and what it wrote, for Undo all. */
interface LogEntry {
  before: Task
  after: Partial<Task>
  completed: boolean
}

function estimatesOf(tasks: readonly Task[], ledger: ProLedger): Map<number, number> {
  const map = new Map<number, number>()
  for (const task of tasks) {
    const minutes = estimateOf(ledger, task.id)
    if (minutes !== null) map.set(task.id, minutes)
  }
  return map
}

function leftoversFilter(today: LocalDate): string {
  const start = startOfLocalDay(today).toISOString()
  return `done = false && ((due_date != '${NULL_DATE}' && due_date < '${start}') || (start_date != '${NULL_DATE}' && start_date < '${start}'))`
}

/**
 * The state of one Plan my day session (contract 14.10). The rules are in `src/shared/plan-day.ts`;
 * this holds the choices, runs the writes and keeps the log Undo all reads.
 */
export function usePlanSession() {
  const { data: config } = useAppConfig()
  const saveConfig = useSavePlannerConfig()
  const prefs = usePlannerPrefs()
  const ready = useAiReady()
  const access = useProjectAccessMap()
  const update = useUpdateTask()
  const complete = useCompleteTask()
  const uncomplete = useUncompleteTask()
  const inboxId = config?.inbox_project_id ?? 0
  const now = new Date()
  const today = toLocalDate(now)
  const tomorrow = addLocalDays(today, 1)

  const [step, setStep] = useState(0)
  const [day, setDayRaw] = useState<LocalDate>(today)
  const [assistantOn, setAssistantOn] = useState(true)
  const [arrangeBy, setArrangeBy] = useState<'assistant' | 'first'>('assistant')
  const [picked, setPicked] = useState<ReadonlySet<number> | null>(null)
  const [keep, setKeep] = useState<ReadonlySet<number>>(new Set())
  const [pins, setPins] = useState<ReadonlyMap<number, MinuteRange>>(new Map())
  const [lengths, setLengths] = useState<ReadonlyMap<number, number>>(new Map())
  const [handled, setHandled] = useState<ReadonlyMap<number, { task: Task; label: string }>>(new Map())
  const [projectId, setProjectId] = useState<number | null>(null)
  const [remindersOn, setRemindersOn] = useState(false)
  const log = useRef(new Map<number, LogEntry>())

  const canChange = useCallback((task: Task) => (access.get(task.project_id)?.permission ?? 1) > 0, [access])

  // The tasks.
  const days = useMemo(() => [day], [day])
  const range = usePlanRange(days)
  const leftoverParams = useMemo<TaskQueryParams>(
    () => ({ filter: leftoversFilter(today), sort_by: 'due_date', order_by: 'asc', per_page: 1000, keep_nested_subtasks: true }),
    [today],
  )
  const leftoverQuery = useTasks(leftoverParams)
  const inbox = useProjectTasks(inboxId || undefined)
  const upcomingParams = useFilters({ view: 'upcoming' })
  const upcoming = useTasks(upcomingParams)
  const pickedProject = useProjectTasks(projectId ?? undefined)
  const routines = usePlanRoutines(days)
  // The day's events (contract 20.2): drawn on the timeline and busy time for the meter, the draft
  // and the free time the assistant gets. Never their titles.
  const busy = usePlanBusy(days)
  const eventBusy = useMemo(() => busy.eventBusyOn(day), [busy, day])

  // Pro (plan 7.7.3 and 7.7.4): estimates give a task its length and the focus block comes first.
  // Off, neither is read.
  const powerOn = usePro().layer('power')
  const { ledger } = useProLedger()
  const estimateFor = useCallback((id: number) => (powerOn ? estimateOf(ledger, id) : null), [powerOn, ledger])
  const focusBlock = useFocusBlock(canChange)

  const leftovers = useMemo(() => leftoversQueue(leftoverQuery.data.filter(canChange), now), [leftoverQuery.data, canChange, today])
  const onDay = useMemo(() => onDayTasks(range.tasks.filter(canChange), day, now), [range.tasks, canChange, day, today])
  const inboxTasks = useMemo(() => withoutTasks(inboxCandidates(inbox.data.filter(canChange), inboxId), onDay), [inbox.data, canChange, inboxId, onDay])
  const comingUp = useMemo(() => withoutTasks(comingUpTasks(upcoming.data.filter(canChange), day), onDay), [upcoming.data, canChange, day, onDay])
  const fromProject = useMemo(() => {
    if (projectId === null) return []
    const open = pickedProject.data.filter((task) => !task.done && canChange(task))
    return withoutTasks(withoutTasks(open, onDay), comingUp).slice(0, PROJECT_GROUP_MAX)
  }, [projectId, pickedProject.data, canChange, onDay, comingUp])

  const byId = useMemo(() => {
    const map = new Map<number, Task>()
    for (const list of [focusBlock?.tasks ?? [], fromProject, inboxTasks, comingUp, leftovers, onDay]) for (const task of list) map.set(task.id, task)
    return map
  }, [focusBlock, fromProject, inboxTasks, comingUp, leftovers, onDay])

  // The assistant.
  const assistantReady = ready.ask
  const assistantActive = assistantReady && assistantOn
  // Fresh, not only there: a copy saved earlier would give the model a free time that has changed.
  const dataReady = !range.isFetching && !leftoverQuery.isFetching && !upcoming.isFetching && !busy.isFetching
  const suggestions = usePlanSuggestions({
    enabled: assistantActive,
    dataReady,
    day,
    input: () => ({
      day,
      defaultLength: prefs.defaultLength,
      hours: prefs.hours,
      free: freeRanges(new Date(), day, prefs.hours, dayBusy(range.tasks, day, eventBusy)),
      routineMinutes: routines.map((routine) => routine.minute),
      leftovers,
      candidates: [...onDay, ...inboxTasks, ...comingUp],
      ...(powerOn ? { estimates: estimatesOf([...onDay, ...inboxTasks, ...comingUp, ...leftovers], ledger) } : {}),
    }),
  })
  const answer = suggestions.result
  const pickOf = useMemo(() => new Map((answer?.picks ?? []).map((pick) => [pick.task_id, pick])), [answer])
  const leftoverSuggestion = useMemo(() => new Map((answer?.leftovers ?? []).map((item) => [item.task_id, item])), [answer])

  // What is ticked. Until the person changes it, everything on the day.
  const ticked: ReadonlySet<number> = picked ?? new Set(onDay.map((task) => task.id))
  const chosen = useMemo(
    () => [...ticked].map((id) => byId.get(id)).filter((task): task is Task => task !== undefined && !task.done),
    [ticked, byId],
  )

  const lengthOf = useCallback(
    (id: number) => lengths.get(id) ?? pickOf.get(id)?.minutes ?? estimateFor(id) ?? prefs.defaultLength,
    [lengths, pickOf, estimateFor, prefs.defaultLength],
  )
  const lengthIsSuggested = useCallback((id: number) => !lengths.has(id) && typeof pickOf.get(id)?.minutes === 'number', [lengths, pickOf])

  const mergedLengths = useMemo(() => {
    const merged = new Map<number, number>()
    for (const task of chosen) merged.set(task.id, lengthOf(task.id))
    return merged
  }, [chosen, lengthOf])

  const choices = {
    now,
    day,
    hours: prefs.hours,
    defaultLength: prefs.defaultLength,
    lengths: mergedLengths,
    pins,
    keep,
    eventBusy,
  }
  const meter = planMeter(chosen, range.tasks, choices)

  const starts = useMemo(() => {
    if (!answer || arrangeBy !== 'assistant') return []
    return answer.picks.flatMap((pick) => (pick.start ? [[pick.task_id, clockMinutes(pick.start)] as const] : []))
  }, [answer, arrangeBy])
  const reasons = useMemo(() => new Map((answer?.picks ?? []).map((pick) => [pick.task_id, pick.reason])), [answer])
  const draft = draftBlocks(chosen, range.tasks, { ...choices, starts, reasons: assistantActive ? reasons : undefined })
  const draftOf = useMemo(() => new Map(draft.placed.map((block) => [block.id, block])), [draft.placed])
  const toPlaceAll = tasksToPlace(chosen, day)

  // Writes, each logged the first time so Undo all can put the task back.
  const logged = (task: Task): LogEntry => {
    const existing = log.current.get(task.id)
    if (existing) return existing
    const entry: LogEntry = { before: task, after: {}, completed: false }
    log.current.set(task.id, entry)
    return entry
  }
  const write = useCallback((task: Task, changes: BlockChanges) => {
    const taskChanges = toTaskChanges(changes)
    const entry = logged(task)
    entry.after = { ...entry.after, ...taskChanges }
    update.mutate({ id: task.id, changes: taskChanges, original: task })
  }, [update])

  const doLeftover = (task: Task, action: LeftoverAction) => {
    if (action === 'done') {
      logged(task).completed = true
      complete.mutate(task)
    } else {
      write(task, leftoverChanges(task, action, new Date()))
    }
    setHandled((prev) => new Map(prev).set(task.id, { task, label: HANDLED_LABEL[action] }))
  }

  /** Ticks the focus block's tasks (21.11). */
  const addFocusBlock = () => {
    if (!focusBlock) return
    setPicked(new Set([...ticked, ...focusBlock.tasks.map((task) => task.id)]))
  }

  const toggleTick = (id: number) => {
    const next = new Set(ticked)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setPicked(next)
  }

  const cycleLength = (id: number) => {
    const current = pins.get(id) ? (pins.get(id) as MinuteRange)[1] - (pins.get(id) as MinuteRange)[0] : lengthOf(id)
    const next = LENGTH_CYCLE[(LENGTH_CYCLE.indexOf(current) + 1) % LENGTH_CYCLE.length]
    setLengths((prev) => new Map(prev).set(id, next))
    const pin = pins.get(id)
    if (pin) setPins((prev) => new Map(prev).set(id, [pin[0], Math.min(24 * 60, pin[0] + next)]))
  }

  const toggleKeep = (id: number) => {
    setKeep((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setPins((prev) => {
      const next = new Map(prev)
      next.delete(id)
      return next
    })
  }

  const moveToNextDay = (task: Task) => {
    write(task, canWaitChanges(task, day))
    const next = new Set(ticked)
    next.delete(task.id)
    setPicked(next)
  }

  /** A change on the timeline: to a draft block it is the draft's, otherwise a write. */
  const timelineChange = (task: Task, changes: BlockChanges) => {
    if (step === 2 && draftOf.has(task.id)) {
      if (changes.start_date === null) {
        toggleKeep(task.id)
        return
      }
      const placed = draftOf.get(task.id)!
      const start = changes.start_date ? new Date(changes.start_date) : atClock(day, placed.start)
      const end = changes.end_date ? new Date(changes.end_date) : atClock(day, placed.end)
      const from = minutesOfDay(start)
      const to = toLocalDate(end) === day ? minutesOfDay(end) : 24 * 60
      setPins((prev) => new Map(prev).set(task.id, [from, to]))
      setLengths((prev) => new Map(prev).set(task.id, to - from))
      setKeep((prev) => {
        if (!prev.has(task.id)) return prev
        const next = new Set(prev)
        next.delete(task.id)
        return next
      })
      return
    }
    write(task, changes)
  }

  /** The tasks the timeline draws: the day's, with the draft's blocks laid over them. */
  const timelineTasks = useMemo(() => {
    if (step !== 2) return range.tasks
    const overlaid = range.tasks.map((task) => {
      const block = draftOf.get(task.id)
      return block
        ? { ...task, start_date: atClock(day, block.start).toISOString(), end_date: atClock(day, block.end).toISOString() }
        : task
    })
    const present = new Set(overlaid.map((task) => task.id))
    for (const block of draft.placed) {
      if (present.has(block.id)) continue
      const task = byId.get(block.id)
      if (task) overlaid.push({ ...task, start_date: atClock(day, block.start).toISOString(), end_date: atClock(day, block.end).toISOString() })
    }
    return overlaid
  }, [step, range.tasks, draftOf, draft.placed, byId, day])
  const dashedIds = useMemo(() => new Set(step === 2 ? draft.placed.map((block) => block.id) : []), [step, draft.placed])

  const accept = () => {
    for (const task of toPlaceAll) {
      const changes = acceptChanges(task, day, draftOf.get(task.id))
      if (changes) write(task, changes)
    }
    setStep(3)
  }

  const setDay = (next: LocalDate) => {
    setDayRaw(next)
    setPicked(null)
    setPins(new Map())
    setKeep(new Set())
  }

  const restart = () => {
    log.current = new Map()
    setPicked(null)
    setKeep(new Set())
    setPins(new Map())
    setLengths(new Map())
    setHandled(new Map())
    setRemindersOn(false)
    setStep(0)
  }

  const undoAll = () => {
    for (const { before, after, completed } of log.current.values()) {
      if (completed) uncomplete.mutate(before)
      if (Object.keys(after).length > 0) {
        update.mutate({
          id: before.id,
          changes: {
            ...(after.due_date !== undefined ? { due_date: before.due_date } : {}),
            ...(after.start_date !== undefined ? { start_date: before.start_date } : {}),
            ...(after.end_date !== undefined ? { end_date: before.end_date } : {}),
            ...(after.reminders !== undefined ? { reminders: before.reminders ?? [] } : {}),
          },
          original: { ...before, ...after },
        })
      }
    }
    restart()
  }

  /** Remind me when each block starts: written at once, and logged. */
  const setBlockReminders = (on: boolean) => {
    setRemindersOn(on)
    for (const task of range.tasks) {
      if (task.done || blockOf(task)?.day !== day || !canChange(task)) continue
      const current = (task.reminders ?? []) as NonNullable<BlockChanges['reminders']>
      const next = on
        ? withStartReminder(current).map((reminder) =>
            reminder.relative_to === 'start_date' && !reminder.reminder ? { ...reminder, reminder: task.start_date } : reminder,
          )
        : withoutStartReminder(current)
      if (next.length !== current.length) write(task, { reminders: next })
    }
  }

  const nudgeOn = typeof config?.planner_nudge === 'string'
  const setNudge = (on: boolean) => saveConfig({ planner_nudge: on ? (config?.planner_nudge ?? '21:30') : null })

  const leftoverRows = useMemo(() => {
    const rows = [...leftovers]
    const present = new Set(rows.map((task) => task.id))
    for (const [id, { task }] of handled) if (!present.has(id)) rows.push(task)
    return rows
  }, [leftovers, handled])

  return {
    step,
    setStep,
    day,
    setDay,
    today,
    tomorrow,
    assistantReady,
    assistantOn,
    setAssistantOn,
    assistantActive,
    arrangeBy,
    setArrangeBy,
    suggestions,
    leftovers,
    leftoverRows,
    handled,
    leftoverSuggestion,
    doLeftover,
    onDay,
    inboxTasks,
    comingUp,
    fromProject,
    projectId,
    setProjectId,
    ticked,
    toggleTick,
    focusBlock,
    addFocusBlock,
    chosen,
    meter,
    pickOf,
    lengthOf,
    lengthIsSuggested,
    cycleLength,
    canWait: answer?.can_wait ?? [],
    moveToNextDay,
    keep,
    toggleKeep,
    draft,
    draftOf,
    toPlaceAll,
    accept,
    undoAll,
    restart,
    remindersOn,
    setBlockReminders,
    nudgeOn,
    setNudge,
    nudgeTime: config?.planner_nudge ?? '21:30',
    range,
    routines,
    events: busy.events,
    planEvents: busy.planEvents,
    feeds: busy.feeds,
    eventColor: busy.eventColor,
    eventBusy,
    timelineTasks,
    timelineChange,
    dashedIds,
    reasons,
    prefs,
    canChange,
    byId,
  }
}

export type PlanSession = ReturnType<typeof usePlanSession>
