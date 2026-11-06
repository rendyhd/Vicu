import { useCallback, useEffect, useRef, useState } from 'react'
import { localDateTimeOf } from '../../shared/ai/dictation'
import type { PlanDayResult } from '../../shared/ai/plan-day'
import { checkPlanRequest, planRequestUser, type PlanRequestInput } from '@/lib/ai/plan-request'
import { announce } from '@/stores/announcer-store'
import { errorText } from '@/stores/dictation-store'
import { useAiWorkspace } from './use-ai'

export interface PlanSuggestions {
  result: PlanDayResult | null
  loading: boolean
  /** "No suggestions: …", once a request failed. */
  failure: string | null
  askAgain: () => void
}

let counter = 0

/**
 * One request per session (docs/ai-assistant-v1.md section 10.1): when the session opens with its
 * candidates known, again when its day changes or on "Ask again". Changing what is ticked lays the
 * draft out again with the answer in hand. A failure is said once and the session goes on. Nothing
 * is written here.
 */
export function usePlanSuggestions(options: {
  /** Ask is ready and the session's switch is on. */
  enabled: boolean
  /** The day's lists have been read from the server. */
  dataReady: boolean
  day: string
  /** Built when the request is sent, so it reads the day as it is then. */
  input: () => Omit<PlanRequestInput, 'reference'>
}): PlanSuggestions {
  const { enabled, dataReady, day } = options
  const ws = useAiWorkspace()
  // Each belongs to the day it was asked for and is not shown on another.
  const [answered, setAnswered] = useState<{ day: string; result: PlanDayResult } | null>(null)
  const [failed, setFailed] = useState<{ day: string; message: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const live = useRef({ ws, input: options.input })
  live.current = { ws, input: options.input }
  const inFlight = useRef<string | null>(null)
  const sentFor = useRef<string | null>(null)

  useEffect(() => {
    if (!enabled) return
    const key = `${day}:${attempt}`
    if (sentFor.current === key) return
    // What is on its way was for another day, or has been asked again.
    if (inFlight.current) void window.api.ai.cancelDictation(inFlight.current)
    inFlight.current = null
    setLoading(true)
    if (!dataReady) return
    sentFor.current = key
    const requestId = `plan-day-${Date.now()}-${++counter}`
    inFlight.current = requestId
    const input: PlanRequestInput = { ...live.current.input(), reference: localDateTimeOf(new Date()) }
    setAnswered(null)
    setFailed(null)
    void window.api.ai.planDay({ requestId, user: planRequestUser(live.current.ws, input) }).then((answer) => {
      if (inFlight.current !== requestId) return
      inFlight.current = null
      setLoading(false)
      if (!answer.success) {
        if (answer.error.kind === 'cancelled') return
        const message = `No suggestions: ${errorText(answer.error)}`
        setFailed({ day, message })
        announce(message)
        return
      }
      setAnswered({ day, result: checkPlanRequest(input, answer.data) })
    })
  }, [enabled, dataReady, day, attempt])

  // Turning the switch off, or leaving, stops what is on its way.
  useEffect(() => {
    if (enabled) return
    if (inFlight.current) void window.api.ai.cancelDictation(inFlight.current)
    inFlight.current = null
    setLoading(false)
  }, [enabled])
  useEffect(
    () => () => {
      if (inFlight.current) void window.api.ai.cancelDictation(inFlight.current)
      inFlight.current = null
    },
    [],
  )

  const askAgain = useCallback(() => setAttempt((value) => value + 1), [])
  return {
    result: enabled && answered?.day === day ? answered.result : null,
    loading,
    failure: enabled && failed?.day === day ? failed.message : null,
    askAgain,
  }
}
