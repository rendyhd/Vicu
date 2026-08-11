import { Bell, Check, Clock3, SkipForward, Undo2 } from 'lucide-react'
import { useRoutines } from '@/hooks/use-routines'
import { timeLabel, type OccurrenceStatus, type RoutineOccurrence } from '@/lib/routines'
import type { Task } from '@/lib/vikunja-types'
import { cn } from '@/lib/cn'

function RoutineCheck({
  occurrence,
  disabled,
  onStatus,
}: {
  occurrence: RoutineOccurrence<Task>
  disabled: boolean
  onStatus: (status: OccurrenceStatus) => void
}) {
  const completed = occurrence.status === 'COMPLETED'
  const skipped = occurrence.status === 'SKIPPED'
  const definition = occurrence.carrier.payload.definition
  const detail = [definition.amount, definition.unit].filter(Boolean).join(' ')

  return (
    <div className={cn(
      'group flex min-h-14 items-center gap-3 px-6 py-2 transition-colors hover:bg-[var(--bg-hover)]',
      (completed || skipped) && 'opacity-60',
    )}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onStatus(completed ? 'PENDING' : 'COMPLETED')}
        aria-label={completed ? `Undo ${definition.name}` : `Complete ${definition.name}`}
        className={cn(
          'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-all',
          completed
            ? 'border-accent-green bg-accent-green text-white'
            : 'border-[var(--text-tertiary)] text-transparent hover:border-accent-green hover:text-accent-green',
        )}
      >
        {completed ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : <Check className="h-3 w-3" />}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className={cn('truncate text-[13px] font-medium text-[var(--text-primary)]', completed && 'line-through')}>
            {definition.name}
          </span>
          {definition.slots.length > 1 && (
            <span className="shrink-0 text-[11px] text-[var(--text-secondary)]">{occurrence.slot.label}</span>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-[var(--text-secondary)]">
          {detail && <span>{detail}</span>}
          <span className="inline-flex items-center gap-1">
            <Clock3 className="h-3 w-3" />
            {timeLabel(occurrence.slot.reminderMinutes)}
          </span>
          {occurrence.slot.reminderEnabled && <Bell className="h-3 w-3" />}
          {occurrence.overdue && <span className="font-medium text-accent-red">Overdue</span>}
          {occurrence.status === 'NOT_LOGGED' && <span>Not logged</span>}
          {skipped && <span>Skipped</span>}
        </div>
      </div>

      <button
        type="button"
        disabled={disabled}
        onClick={() => onStatus(skipped ? 'PENDING' : 'SKIPPED')}
        className="flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium text-[var(--text-secondary)] opacity-0 transition hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] group-hover:opacity-100 focus:opacity-100"
        aria-label={skipped ? `Undo skip for ${definition.name}` : `Skip ${definition.name}`}
      >
        {skipped ? <Undo2 className="h-3.5 w-3.5" /> : <SkipForward className="h-3.5 w-3.5" />}
        {skipped ? 'Undo' : 'Skip'}
      </button>
    </div>
  )
}

export function RoutineTodaySection({ showEmpty = false }: { showEmpty?: boolean }) {
  const routines = useRoutines()
  const completed = routines.today.filter((occurrence) => occurrence.status === 'COMPLETED').length
  const total = routines.today.length

  if (!routines.isLoading && total === 0 && !showEmpty) return null

  return (
    <section className="border-b border-[var(--border-color)] pb-2">
      <div className="flex items-center gap-3 px-6 pb-1.5 pt-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-accent-purple">Routines</span>
        {total > 0 && (
          <>
            <div className="h-1.5 min-w-16 flex-1 overflow-hidden rounded-full bg-[var(--bg-tertiary)]">
              <div
                className="h-full rounded-full bg-accent-purple transition-all"
                style={{ width: `${Math.round((completed / total) * 100)}%` }}
              />
            </div>
            <span className="text-[11px] tabular-nums text-[var(--text-secondary)]">{completed}/{total}</span>
          </>
        )}
      </div>

      {routines.isLoading && (
        <div className="px-6 py-3 text-xs text-[var(--text-secondary)]">Loading routines...</div>
      )}
      {!routines.isLoading && total === 0 && (
        <div className="px-6 py-3 text-xs text-[var(--text-secondary)]">Nothing scheduled for today.</div>
      )}
      {routines.today.map((occurrence) => (
        <RoutineCheck
          key={occurrence.key}
          occurrence={occurrence}
          disabled={routines.isMutating}
          onStatus={(status) => routines.setStatus.mutate({
            carrier: occurrence.carrier,
            date: occurrence.scheduledDate,
            slot: occurrence.slot,
            status,
          })}
        />
      ))}
    </section>
  )
}
