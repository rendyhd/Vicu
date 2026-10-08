import { Bell, Check, Clock3, SkipForward, Undo2 } from 'lucide-react'
import { useRoutines } from '@/hooks/use-routines'
import { isFinished, type OccurrenceStatus, type RoutineOccurrence } from '@/lib/routines'
import type { Task } from '@/lib/vikunja-types'
import { cn } from '@/lib/cn'
import { ListSectionHeader } from '@/components/task-list/ListSectionHeader'
import { formatMinutesOfDay } from '@/lib/date-utils'
import { useDateFormat } from '@/hooks/use-date-format'

function RoutineCheck({
  occurrence,
  disabled,
  onStatus,
}: {
  occurrence: RoutineOccurrence<Task>
  disabled: boolean
  onStatus: (status: OccurrenceStatus) => void
}) {
  const dateFormat = useDateFormat()
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
            ? 'border-status-done bg-status-done text-on-accent dark:text-bg-page'
            : 'border-[var(--text-tertiary)] text-transparent hover:border-status-done hover:text-status-done',
        )}
      >
        {completed ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : <Check className="h-3 w-3" />}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className={cn('truncate text-section text-[var(--text-primary)]', completed && 'line-through')}>
            {definition.name}
          </span>
          {definition.slots.length > 1 && (
            <span className="shrink-0 text-meta text-[var(--text-secondary)]">{occurrence.slot.label}</span>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-meta text-[var(--text-secondary)]">
          {detail && <span>{detail}</span>}
          <span className="inline-flex items-center gap-1">
            <Clock3 className="h-3 w-3" />
            {formatMinutesOfDay(occurrence.slot.reminderMinutes, dateFormat)}
          </span>
          {occurrence.slot.reminderEnabled && <Bell className="h-3 w-3" />}
          {occurrence.overdue && <span className="font-medium text-status-overdue">Overdue</span>}
          {occurrence.status === 'NOT_LOGGED' && <span>Not logged</span>}
          {skipped && <span>Skipped</span>}
        </div>
      </div>

      <button
        type="button"
        disabled={disabled}
        onClick={() => onStatus(skipped ? 'PENDING' : 'SKIPPED')}
        className="flex h-7 items-center gap-1 rounded-control px-2 text-meta text-[var(--text-secondary)] opacity-0 transition hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] group-hover:opacity-100 focus:opacity-100"
        aria-label={skipped ? `Undo skip for ${definition.name}` : `Skip ${definition.name}`}
      >
        {skipped ? <Undo2 className="h-3.5 w-3.5" /> : <SkipForward className="h-3.5 w-3.5" />}
        {skipped ? 'Undo' : 'Skip'}
      </button>
    </div>
  )
}

export function RoutineTodaySection({
  showEmpty = false,
  hideFinished = false,
}: {
  showEmpty?: boolean
  /** Leave out what is done for the day (completed or skipped); the Today view lists only what is left. */
  hideFinished?: boolean
}) {
  const routines = useRoutines()
  const completed = routines.today.filter((occurrence) => occurrence.status === 'COMPLETED').length
  const total = routines.today.length
  const shown = hideFinished ? routines.today.filter((occurrence) => !isFinished(occurrence.status)) : routines.today

  if (!routines.isLoading && shown.length === 0 && !showEmpty) return null

  return (
    <section className="border-b border-[var(--border-color)] pb-2">
      <ListSectionHeader level={1} title="Routines" tone="routines" className="gap-3">
        {total > 0 && (
          <>
            <div className="h-1.5 min-w-16 flex-1 overflow-hidden rounded-full bg-[var(--bg-tertiary)]">
              <div
                className="h-full rounded-full bg-accent-purple transition-all"
                style={{ width: `${Math.round((completed / total) * 100)}%` }}
              />
            </div>
            <span className="text-meta font-medium tabular-nums text-text-secondary">{completed}/{total}</span>
          </>
        )}
      </ListSectionHeader>

      {routines.isLoading && (
        <div className="px-6 py-3 text-xs text-[var(--text-secondary)]">Loading routines...</div>
      )}
      {!routines.isLoading && total === 0 && (
        <div className="px-6 py-3 text-xs text-[var(--text-secondary)]">Nothing scheduled for today.</div>
      )}
      {shown.map((occurrence) => (
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
