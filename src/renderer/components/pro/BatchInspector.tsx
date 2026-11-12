import { useState, type RefObject } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Popover } from '@/components/overlay/Popover'
import { MonthCalendar } from '@/components/task-list/MonthCalendar'
import { useUpdateTask } from '@/hooks/use-task-mutations'
import { useProLedger, writeLedger } from '@/hooks/use-pro-ledger'
import { formatLength } from '@/lib/planner-timeline'
import { NULL_DATE } from '@/lib/constants'
import { toast } from '@/stores/toast-store'
import type { Task } from '@/lib/vikunja-types'
import { toLocalDate } from '../../../shared/due-dates'
import { estimateOf } from '../../../shared/pro/ledger'
import { dateOnlyStart, startDayOf } from '../../../shared/pro/start-dates'
import { isTimeBlock } from '../../../shared/time-blocks'

const ROW = 'flex items-center justify-between gap-3 py-1.5'
const SMALL = 'rounded-control border border-border px-2 py-0.5 text-meta text-text hover:bg-bg-hover disabled:opacity-40'
const ESTIMATES = [5, 15, 30, 60, 120]

/** One value when every task has it, "Mixed" when they differ, "None" when none has one. */
function summary<T>(values: readonly (T | null)[], show: (value: T) => string): string {
  const set = values.filter((value): value is T => value !== null)
  if (set.length === 0) return 'None'
  const first = show(set[0])
  return set.length === values.length && set.every((value) => show(value) === first) ? first : 'Mixed'
}

/**
 * The inspector for a selection of tasks (plan 7.7.2, Mod+I): what the selection bar does not set
 * already, for all of them at once: start date, estimate and flag. Every write goes through the
 * task mutations and the serial write gate, so offline queueing behaves like the card. A task with
 * a time block keeps its block as its start (21.3).
 */
export function BatchInspector({ anchorRef, tasks, onClose }: { anchorRef: RefObject<HTMLElement | null>; tasks: readonly Task[]; onClose: () => void }) {
  const update = useUpdateTask()
  const queryClient = useQueryClient()
  const { ledger } = useProLedger()
  const [picking, setPicking] = useState(false)
  const open = tasks.filter((task) => !task.done)
  const startable = open.filter((task) => !isTimeBlock(task.start_date, task.end_date))
  const starts = startable.map((task) => startDayOf(task))
  const estimates = open.map((task) => estimateOf(ledger, task.id))
  const flagged = open.map((task) => task.is_favorite === true)

  const setStart = (day: string | null) => {
    for (const task of startable) {
      const next = day ? dateOnlyStart(day) : NULL_DATE
      update.mutate({ id: task.id, changes: { start_date: next }, original: task })
    }
    toast.success(day ? `Start set on ${startable.length} tasks` : `Start removed from ${startable.length} tasks`)
  }
  const setEstimate = (minutes: number | null) => {
    void writeLedger(queryClient, open.map((task) => ({ op: 'estimate' as const, taskId: task.id, minutes })))
  }
  const setFlag = (flag: boolean) => {
    for (const task of open) if ((task.is_favorite === true) !== flag) update.mutate({ id: task.id, changes: { is_favorite: flag }, original: task })
  }

  return (
    <Popover anchorRef={anchorRef} label="Inspector" role="dialog" placement="top-start" onClose={onClose}>
      <div className="w-72 p-3" data-pro-inspector>
        <p className="mb-2 text-meta font-medium text-text">{open.length === 1 ? '1 open task' : `${open.length} open tasks`}</p>
        <div className={ROW}>
          <span className="text-meta text-text-secondary">Start</span>
          <span className="flex items-center gap-1.5">
            <span className="text-meta text-text" data-pro-inspector-start>{summary(starts, (day) => day)}</span>
            <button type="button" className={SMALL} disabled={startable.length === 0} onClick={() => setPicking((value) => !value)}>Set</button>
            <button type="button" className={SMALL} disabled={!starts.some((day) => day !== null)} onClick={() => setStart(null)}>Clear</button>
          </span>
        </div>
        {picking && (
          <MonthCalendar
            selected={null}
            today={toLocalDate(new Date())}
            onPick={(day) => {
              setPicking(false)
              setStart(day)
            }}
          />
        )}
        <div className={ROW}>
          <span className="text-meta text-text-secondary">Estimate</span>
          <span className="text-meta text-text" data-pro-inspector-estimate>{summary(estimates, (minutes) => formatLength(minutes))}</span>
        </div>
        <div className="flex flex-wrap gap-1 pb-1.5">
          {ESTIMATES.map((minutes) => (
            <button key={minutes} type="button" className={SMALL} onClick={() => setEstimate(minutes)}>{formatLength(minutes)}</button>
          ))}
          <button type="button" className={SMALL} disabled={!estimates.some((value) => value !== null)} onClick={() => setEstimate(null)}>Clear</button>
        </div>
        <div className={ROW}>
          <span className="text-meta text-text-secondary">Flag</span>
          <span className="flex items-center gap-1.5">
            <span className="text-meta text-text">{flagged.every(Boolean) && flagged.length ? 'All' : flagged.some(Boolean) ? 'Some' : 'None'}</span>
            <button type="button" className={SMALL} disabled={open.length === 0 || flagged.every(Boolean)} onClick={() => setFlag(true)}>Flag all</button>
            <button type="button" className={SMALL} disabled={!flagged.some(Boolean)} onClick={() => setFlag(false)}>Unflag</button>
          </span>
        </div>
      </div>
    </Popover>
  )
}
