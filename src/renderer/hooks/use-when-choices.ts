import { useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useSyncedPrefs, writeSyncedPrefs } from './use-synced-prefs'
import {
  MAX_DAYS,
  MAX_MOVE_BY,
  WHEN_DAYS_KEY,
  WHEN_MOVE_BY_KEY,
  WHEN_TIMES_KEY,
  isValidTimes,
  readWhenChoices,
  setTimesOfDay,
  writeDays,
  writeMoveBy,
  writeTimes,
  type DayChoiceId,
  type MoveStepId,
  type TimeOfDay,
  type WhenChoiceSet,
} from '../../shared/when-choices'

/**
 * The account's When choices (cross-app semantics section 22), from the synced preferences, with
 * their setters (choosing a default writes `null`, so the reset reaches every device).
 *
 * It also hands the times of day to the quick-add parser (`setTimesOfDay`), which reads text
 * outside a component. `AppShell` calls this once for the whole window.
 */
export function useWhenChoices(): WhenChoiceSet & {
  setTimes: (times: readonly TimeOfDay[]) => Promise<boolean>
  setDays: (days: readonly DayChoiceId[]) => Promise<boolean>
  setMoveBy: (steps: readonly MoveStepId[]) => Promise<boolean>
  reset: () => Promise<boolean>
} {
  const { snapshot } = useSyncedPrefs()
  const queryClient = useQueryClient()
  const values = snapshot.values
  const choices = useMemo(
    () => readWhenChoices(values),
    [values[WHEN_TIMES_KEY], values[WHEN_DAYS_KEY], values[WHEN_MOVE_BY_KEY]],
  )
  setTimesOfDay(choices.times)
  return {
    ...choices,
    setTimes: async (times) =>
      isValidTimes(times) ? writeSyncedPrefs(queryClient, { [WHEN_TIMES_KEY]: writeTimes(times) }) : false,
    setDays: async (days) =>
      days.length <= MAX_DAYS && new Set(days).size === days.length
        ? writeSyncedPrefs(queryClient, { [WHEN_DAYS_KEY]: writeDays(days) })
        : false,
    setMoveBy: async (steps) =>
      steps.length <= MAX_MOVE_BY && new Set(steps).size === steps.length
        ? writeSyncedPrefs(queryClient, { [WHEN_MOVE_BY_KEY]: writeMoveBy(steps) })
        : false,
    reset: () => writeSyncedPrefs(queryClient, { [WHEN_TIMES_KEY]: null, [WHEN_DAYS_KEY]: null, [WHEN_MOVE_BY_KEY]: null }),
  }
}
