import { useEffect } from 'react'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { toast } from '@/stores/toast-store'
import { emptyLedger, recordValue, type LedgerCollection, type ProLedger } from '../../shared/pro/ledger'
import type { ProLedgerOperation, ProLedgerSnapshot } from '../../shared/pro/ledger-ipc'
import { usePro } from './use-pro'

/**
 * The Pro ledger (cross-app semantics 21.7) as the main process keeps it. Read only while Pro is on.
 * Changes go to main as operations, which applies them to its current copy and syncs.
 */
export const PRO_LEDGER_QUERY_KEY = ['pro-ledger'] as const

const EMPTY: ProLedgerSnapshot = { ledger: emptyLedger(), deviceId: '', nearlyFull: false }

export function useProLedger(): ProLedgerSnapshot {
  const { on } = usePro()
  const query = useQuery({
    queryKey: PRO_LEDGER_QUERY_KEY,
    queryFn: () => api.getProLedger(),
    staleTime: Infinity,
    enabled: on,
  })
  return on ? (query.data ?? EMPTY) : EMPTY
}

/** Follows ledger changes from main (a sync, another window). Mounted once, in AppShell. */
export function useProLedgerEvents(): void {
  const queryClient = useQueryClient()
  useEffect(() => api.onProLedgerChanged((snapshot) => {
    queryClient.setQueryData(PRO_LEDGER_QUERY_KEY, snapshot)
  }), [queryClient])
}

/**
 * Sends ledger changes. Not tied to a component, so a menu that closes before the answer still gets
 * its change applied. False (and an error toast) when main refused it.
 */
export async function writeLedger(queryClient: QueryClient, operations: ProLedgerOperation[]): Promise<boolean> {
  if (operations.length === 0) return true
  try {
    queryClient.setQueryData(PRO_LEDGER_QUERY_KEY, await api.mutateProLedger(operations))
    return true
  } catch (error) {
    const reason = error instanceof Error ? error.message : ''
    toast.error(reason ? `Could not save the change: ${reason}` : 'Could not save the change')
    return false
  }
}

/** One record's operation; `null` deletes it. */
export const setRecord = (collection: LedgerCollection, id: string | number, value: unknown): ProLedgerOperation =>
  ({ op: 'set', collection, id: String(id), value })

/**
 * The operations that put records back as they are in `before` (an Undo): a record that did not
 * exist becomes a tombstone.
 */
export function restoreRecords(before: ProLedger, records: ReadonlyArray<{ collection: LedgerCollection; id: string | number }>): ProLedgerOperation[] {
  return records.map(({ collection, id }) => setRecord(collection, id, recordValue(before[collection] as Record<string, never>, id)))
}

/** A short random id for log, owed, escalation, meeting and round records. */
export function newLedgerId(): string {
  const bytes = new Uint8Array(6)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 10)
}

/** The ledger as the cache holds it now (for a mutation that runs outside React). */
export function currentLedger(queryClient: QueryClient): ProLedger {
  return queryClient.getQueryData<ProLedgerSnapshot>(PRO_LEDGER_QUERY_KEY)?.ledger ?? emptyLedger()
}
