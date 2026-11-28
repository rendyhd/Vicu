import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { usePro } from './use-pro'
import { SYNCED_PREFS_QUERY_KEY, writeSyncedPrefs } from './use-synced-prefs'
import type { SyncedPrefsSnapshot } from '../../shared/synced-prefs'
import { setRepeatRuleSource } from '@/lib/pro/repeat-completion'
import { readRepeatRule, repeatRuleKey } from '../../shared/pro/prefs'

/** Gives the completion path the repeat rules (21.13) while Pro's first layer is on. Mounted in AppShell. */
export function useRepeatRuleBridge(): void {
  const on = usePro().layer('availability')
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!on) {
      setRepeatRuleSource(null)
      return
    }
    setRepeatRuleSource({
      ruleFor: (taskId) => {
        const values = queryClient.getQueryData<SyncedPrefsSnapshot>(SYNCED_PREFS_QUERY_KEY)?.values ?? {}
        return readRepeatRule(values[repeatRuleKey(taskId)])
      },
      writeRule: (taskId, rule) => void writeSyncedPrefs(queryClient, { [repeatRuleKey(taskId)]: rule }),
    })
    return () => setRepeatRuleSource(null)
  }, [on, queryClient])
}
