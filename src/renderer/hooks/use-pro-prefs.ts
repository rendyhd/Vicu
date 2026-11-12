import { useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useSyncedPrefs, writeSyncedPrefs } from './use-synced-prefs'
import {
  labelKindKey,
  labelStatusKey,
  onHoldLabelIds,
  personLabelIds,
  projectMode,
  projectModeKey,
  projectOnHold,
  projectStatusKey,
  readRepeatRule,
  repeatRuleKey,
  type ProjectMode,
  type RepeatRule,
} from '../../shared/pro/prefs'
import { PRO_AREA_KEY, readProArea } from '../../shared/pro/settings'

/**
 * Pro's synced keys (cross-app semantics 11.3 and 21): project types and statuses, label statuses
 * and kinds, repeat rules and the area, read from the synced preferences and written with
 * `writeSyncedPrefs` (one change, one sync).
 */
export function useProPrefs() {
  const { snapshot } = useSyncedPrefs()
  const queryClient = useQueryClient()
  const values = snapshot.values
  return useMemo(() => {
    const people = personLabelIds(values)
    const heldLabels = onHoldLabelIds(values)
    return {
      values,
      area: readProArea(values[PRO_AREA_KEY]),
      people,
      heldLabels,
      isPerson: (labelId: number) => people.has(labelId),
      labelOnHold: (labelId: number) => heldLabels.has(labelId),
      projectMode: (projectId: number): ProjectMode => projectMode(values, projectId),
      projectOnHold: (projectId: number) => projectOnHold(values, projectId),
      repeatRule: (taskId: number): RepeatRule | null => readRepeatRule(values[repeatRuleKey(taskId)]),
      setProjectMode: (projectId: number, mode: ProjectMode) =>
        writeSyncedPrefs(queryClient, { [projectModeKey(projectId)]: mode === 'parallel' ? null : mode }),
      setProjectOnHold: (projectId: number, held: boolean) =>
        writeSyncedPrefs(queryClient, { [projectStatusKey(projectId)]: held ? 'on_hold' : null }),
      setLabelOnHold: (labelId: number, held: boolean) =>
        writeSyncedPrefs(queryClient, { [labelStatusKey(labelId)]: held ? 'on_hold' : null }),
      setPerson: (labelId: number, person: boolean) =>
        writeSyncedPrefs(queryClient, { [labelKindKey(labelId)]: person ? 'person' : null }),
      setRepeatRule: (taskId: number, rule: RepeatRule | null) =>
        writeSyncedPrefs(queryClient, { [repeatRuleKey(taskId)]: rule }),
      setArea: (categoryIds: string[]) =>
        writeSyncedPrefs(queryClient, { [PRO_AREA_KEY]: categoryIds.length ? categoryIds : null }),
    }
  }, [values, queryClient])
}
