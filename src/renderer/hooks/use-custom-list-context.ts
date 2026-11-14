import { useMemo } from 'react'
import { useCollabMe, useSharedProjectIds } from './use-project-access'
import { useAvailability } from './use-availability'
import { useProLedger } from './use-pro-ledger'
import { usePro } from './use-pro'
import { useSyncedPrefs } from './use-synced-prefs'
import type { CustomListContext } from '@/lib/custom-list-filter'
import { projectOnHold } from '../../shared/pro/prefs'
import { WEEK_START_KEY, readWeekStart } from '../../shared/week-start'

/**
 * What a custom list's conditions read besides the task: who you are and which projects are shared
 * (cross-app semantics 3.3), and Pro's data (3.8). Pro's conditions are read Pro on or off, with what
 * this device has: off, the ledger and availability are not loaded, so they count as none (O5).
 */
export function useCustomListContext(): CustomListContext {
  const me = useCollabMe()
  const sharedProjectIds = useSharedProjectIds()
  const availabilityState = useAvailability()
  const { ledger } = useProLedger()
  const proOn = usePro().on
  const { snapshot: prefsSnapshot } = useSyncedPrefs()
  return useMemo<CustomListContext>(
    () => ({
      me: me?.id ?? null,
      isShared: (projectId) => sharedProjectIds.has(projectId),
      pro: {
        availability: availabilityState.on
          ? { of: (task) => availabilityState.of(task) ?? { available: true, reasons: [], next: false, blockers: [] }, cycles: availabilityState.cycles as number[] }
          : null,
        ledger: proOn ? ledger : null,
        projectOnHold: (projectId) => projectOnHold(prefsSnapshot.values, projectId),
      },
      // Where "this week" ends and what `/w` rounds to (section 2.1). A change of the setting is a new
      // context, so every list that reads it is evaluated again.
      weekStart: readWeekStart(prefsSnapshot.values[WEEK_START_KEY]),
    }),
    [me, sharedProjectIds, availabilityState, ledger, proOn, prefsSnapshot.values],
  )
}
