import { useEffect, useState } from 'react'
import { cn } from '@/lib/cn'
import { usePromiseActions, VERDICT_LABELS, VERDICT_ORDER } from '@/hooks/use-promises'
import type { Task } from '@/lib/vikunja-types'
import { addLocalDays, toLocalDate } from '../../../shared/due-dates'
import type { VerdictKind } from '../../../shared/pro/ledger'

const BUTTON = 'rounded-control border border-border px-2 py-1 text-meta text-text hover:bg-bg-hover'

/**
 * The verdict buttons of a promise of theirs (design system 9): Delivered, Late, Not yet, New date,
 * Dropped, Ask me tomorrow, keys 1 to 6. Not yet and New date ask for a date (and Not yet a blocker)
 * inline. A done task asks "Delivered by Jan, or did you do it?" instead (decision 11).
 */
export function VerdictBar({ task, personName, canSnooze, pendingKey = null, onDone }: {
  task: Task
  personName: string
  canSnooze: boolean
  /** A digit pressed on the row before the bar opened: acted on once. */
  pendingKey?: string | null
  onDone: () => void
}) {
  const { verdict, snooze } = usePromiseActions()
  const [asking, setAsking] = useState<null | 'not_yet' | 'renegotiated'>(null)
  const tomorrow = addLocalDays(toLocalDate(new Date()), 1)
  const [newDue, setNewDue] = useState(tomorrow)
  const [blocker, setBlocker] = useState('')

  const give = (kind: VerdictKind) => {
    if (kind === 'not_yet' || kind === 'renegotiated') {
      setAsking(kind)
      return
    }
    verdict(task, kind)
    onDone()
  }

  useEffect(() => {
    if (!pendingKey || task.done) return
    const choice = verdictForKey(pendingKey)
    if (choice === 'snooze') {
      if (canSnooze) {
        snooze(task)
        onDone()
      }
    } else if (choice) give(choice)
    // Only the key the bar was opened with.
  }, [pendingKey])

  if (task.done) {
    return (
      <div className="flex flex-wrap items-center gap-1.5" data-pro-verdicts onClick={(event) => event.stopPropagation()}>
        <span className="mr-1 text-meta text-text-secondary">Delivered by {personName}, or did you do it?</span>
        <button type="button" className={BUTTON} onClick={() => { verdict(task, 'delivered'); onDone() }}>Delivered by {personName}</button>
        <button type="button" className={BUTTON} onClick={() => { verdict(task, 'taken_over'); onDone() }}>I did it</button>
      </div>
    )
  }

  if (asking) {
    return (
      <form
        className="flex flex-wrap items-center gap-1.5"
        data-pro-verdict-form
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault()
          verdict(task, asking, { newDue, blocker: asking === 'not_yet' ? blocker : null })
          onDone()
        }}
      >
        <span className="text-meta text-text-secondary">{asking === 'not_yet' ? 'Ask again on' : 'New date'}</span>
        <input type="date" value={newDue} min={toLocalDate(new Date())} onChange={(event) => setNewDue(event.target.value)} aria-label="Date" className="rounded-control border border-border bg-bg-page px-2 py-0.5 text-meta text-text" />
        {asking === 'not_yet' && (
          <input value={blocker} onChange={(event) => setBlocker(event.target.value)} placeholder="What is in the way?" aria-label="What is in the way" className="min-w-0 flex-1 rounded-control border border-border bg-bg-page px-2 py-0.5 text-meta text-text" autoFocus />
        )}
        <button type="submit" className={cn(BUTTON, 'border-accent-blue text-accent-blue')}>Save</button>
        <button type="button" className={BUTTON} onClick={() => setAsking(null)}>Back</button>
      </form>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5" data-pro-verdicts onClick={(event) => event.stopPropagation()}>
      {VERDICT_ORDER.map((kind, index) => (
        <button key={kind} type="button" className={BUTTON} data-pro-verdict={kind} onClick={() => give(kind)} aria-keyshortcuts={String(index + 1)}>
          <span className="mr-1 text-text-secondary">{index + 1}</span>
          {VERDICT_LABELS[kind]}
        </button>
      ))}
      {canSnooze && (
        <button type="button" className={BUTTON} data-pro-verdict="snooze" onClick={() => { snooze(task); onDone() }} aria-keyshortcuts="6">
          <span className="mr-1 text-text-secondary">6</span>
          Ask me tomorrow
        </button>
      )}
    </div>
  )
}

/** Keys 1 to 6 on a focused promise row. */
export function verdictForKey(key: string): VerdictKind | 'snooze' | null {
  const index = Number(key) - 1
  if (index >= 0 && index < VERDICT_ORDER.length) return VERDICT_ORDER[index]
  return key === '6' ? 'snooze' : null
}
