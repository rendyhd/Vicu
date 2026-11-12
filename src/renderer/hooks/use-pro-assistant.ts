import { useMemo } from 'react'
import { useAppConfig } from './use-app-config'
import { useProLedger } from './use-pro-ledger'
import { usePersonLabels } from './use-people'
import type { ProToolData } from '@/lib/ai/pro-tools'
import { isProAssistantOn } from '../../shared/pro/settings'
import { recordValue } from '../../shared/pro/ledger'

/** Pro's assistant switch on this device (docs/ai-assistant-v1.md section 11): off by default. */
export function useProAssistantOn(): boolean {
  const { data: config } = useAppConfig()
  return isProAssistantOn(config ?? null)
}

/**
 * What Ask's Pro tools read (11.3): the ledger and the people with their aliases. Null while the
 * switch is off, so no ledger data reaches a request.
 */
export function useProToolData(): ProToolData | null {
  const on = useProAssistantOn()
  const { ledger } = useProLedger()
  const people = usePersonLabels()
  return useMemo(() => {
    if (!on) return null
    return {
      ledger,
      people: [...people.values()].map((label) => ({ id: label.id, title: label.title, aliases: recordValue(ledger.people, label.id)?.aliases ?? [] })),
    }
  }, [on, ledger, people])
}
