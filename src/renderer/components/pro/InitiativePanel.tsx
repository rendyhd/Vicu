import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/cn'
import { usePortfolio } from '@/hooks/use-portfolio'
import { usePersonLabels } from '@/hooks/use-people'
import { usePro } from '@/hooks/use-pro'
import { toLocalDate } from '../../../shared/due-dates'
import { READINESS_ITEMS, READINESS_LABELS, readiness, type ReadinessItem } from '../../../shared/pro/portfolio'
import { recordValue, type LogValue, type Readiness } from '../../../shared/pro/ledger'

const FIELD = 'w-full rounded-control border border-border bg-bg-page px-2 py-1 text-meta text-text'

/**
 * An initiative's header on its project page (plan 7.6.1): rank and status, sponsor and owner, the
 * nine readiness items and the log of decisions, values and open questions.
 */
export function InitiativePanel({ projectId }: { projectId: number }) {
  const pro = usePro()
  const portfolio = usePortfolio()
  const people = usePersonLabels()
  const [open, setOpen] = useState(false)
  const [entry, setEntry] = useState('')
  const [kind, setKind] = useState<'decision' | 'value' | 'unknown'>('decision')
  const value = portfolio.initiative(projectId)
  if (!pro.layer('portfolio') || !value) return null

  const ready = readiness(value)
  const rank = portfolio.ranked.find((item) => item.projectId === projectId)?.rank
  const setReady = (item: keyof Readiness, text: string) => void portfolio.update(projectId, { ready: { ...(value.ready ?? {}), [item]: text } })
  const logs = Object.entries(portfolio.ledger.log)
    .flatMap(([id, record]) => {
      const log = record.value as LogValue | null
      return log && log.initiative === projectId ? [{ id, log }] : []
    })
    .sort((a, b) => (a.log.at < b.log.at ? 1 : -1))
  const personSelect = (label: string, current: number | null | undefined, onChange: (id: number | null) => void) => (
    <label className="flex items-center gap-1.5 text-meta text-text-secondary">
      {label}
      <select value={current ?? ''} onChange={(event) => onChange(event.target.value ? Number(event.target.value) : null)} className="rounded-control border border-border bg-bg-page px-1.5 py-0.5 text-text">
        <option value="">Nobody yet</option>
        {[...people.values()].map((person) => <option key={person.id} value={person.id}>{person.title}</option>)}
      </select>
    </label>
  )

  return (
    <div className="mx-6 mb-3 rounded-card border border-border p-3" data-pro-initiative-panel>
      <div className="flex flex-wrap items-center gap-3">
        <span className="rounded-chip bg-accent-purple/12 px-2 py-0.5 text-chip font-semibold text-accent-purple">
          {value.status === 'parked' ? 'Parked' : value.status === 'closed' ? 'Closed' : `Initiative ${rank ?? ''}`}
        </span>
        {personSelect('Sponsor', value.sponsor, (id) => void portfolio.update(projectId, { sponsor: id }))}
        {personSelect('Owner', value.owner, (id) => void portfolio.update(projectId, { owner: id }))}
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className={cn('ml-auto inline-flex items-center gap-1 text-meta', ready.ready ? 'text-text-secondary' : 'text-status-overdue')}>
          <ChevronRight className={cn('h-3 w-3 transition-transform duration-fade-fast', open && 'rotate-90')} aria-hidden />
          Ready {ready.done}/{ready.total}
        </button>
      </div>
      {value.status === 'parked' && value.parked?.reason && <p className="mt-2 text-meta text-text-secondary">Parked: {value.parked.reason}</p>}
      {open && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2" data-pro-readiness>
          {READINESS_ITEMS.filter((item): item is Exclude<ReadinessItem, 'sponsor' | 'owner' | 'capacity'> => item !== 'sponsor' && item !== 'owner' && item !== 'capacity').map((item) => (
            <label key={item} className="block text-meta text-text-secondary">
              {READINESS_LABELS[item]}
              <input defaultValue={(value.ready?.[item] as string | undefined) ?? ''} onBlur={(event) => event.target.value !== ((value.ready?.[item] as string | undefined) ?? '') && setReady(item, event.target.value)} className={FIELD} />
            </label>
          ))}
          <div className="text-meta text-text-secondary">
            {READINESS_LABELS.capacity}
            {value.ready?.capacity ? (
              <p className="py-1 text-text">Agreed {value.ready.capacity.on}{value.ready.capacity.by ? ` with ${people.get(value.ready.capacity.by)?.title ?? 'someone'}` : ''}</p>
            ) : (
              <button type="button" className="block py-1 text-accent-blue hover:underline" onClick={() => void portfolio.update(projectId, { ready: { ...(value.ready ?? {}), capacity: { by: value.sponsor ?? null, on: toLocalDate(new Date()) } } })}>
                Mark agreed today
              </button>
            )}
          </div>
        </div>
      )}
      <div className="mt-3 border-t border-border pt-2">
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (!entry.trim()) return
            void portfolio.addLog({ kind, text: entry.trim(), initiative: projectId })
            setEntry('')
          }}
        >
          <select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)} aria-label="Kind" className="rounded-control border border-border bg-bg-page px-1.5 py-1 text-meta text-text">
            <option value="decision">Decision</option>
            <option value="value">Value</option>
            <option value="unknown">Open question</option>
          </select>
          <input value={entry} onChange={(event) => setEntry(event.target.value)} placeholder="Note a decision, a result or a question" aria-label="Log entry" className={FIELD} />
        </form>
        {logs.length > 0 && (
          <ul className="mt-2 max-h-40 space-y-0.5 overflow-y-auto text-meta" data-pro-log>
            {logs.map(({ id, log }) => (
              <li key={id} className="flex gap-2 text-text">
                <span className="w-20 shrink-0 text-text-secondary">{log.at}</span>
                <span className="shrink-0 text-text-secondary">{log.kind === 'decision' ? 'Decided' : log.kind === 'value' ? 'Value' : 'Open'}</span>
                <span className={cn('min-w-0', log.resolved && 'line-through text-text-secondary')}>{log.text}</span>
                {log.kind === 'unknown' && !log.resolved && (
                  <button type="button" className="ml-auto shrink-0 text-accent-blue hover:underline" onClick={() => void portfolio.setRecordValue('log', id, { ...recordValue(portfolio.ledger.log, id), resolved: toLocalDate(new Date()) }, 'Answered')}>
                    Answered
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
