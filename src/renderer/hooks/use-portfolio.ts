import { useCallback, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { currentLedger, newLedgerId, restoreRecords, setRecord, useProLedger, writeLedger } from './use-pro-ledger'
import { useProjects } from './use-projects'
import { toast } from '@/stores/toast-store'
import { toLocalDate } from '../../shared/due-dates'
import { recordValue, type InitiativeValue, type LedgerCollection, type LogValue } from '../../shared/pro/ledger'
import type { ProLedgerOperation } from '../../shared/pro/ledger-ipc'
import { capState, moveRank, parkedValue, rankedInitiatives, unparkedValue } from '../../shared/pro/portfolio'

/**
 * The portfolio (cross-app semantics 21.10): initiatives, their rank, the cap, parking and the log.
 * Every change is a ledger write with Undo; a rank change is logged as a decision.
 */
export function usePortfolio() {
  const queryClient = useQueryClient()
  const { ledger } = useProLedger()
  const { data: projects } = useProjects()
  const titleOf = useCallback((id: number) => projects?.all.find((project) => project.id === id)?.title ?? 'Initiative', [projects?.all])

  const write = useCallback(async (message: string, build: (ops: ProLedgerOperation[], touch: (collection: LedgerCollection, id: string | number, value: unknown) => void) => void) => {
    const before = currentLedger(queryClient)
    const touched: Array<{ collection: LedgerCollection; id: string }> = []
    const operations: ProLedgerOperation[] = []
    build(operations, (collection, id, value) => {
      touched.push({ collection, id: String(id) })
      operations.push(setRecord(collection, id, value))
    })
    if (!operations.length) return
    if (await writeLedger(queryClient, operations)) {
      toast.success(message, { action: { label: 'Undo', onAction: () => void writeLedger(queryClient, restoreRecords(before, touched)) } })
    }
  }, [queryClient])

  const log = (touch: (collection: LedgerCollection, id: string | number, value: unknown) => void, entry: Omit<LogValue, 'at'>) =>
    touch('log', newLedgerId(), { ...entry, at: toLocalDate(new Date()) })

  return useMemo(() => {
    const value = (projectId: number) => recordValue(currentLedger(queryClient).initiatives, projectId)
    return {
      ledger,
      ranked: rankedInitiatives(ledger),
      cap: capState(ledger),
      titleOf,
      initiative: (projectId: number) => recordValue(ledger.initiatives, projectId),
      /** Makes a project an initiative, last in rank; at the cap the caller parks one first. */
      start: (projectId: number) =>
        write(`${titleOf(projectId)} is an initiative`, (_ops, touch) => {
          const current = value(projectId)
          touch('initiatives', projectId, { ...(current ?? {}), status: 'active', rank: rankedInitiatives(currentLedger(queryClient)).length + 1 })
        }),
      update: (projectId: number, change: Partial<InitiativeValue>, message = 'Saved') =>
        write(message, (_ops, touch) => touch('initiatives', projectId, { ...(value(projectId) ?? { status: 'active' }), ...change })),
      move: (projectId: number, toIndex: number) =>
        write(`${titleOf(projectId)} moved to ${toIndex + 1}`, (_ops, touch) => {
          const ranks = moveRank(currentLedger(queryClient), projectId, toIndex)
          for (const [id, rank] of Object.entries(ranks)) {
            const current = value(Number(id))
            if (current && current.rank !== rank) touch('initiatives', id, { ...current, rank })
          }
          log(touch, { kind: 'decision', text: `${titleOf(projectId)} moved to rank ${toIndex + 1}`, initiative: projectId })
        }),
      park: (projectId: number, reason: string) =>
        write(`${titleOf(projectId)} parked`, (_ops, touch) => {
          const current = value(projectId)
          if (!current) return
          touch('initiatives', projectId, parkedValue(current, toLocalDate(new Date()), reason))
          log(touch, { kind: 'decision', text: `Parked ${titleOf(projectId)}${reason.trim() ? `: ${reason.trim()}` : ''}`, initiative: projectId })
        }),
      unpark: (projectId: number) =>
        write(`${titleOf(projectId)} is active again`, (_ops, touch) => {
          const current = value(projectId)
          if (current) touch('initiatives', projectId, unparkedValue(currentLedger(queryClient), current))
        }),
      close: (projectId: number) =>
        write(`${titleOf(projectId)} closed`, (_ops, touch) => {
          const current = value(projectId)
          if (!current) return
          const next: InitiativeValue = { ...current, status: 'closed', closed_on: toLocalDate(new Date()) }
          delete next.rank
          touch('initiatives', projectId, next)
        }),
      stop: (projectId: number) =>
        write(`${titleOf(projectId)} is no longer an initiative`, (_ops, touch) => touch('initiatives', projectId, null)),
      addLog: (entry: Omit<LogValue, 'at'>) => write(entry.kind === 'value' ? 'Value noted' : entry.kind === 'decision' ? 'Decision noted' : 'Noted', (_ops, touch) => log(touch, entry)),
      setRecordValue: (collection: LedgerCollection, id: string, next: unknown, message: string) => write(message, (_ops, touch) => touch(collection, id, next)),
    }
  }, [ledger, titleOf, write, queryClient])
}
