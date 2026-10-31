import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Bell, Check, ChevronRight, Clock3, SkipForward, Undo2 } from 'lucide-react'
import { useRoutines } from '@/hooks/use-routines'
import { APP_CONFIG_QUERY_KEY, useAppConfig } from '@/hooks/use-app-config'
import { api } from '@/lib/api'
import type { AppConfig } from '@/lib/vikunja-types'
import { useDayKey } from '@/stores/day-store'
import { planTodayRoutines, todayRoutinesLimit } from '../../../shared/today-routines'
import { isFinished, type OccurrenceStatus, type RoutineOccurrence } from '@/lib/routines'
import type { Task } from '@/lib/vikunja-types'
import { cn } from '@/lib/cn'
import { ListSectionHeader } from '@/components/task-list/ListSectionHeader'
import { formatMinutesOfDay } from '@/lib/date-utils'
import { useDateFormat } from '@/hooks/use-date-format'
import { useCollabMe, useProjectAccess } from '@/hooks/use-project-access'
import { loggedByText } from '@/lib/routine-sharing'
import { useRoutineSharing } from './RoutineSharing'

function RoutineCheck({
  occurrence,
  disabled,
  onStatus,
  progress = null,
}: {
  occurrence: RoutineOccurrence<Task>
  disabled: boolean
  onStatus: (status: OccurrenceStatus) => void
  /** How far the routine is today, as `1/3`, when it has more than one time (Today, semantics 6.10). */
  progress?: string | null
}) {
  const dateFormat = useDateFormat()
  const completed = occurrence.status === 'COMPLETED'
  const skipped = occurrence.status === 'SKIPPED'
  const definition = occurrence.carrier.payload.definition
  // A routine someone shared: who finished it, and whether this account may tick it (section 6.9).
  const sharing = useRoutineSharing(occurrence.carrier)
  const me = useCollabMe()
  const members = useProjectAccess(occurrence.carrier.task.project_id).members
  const doneBy = sharing.shared ? loggedByText(occurrence.status, occurrence.record, me?.id, members) : ''
  const locked = disabled || !sharing.canWrite

  return (
    <div className={cn(
      'group flex min-h-14 items-center gap-3 px-6 py-2 transition-colors hover:bg-[var(--bg-hover)]',
      (completed || skipped) && 'opacity-60',
    )}>
      <button
        type="button"
        disabled={locked}
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
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-meta text-[var(--text-secondary)]">
          <span className="inline-flex items-center gap-1">
            <Clock3 className="h-3 w-3" />
            {formatMinutesOfDay(occurrence.slot.reminderMinutes, dateFormat)}
          </span>
          {occurrence.slot.reminderEnabled && <Bell className="h-3 w-3" />}
          {progress && <span className="tabular-nums">{progress}</span>}
          {occurrence.status === 'NOT_LOGGED' && <span>Not logged</span>}
          {skipped && !doneBy && <span>Skipped</span>}
          {doneBy && <span>{doneBy}</span>}
        </div>
      </div>

      {sharing.canWrite && <button
        type="button"
        disabled={locked}
        onClick={() => onStatus(skipped ? 'PENDING' : 'SKIPPED')}
        className="flex h-7 items-center gap-1 rounded-control px-2 text-meta text-[var(--text-secondary)] opacity-0 transition hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] group-hover:opacity-100 focus:opacity-100"
        aria-label={skipped ? `Undo skip for ${definition.name}` : `Skip ${definition.name}`}
      >
        {skipped ? <Undo2 className="h-3.5 w-3.5" /> : <SkipForward className="h-3.5 w-3.5" />}
        {skipped ? 'Undo' : 'Skip'}
      </button>}
    </div>
  )
}

/** The local time of day in minutes, read again every 30 seconds while `active`. */
function useMinutesNow(active: boolean): number {
  const read = () => {
    const now = new Date()
    return now.getHours() * 60 + now.getMinutes()
  }
  const [minutes, setMinutes] = useState(read)
  useEffect(() => {
    if (!active) return
    setMinutes(read())
    const timer = setInterval(() => setMinutes(read()), 30_000)
    return () => clearInterval(timer)
  }, [active])
  return minutes
}

