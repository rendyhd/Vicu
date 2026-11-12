/**
 * What crosses IPC for the Pro ledger (src/main/pro-ledger-service.ts): the snapshot the windows get
 * and the operations they send. Type-only.
 */
import type { LedgerCollection, ProLedger } from './ledger'

export interface ProLedgerSnapshot {
  ledger: ProLedger
  deviceId: string
  /** The JSON passed 70 percent of the write cap (cross-app semantics 21.7). */
  nearlyFull: boolean
}

/** A change a window asks for; main applies it to its current copy, so two windows never race. */
export type ProLedgerOperation =
  | { op: 'set'; collection: LedgerCollection; id: string; value: unknown }
  | { op: 'settings'; value: Record<string, unknown> }
  | { op: 'estimate'; taskId: number; minutes: number | null }
  | { op: 'remap'; from: number; to: number }
