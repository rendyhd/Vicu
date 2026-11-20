import { useCallback, useMemo } from 'react'
import { usePro, useSaveProConfig } from './use-pro'
import { usePromiseWorld } from './use-promise-world'
import { ledgerInArea } from './use-groups'
import { useDayKey } from '@/stores/day-store'
import { dismissedUntilTomorrow } from '@/lib/pro/follow-up-actions'
import { toLocalDate } from '../../shared/due-dates'
import { followUps, pruneDismissed, type FollowUpLine } from '../../shared/pro/follow-ups'
import { readVerdictSnoozes } from '../../shared/pro/promises'

const NONE: FollowUpLine[] = []

/**
 * Follow-ups for today (cross-app semantics 21.18): what needs a move from you, as the shared rule
 * returns it. Empty while the promises layer is off.
 */
export function useFollowUps(): { lines: FollowUpLine[]; count: number; dismiss: (line: FollowUpLine) => void } {
  const { config } = usePro()
  const world = usePromiseWorld()
  const save = useSaveProConfig()
  const dayKey = useDayKey()
  const lines = useMemo(() => {
    if (!world.on) return NONE
    const today = toLocalDate(new Date())
    return followUps({
      tasks: world.open,
      ledger: ledgerInArea(world, world.open),
      today,
      snoozes: readVerdictSnoozes(config?.pro_verdict_snooze),
      dismissed: pruneDismissed(config?.pro_followup_dismissed, today),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world, config?.pro_verdict_snooze, config?.pro_followup_dismissed, dayKey])

  const dismiss = useCallback(
    (line: FollowUpLine) => {
      void save({ pro_followup_dismissed: dismissedUntilTomorrow(config?.pro_followup_dismissed, line.key, toLocalDate(new Date())) })
    },
    [save, config?.pro_followup_dismissed],
  )

  return { lines, count: lines.length, dismiss }
}