/** Today's routine limit, and whether the section is folded to its header (kept in this device's config). */
function useTodayRoutinesPrefs() {
  const qc = useQueryClient()
  const { data: config } = useAppConfig()
  const setFolded = useCallback(
    (folded: boolean) => {
      const current = qc.getQueryData<AppConfig | null>(APP_CONFIG_QUERY_KEY)
      if (current) qc.setQueryData<AppConfig>(APP_CONFIG_QUERY_KEY, { ...current, routines_today_folded: folded })
      void api.saveConfigPatch({ routines_today_folded: folded })
    },
    [qc],
  )
  return { folded: config?.routines_today_folded === true, limit: todayRoutinesLimit(config?.routines_today_limit), setFolded }
}

export function RoutineTodaySection({
  showEmpty = false,
  onToday = false,
}: {
  showEmpty?: boolean
  /**
   * The Today view (cross-app semantics 6.10): one row per routine for its next open time, the ones
   * due now up to the limit, the rest behind one line that opens until Today is left; the header folds.
   */
  onToday?: boolean
}) {
  const routines = useRoutines()
  const completed = routines.today.filter((occurrence) => occurrence.status === 'COMPLETED').length
  const total = routines.today.length
  const { folded, limit, setFolded } = useTodayRoutinesPrefs()
  const nowMinutes = useMinutesNow(onToday)
  const dayKey = useDayKey()
  const [opened, setOpened] = useState(false)
  const plan = useMemo(
    () => planTodayRoutines(routines.today, nowMinutes, limit, (occurrence) => ({
      routineId: occurrence.carrier.payload.definition.id,
      name: occurrence.carrier.payload.definition.name,
      minutes: occurrence.slot.reminderMinutes,
      finished: isFinished(occurrence.status),
      carried: occurrence.scheduledDate < dayKey,
    })),
    [routines.today, nowMinutes, limit, dayKey],
  )
  const rows = !onToday
    ? routines.today.map((occurrence) => ({ occurrence, progress: null as string | null }))
    : folded ? [] : (opened ? plan.rows : plan.visible).map((row) => ({ occurrence: row.item, progress: row.progress }))
  const line = onToday && !folded ? plan.lineText : null

  if (!routines.isLoading && (onToday ? plan.rows.length === 0 : total === 0) && !showEmpty) return null

  return (
    <section className="border-b border-[var(--border-color)] pb-2">
      <ListSectionHeader level={1} title="Routines" tone="routines" className="gap-3">
        {onToday && (
          <button
            type="button"
            aria-label={folded ? 'Expand routines' : 'Collapse routines'}
            aria-expanded={!folded}
            onClick={() => setFolded(!folded)}
            className="-ml-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-control text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          >
            <ChevronRight
              className={cn('h-3.5 w-3.5 transition-transform duration-fade-fast motion-reduce:transition-none', !folded && 'rotate-90')}
              strokeWidth={2}
            />
          </button>
        )}
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
      {rows.map(({ occurrence, progress }) => (
        <RoutineCheck
          key={onToday ? occurrence.carrier.payload.definition.id : occurrence.key}
          occurrence={occurrence}
          progress={progress}
          disabled={routines.isMutating}
          onStatus={(status) => routines.setStatus.mutate({
            carrier: occurrence.carrier,
            date: occurrence.scheduledDate,
            slot: occurrence.slot,
            status,
          })}
        />
      ))}
      {line && (
        <button
          type="button"
          aria-expanded={opened}
          onClick={() => setOpened(!opened)}
          className="ml-4 mt-1 flex h-7 items-center rounded-control px-2 text-meta font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        >
          {opened ? 'Show less' : line}
        </button>
      )}
    </section>
  )
}
