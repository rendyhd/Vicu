import { useCallback, useEffect, useRef, useState } from 'react'
import { AI_LIMITS } from '../../shared/ai/contract'
import { localDateTimeOf } from '../../shared/ai/dictation'
import { shouldPrefetch, type NextStep, type OrganizeSession, type Suggestion } from '../../shared/ai/organize'
import { checkOrganize, organizeRequestUser, type OrganizeRequestInput } from '@/lib/ai/organize-request'
import { announce } from '@/stores/announcer-store'
import { errorText } from '@/stores/dictation-store'
import type { Task } from '@/lib/vikunja-types'
import { useAiReady, useAiWorkspace } from './use-ai'
import { can } from '@/lib/capabilities'

// Suggestions in a guided session (docs/ai-assistant-v1.md section 9): with Ask set up, the queue
// is sent in batches of `organize_batch_max`, the first when the session starts and the next
// `organize_prefetch` cards before the end of the one in hand. A failure is said once and the
// session goes on without suggestions. Nothing is written here: the cards only show them.

export interface OrganizeSuggestions {
  /** Ask is ready, so suggestions are asked for. */
  active: boolean
  suggestion: (taskId: number) => Suggestion | undefined
  /** The task's batch is on its way. */
  pending: (taskId: number) => boolean
  /** A review page's next step (section 9.2), once its answer is in. */
  nextStep: NextStep | null
  /** "No suggestions: …", once a request failed. */
  failure: string | null
}

interface Options {
  session: OrganizeSession
  listName: string
  defaultProjectId: number
  /** The ids sent, in order: the session's queue, or a review page's tasks. */
  ids: readonly number[]
  /** The card on screen (a review page sends everything at once: 0). */
  index: number
  task: (id: number) => Task | undefined
  /** Changes when a new queue starts (a review page per project), dropping what came before. */
  resetKey: string
}

let counter = 0

export function useOrganizeSuggestions({ session, listName, defaultProjectId, ids, index, task, resetKey }: Options): OrganizeSuggestions {
  const ready = useAiReady()
  const ws = useAiWorkspace()
  const [byTask, setByTask] = useState<ReadonlyMap<number, Suggestion>>(new Map())
  const [loading, setLoading] = useState<ReadonlySet<number>>(new Set())
  const [nextStep, setNextStep] = useState<NextStep | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const requested = useRef(new Set<number>())
  const inFlight = useRef(new Set<string>())
  const live = useRef({ ws, session, listName, defaultProjectId, ids, task, resetKey })
  live.current = { ws, session, listName, defaultProjectId, ids, task, resetKey }

  // A new queue: forget the old answers and stop the requests still running.
  useEffect(() => {
    requested.current = new Set()
    setByTask(new Map())
    setLoading(new Set())
    setNextStep(null)
    return () => {
      if (can('assistant')) for (const id of inFlight.current) void window.api.ai.cancelDictation(id)
      inFlight.current.clear()
    }
  }, [resetKey])

  const size = AI_LIMITS.organize_batch_max

  const ask = useCallback(async (batch: number) => {
    if (!can('assistant')) return
    const { ws, session, listName, defaultProjectId, ids, task, resetKey: key } = live.current
    const batchIds = ids.slice(batch * size, (batch + 1) * size)
    const tasks = batchIds.map(task).filter((t): t is Task => t !== undefined)
    if (tasks.length === 0) return
    const requestId = `organize-${Date.now()}-${++counter}`
    const input: OrganizeRequestInput = { session, listName, defaultProjectId, tasks, reference: localDateTimeOf(new Date()) }
    inFlight.current.add(requestId)
    setLoading((prev) => new Set(prev).add(batch))
    const result = await window.api.ai.organize({ requestId, user: organizeRequestUser(ws, input) })
    inFlight.current.delete(requestId)
    if (live.current.resetKey !== key) return
    setLoading((prev) => {
      const next = new Set(prev)
      next.delete(batch)
      return next
    })
    if (!result.success) {
      if (result.error.kind === 'cancelled') return
      const message = `No suggestions: ${errorText(result.error)}`
      setFailure((prev) => prev ?? message)
      announce(message)
      return
    }
    const checked = checkOrganize(live.current.ws, input, result.data, navigator.language)
    setByTask((prev) => {
      const next = new Map(prev)
      for (const suggestion of checked.suggestions) next.set(suggestion.task_id, suggestion)
      return next
    })
    if (checked.next_step) setNextStep(checked.next_step)
  }, [size])

  useEffect(() => {
    if (!can('assistant') || !ready.ask || failure !== null || ids.length === 0) return
    const ensure = (batch: number) => {
      if (batch * size >= ids.length || requested.current.has(batch)) return
      requested.current.add(batch)
      void ask(batch)
    }
    const batch = Math.floor(Math.max(0, index) / size)
    ensure(batch)
    if (shouldPrefetch(index, Math.min((batch + 1) * size, ids.length))) ensure(batch + 1)
  }, [ready.ask, failure, ids, index, size, ask, resetKey])

  const pending = useCallback((taskId: number) => {
    const at = ids.indexOf(taskId)
    return at >= 0 && loading.has(Math.floor(at / size))
  }, [ids, loading, size])

  return {
    active: ready.ask,
    suggestion: (taskId) => byTask.get(taskId),
    pending,
    nextStep,
    failure,
  }
}
