import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Dialog } from '@/components/overlay/Dialog'
import { Checkbox } from '@/components/shared/Checkbox'
import { usePromiseWorld } from '@/hooks/use-promise-world'
import { useTasks } from '@/hooks/use-tasks'
import { useDateFormat } from '@/hooks/use-date-format'
import { currentLedger, setRecord, writeLedger } from '@/hooks/use-pro-ledger'
import { api } from '@/lib/api'
import { toast } from '@/stores/toast-store'
import type { Task } from '@/lib/vikunja-types'
import { addLocalDays, startOfLocalDay, toLocalDate, type LocalDate } from '../../../shared/due-dates'
import { buildRecap, recapItems } from '../../../shared/pro/recap'
import { promiseOf, withSent } from '../../../shared/pro/promises'

export interface RecapDialogProps {
  onClose: () => void
  /** A person to start with; otherwise every person. */
  personId?: number
  /** A meeting round's recap: its day, people and what was not discussed. */
  round?: { title: string; day: LocalDate; people: number[]; notDiscussed: string[]; absent: string[] }
}

/**
 * The recap (decision 7, plan 7.3.7): what was delivered, agreed, changed and is still open, for some
 * people over some days. Copy puts rich and plain text on the clipboard and marks the promises sent.
 */
export function RecapDialog({ onClose, personId, round }: RecapDialogProps) {
  const queryClient = useQueryClient()
  const world = usePromiseWorld()
  const fmt = useDateFormat()
  const today = toLocalDate(new Date())
  const [from, setFrom] = useState<LocalDate>(round?.day ?? addLocalDays(today, -6))
  const [to, setTo] = useState<LocalDate>(round?.day ?? today)
  const allPeople = [...world.people.keys()]
  const [people, setPeople] = useState<number[]>(round?.people ?? (personId !== undefined ? [personId] : allPeople))
  const [includeMine, setIncludeMine] = useState(true)
  const [includeQuotes, setIncludeQuotes] = useState(true)

  // Promises delivered in the range are done tasks: read the ones completed since its first day.
  const doneParams = useMemo(
    () => ({ filter: `done = true && done_at >= '${startOfLocalDay(from).toISOString()}'`, keep_nested_subtasks: true }),
    [from],
  )
  const { data: done = [] } = useTasks(doneParams, world.on)

  const recap = useMemo(() => {
    const tasks: Task[] = [...world.open, ...done].filter((task) => world.promiseFor(task) !== null)
    const items = recapItems({ from, to, people, includeMine }, tasks, world.ledger)
    const title = round?.title ?? (people.length === 1 ? `Recap for ${world.nameOf(people[0])}` : 'Recap')
    return buildRecap({
      title,
      date: to,
      items,
      personName: world.nameOf,
      notDiscussed: round?.notDiscussed,
      absent: round?.absent,
      includeQuotes,
      now: new Date(),
      fmt,
    })
  }, [world, done, from, to, people, includeMine, includeQuotes, round, fmt])

  const copy = async () => {
    await api.writeClipboardRich(recap.text, recap.html)
    const at = new Date().toISOString()
    const ledger = currentLedger(queryClient)
    const operations = recap.taskIds.flatMap((id) => {
      const promise = promiseOf(ledger, id)
      return promise ? [setRecord('promises', id, withSent(promise, at))] : []
    })
    if (operations.length) await writeLedger(queryClient, operations)
    toast.success(recap.taskIds.length ? `Recap copied; ${recap.taskIds.length} marked as sent` : 'Recap copied')
    onClose()
  }

  return (
    <Dialog open label="Recap" onClose={onClose} className="w-[640px] max-w-[92vw] p-5">
      <h2 className="mb-3 text-card-title text-text">Recap</h2>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-meta text-text">
        <label className="flex items-center gap-1">From <input type="date" value={from} max={to} onChange={(event) => event.target.value && setFrom(event.target.value)} className="rounded-control border border-border bg-bg-page px-2 py-1" /></label>
        <label className="flex items-center gap-1">to <input type="date" value={to} min={from} onChange={(event) => event.target.value && setTo(event.target.value)} className="rounded-control border border-border bg-bg-page px-2 py-1" /></label>
        <label className="flex cursor-pointer items-center gap-1.5"><Checkbox checked={includeMine} onChange={(event) => setIncludeMine(event.target.checked)} /> What I owe</label>
        <label className="flex cursor-pointer items-center gap-1.5"><Checkbox checked={includeQuotes} onChange={(event) => setIncludeQuotes(event.target.checked)} /> Their words</label>
      </div>
      {!round && allPeople.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-1" role="group" aria-label="People">
          {allPeople.map((id) => {
            const on = people.includes(id)
            return (
              <button
                key={id}
                type="button"
                aria-pressed={on}
                onClick={() => setPeople((list) => (on ? list.filter((entry) => entry !== id) : [...list, id]))}
                className={on ? 'rounded-chip border border-accent-blue bg-accent-blue/12 px-2 py-0.5 text-meta text-accent-blue' : 'rounded-chip border border-border px-2 py-0.5 text-meta text-text-secondary hover:bg-bg-hover'}
              >
                {world.nameOf(id)}
              </button>
            )
          })}
        </div>
      )}
      <pre className="max-h-[50vh] overflow-y-auto whitespace-pre-wrap rounded-card border border-border bg-bg-hover p-3 font-sans text-meta text-text" data-pro-recap-preview>
        {recap.text}
      </pre>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className="rounded-control px-3 py-1.5 text-meta text-text hover:bg-bg-hover" onClick={onClose}>Cancel</button>
        <button type="button" className="rounded-control bg-accent-fill px-3 py-1.5 text-meta font-medium text-on-accent" onClick={() => void copy()} data-pro-recap-copy>
          Copy
        </button>
      </div>
    </Dialog>
  )
}
