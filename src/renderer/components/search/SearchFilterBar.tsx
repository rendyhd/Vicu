import { useRef, useState } from 'react'
import { ChevronDown, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useLabels } from '@/hooks/use-labels'
import { useDateFormat } from '@/hooks/use-date-format'
import { formatDateChip } from '@/lib/date-utils'
import { startOfLocalDay } from '@/lib/due-dates'
import { Popover } from '../overlay/Popover'
import type { SearchDate, SearchFilters, SearchStatus } from '../../../shared/search-filters'

const DATE_CHOICES: Array<[SearchDate, string]> = [
  ['all', 'Any'],
  ['overdue', 'Overdue'],
  ['today', 'Today'],
  ['this_week', 'This week'],
  ['this_month', 'This month'],
  ['no_due_date', 'No date'],
]
const STATUS_CHOICES: Array<[SearchStatus, string]> = [['all', 'All'], ['open', 'Open'], ['done', 'Completed']]
const PRIORITY_CHOICES: Array<[number, string]> = [[1, 'Low'], [2, 'Medium'], [3, 'High'], [4, 'Urgent'], [5, 'Do now']]

interface FilterButtonProps {
  name: string
  value: string | null
  onClear: () => void
  /** The popover's content. */
  children: (close: () => void) => React.ReactNode
}

/** One filter: its name until it is set, then its value and an X. */
function FilterButton({ name, value, onClear, children }: FilterButtonProps) {
  const anchor = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  return (
    <div
      className={cn(
        'flex h-7 items-center rounded-control border text-caption transition-colors duration-fade-fast',
        value ? 'border-accent-blue/40 bg-accent-blue/10 text-[var(--text-primary)]' : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]',
      )}
    >
      <button
        ref={anchor}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-full items-center gap-1 rounded-control px-2"
      >
        {value ?? name}
        {!value && <ChevronDown className="h-3 w-3" aria-hidden="true" />}
      </button>
      {value && (
        <button type="button" aria-label={`Clear ${name} filter`} onClick={onClear} className="flex h-full items-center rounded-control pr-1.5 hover:text-[var(--text-primary)]">
          <X className="h-3 w-3" aria-hidden="true" />
        </button>
      )}
      {open && (
        <Popover anchorRef={anchor} label={name} onClose={() => setOpen(false)} className="w-52 p-1">
          {children(() => setOpen(false))}
        </Popover>
      )}
    </div>
  )
}

const ROW = 'flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left text-sm text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'

/** Date, Status, Labels and Priority under the search page's header (contract section 17). */
export function SearchFilterBar({ filters, onChange }: { filters: SearchFilters; onChange: (filters: SearchFilters) => void }) {
  const { data: labels = [] } = useLabels()
  const fmt = useDateFormat()
  const day = (date: string) => formatDateChip(startOfLocalDay(date), true, new Date(), fmt)
  const [from, setFrom] = useState(filters.from ?? '')
  const [to, setTo] = useState(filters.to ?? '')

  const dateText = (() => {
    if (filters.date === 'range' && filters.from && filters.to) {
      const [first, last] = filters.from <= filters.to ? [filters.from, filters.to] : [filters.to, filters.from]
      return first === last ? day(first) : `${day(first)} to ${day(last)}`
    }
    return DATE_CHOICES.find(([value]) => value === filters.date && value !== 'all')?.[1] ?? null
  })()
  const statusText = STATUS_CHOICES.find(([value]) => value === filters.status && value !== 'all')?.[1] ?? null
  const labelIds = filters.label_ids ?? []
  const priorities = filters.priorities ?? []
  const labelsText = labelIds.length === 0 ? null : labelIds.length === 1 ? labels.find((l) => l.id === labelIds[0])?.title ?? '1 label' : `${labelIds.length} labels`
  const priorityText = priorities.length === 0 ? null : priorities.length === 1 ? PRIORITY_CHOICES.find(([value]) => value === priorities[0])?.[1] ?? null : `${priorities.length} priorities`
  const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item])

  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Search filters">
      <FilterButton name="Date" value={dateText} onClear={() => { setFrom(''); setTo(''); onChange({ ...filters, date: 'all', from: undefined, to: undefined }) }}>
        {(close) => (
          <>
            {DATE_CHOICES.map(([value, label]) => (
              <button key={value} type="button" role="menuitemradio" aria-checked={(filters.date ?? 'all') === value} className={ROW} onClick={() => { onChange({ ...filters, date: value, from: undefined, to: undefined }); close() }}>
                {label}
              </button>
            ))}
            <div className="mt-1 border-t border-[var(--border-color)] px-2 pb-1 pt-2">
              <p className="mb-1 text-caption text-[var(--text-secondary)]">Pick dates</p>
              <label className="mb-1 flex items-center justify-between gap-2 text-caption text-[var(--text-secondary)]">
                From
                <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); if (e.target.value && to) onChange({ ...filters, date: 'range', from: e.target.value, to }) }} className="rounded-control border border-[var(--border-color)] bg-transparent px-1 text-[var(--text-primary)]" />
              </label>
              <label className="flex items-center justify-between gap-2 text-caption text-[var(--text-secondary)]">
                To
                <input type="date" value={to} onChange={(e) => { setTo(e.target.value); if (from && e.target.value) onChange({ ...filters, date: 'range', from, to: e.target.value }) }} className="rounded-control border border-[var(--border-color)] bg-transparent px-1 text-[var(--text-primary)]" />
              </label>
            </div>
          </>
        )}
      </FilterButton>

      <FilterButton name="Status" value={statusText} onClear={() => onChange({ ...filters, status: 'all' })}>
        {(close) => STATUS_CHOICES.map(([value, label]) => (
          <button key={value} type="button" role="menuitemradio" aria-checked={(filters.status ?? 'all') === value} className={ROW} onClick={() => { onChange({ ...filters, status: value }); close() }}>
            {label}
          </button>
        ))}
      </FilterButton>

      <FilterButton name="Labels" value={labelsText} onClear={() => onChange({ ...filters, label_ids: [] })}>
        {() => (
          <div className="max-h-72 overflow-y-auto">
            {labels.length === 0 && <p className="px-2 py-1.5 text-caption text-[var(--text-secondary)]">No labels yet</p>}
            {labels.map((label) => (
              <label key={label.id} className={cn(ROW, 'cursor-pointer')}>
                <input type="checkbox" checked={labelIds.includes(label.id)} onChange={() => onChange({ ...filters, label_ids: toggle(labelIds, label.id) })} />
                <span className="truncate">{label.title}</span>
              </label>
            ))}
          </div>
        )}
      </FilterButton>

      <FilterButton name="Priority" value={priorityText} onClear={() => onChange({ ...filters, priorities: [] })}>
        {() => PRIORITY_CHOICES.map(([value, label]) => (
          <label key={value} className={cn(ROW, 'cursor-pointer')}>
            <input type="checkbox" checked={priorities.includes(value)} onChange={() => onChange({ ...filters, priorities: toggle(priorities, value) })} />
            {label}
          </label>
        ))}
      </FilterButton>
    </div>
  )
}
