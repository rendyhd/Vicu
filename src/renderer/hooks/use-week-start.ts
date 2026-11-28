import { useSyncedPrefs } from './use-synced-prefs'
import { WEEK_START_KEY, readWeekStart, setWeekStart, type WeekStart } from '../../shared/week-start'

/**
 * The account's week start (cross-app semantics 2.1), from the synced preferences.
 *
 * It also hands the value to the week helpers of `shared/due-dates.ts`, which use it when no week
 * start is passed, so a rule called outside a component (a shortcut, the parser) counts the same
 * week. `AppShell` calls this once for the whole window. A component that keeps a week in a memo
 * (a month grid, a week view, a routine's weekly counts) calls it too and lists the value as a
 * dependency, so the memo is redone when the setting changes.
 */
export function useWeekStart(): WeekStart {
  const { snapshot } = useSyncedPrefs()
  const weekStart = readWeekStart(snapshot.values[WEEK_START_KEY])
  setWeekStart(weekStart)
  return weekStart
}
