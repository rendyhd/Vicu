import { useMemo } from 'react'
import { useLabels } from './use-labels'
import { useProPrefs } from './use-pro-prefs'
import { useProLedger } from './use-pro-ledger'
import { usePro } from './use-pro'
import type { Label } from '@/lib/vikunja-types'
import { recordValue } from '../../shared/pro/ledger'
import type { Person } from '../../shared/pro/people'

const NONE: Person[] = []

/**
 * Pro's people (cross-app semantics 21.5): labels marked as a person, with the aliases the ledger
 * keeps. Empty while the promises layer is off.
 */
export function usePeople(): Person[] {
  const pro = usePro()
  const on = pro.layer('promises')
  const { data: labels } = useLabels()
  const { people: personIds } = useProPrefs()
  const { ledger } = useProLedger()
  return useMemo(() => {
    if (!on || !labels) return NONE
    return labels
      .filter((label) => personIds.has(label.id))
      .map((label) => ({ id: label.id, title: label.title, aliases: recordValue(ledger.people, label.id)?.aliases ?? [] }))
  }, [on, labels, personIds, ledger])
}

/** The person labels themselves, by id, for chips and names. */
export function usePersonLabels(): Map<number, Label> {
  const { data: labels } = useLabels()
  const { people } = useProPrefs()
  return useMemo(() => new Map((labels ?? []).filter((label) => people.has(label.id)).map((label) => [label.id, label])), [labels, people])
}
