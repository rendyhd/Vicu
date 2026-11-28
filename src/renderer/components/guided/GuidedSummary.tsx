import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, Undo2 } from 'lucide-react'
import { canUndoAll, undoPlan, type SessionLog } from '@/lib/guided/cards'
import { useUncompleteTask, useUpdateTask } from '@/hooks/use-task-mutations'
import { announce } from '@/stores/announcer-store'
import { toast } from '@/stores/toast-store'
import { Button } from '@/components/shared/Button'
import { GuidedCardShell } from './GuidedParts'

interface Props {
  /** The queue was empty when the session started. */
  empty: boolean
  emptyText: string
  log: SessionLog
  /** "Sorted 12: 5 scheduled, 4 moved, 2 completed, 1 deleted". */
  summary: string
  /** More lines under the summary (a review: projects reviewed and archived). */
  extra?: React.ReactNode
  /** Puts back what is not in the task log (a review's archives and review marks). */
  onUndoMore?: () => Promise<void>
  canUndoMore?: boolean
  doneLabel?: string
  onDone: () => void
}

/**
 * The end of a guided session (14.3): what it changed, Undo all (every change back except deletes)
 * and Done.
 */
export function GuidedSummary({ empty, emptyText, log, summary, extra, onUndoMore, canUndoMore = false, doneLabel, onDone }: Props) {
  const { t } = useTranslation()
  const updateTask = useUpdateTask()
  const reopen = useUncompleteTask()
  const [undone, setUndone] = useState(false)
  const [busy, setBusy] = useState(false)

  const undoAll = async () => {
    setBusy(true)
    let failed = 0
    for (const step of undoPlan(log)) {
      try {
        if (step.type === 'reopen') await reopen.mutateAsync(step.task)
        else await updateTask.mutateAsync({ id: step.id, changes: step.changes, original: step.original })
      } catch {
        failed++
      }
    }
    try {
      await onUndoMore?.()
    } catch {
      failed++
    }
    setBusy(false)
    setUndone(true)
    if (failed > 0) toast.error(t('guided.summary.failed', { count: failed }))
    else announce(t('guided.summary.allPutBack'))
  }

  return (
    <GuidedCardShell
      footer={
        <>
          {!empty && (canUndoAll(log) || canUndoMore) && (
            <Button onClick={() => void undoAll()} disabled={busy || undone}>
              <Undo2 aria-hidden="true" className="h-4 w-4" /> {undone ? t('guided.summary.putBack') : t('guided.summary.undoAll')}
            </Button>
          )}
          <span className="flex-1" />
          <Button variant="primary" onClick={onDone} autoFocus>{doneLabel ?? t('guided.done')}</Button>
        </>
      }
    >
      <div className="flex flex-col items-center gap-3 py-4 text-center">
        <CheckCircle2 aria-hidden="true" className="h-10 w-10 text-accent-green" strokeWidth={1.5} />
        <p className="text-card-title text-[var(--text-primary)]" role="status">{empty ? emptyText : undone ? t('guided.summary.putBackExceptDeletes') : summary}</p>
        {!empty && !undone && extra}
        {!empty && !undone && (canUndoAll(log) || canUndoMore) && (
          <p className="text-meta text-[var(--text-secondary)]">{t('guided.summary.undoAllHint')}</p>
        )}
      </div>
    </GuidedCardShell>
  )
}
