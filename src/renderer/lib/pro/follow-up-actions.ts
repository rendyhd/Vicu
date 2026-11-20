import type { ProLedger } from '../../../shared/pro/ledger'
import { recordValue } from '../../../shared/pro/ledger'
import type { ProLedgerOperation } from '../../../shared/pro/ledger-ipc'
import { pruneDismissed } from '../../../shared/pro/follow-ups'
import { addLocalDays, type LocalDate } from '../../../shared/due-dates'
import { withChecked, withoutMark } from '../../../shared/pro/promises'

/** Operations that mark each of these promises as checked at `at`; a task without a promise is skipped. */
export function checkedOperations(ledger: ProLedger, taskIds: readonly number[], at: string): ProLedgerOperation[] {
  return taskIds.flatMap((id) => {
    const promise = recordValue(ledger.promises, id)
    return promise ? [{ op: 'set' as const, collection: 'promises' as const, id: String(id), value: withChecked(promise, at) }] : []
  })
}

/** The Undo of `checkedOperations`: exactly the mark made at `at` is taken off, on the records as they are now. */
export function uncheckedOperations(ledger: ProLedger, taskIds: readonly number[], at: string): ProLedgerOperation[] {
  return taskIds.flatMap((id) => {
    const promise = recordValue(ledger.promises, id)
    return promise ? [{ op: 'set' as const, collection: 'promises' as const, id: String(id), value: withoutMark(promise, 'checked', at) }] : []
  })
}

/** The dismissals with `key` hidden until tomorrow; entries whose day has come are dropped. */
export function dismissedUntilTomorrow(
  dismissed: Readonly<Record<string, string>> | null | undefined,
  key: string,
  today: LocalDate,
): Record<string, string> {
  return { ...pruneDismissed(dismissed, today), [key]: addLocalDays(today, 1) }
}
