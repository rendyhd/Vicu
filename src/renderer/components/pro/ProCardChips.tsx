import { useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CalendarClock, Flag, Hourglass, Link2, Plus, Search, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Popover } from '@/components/overlay/Popover'
import { Tooltip } from '@/components/overlay/Tooltip'
import { MonthCalendar } from '@/components/task-list/MonthCalendar'
import { useUpdateTask } from '@/hooks/use-task-mutations'
import { useToggleFlags } from '@/hooks/use-flag'
import { blockersOf, useToggleAfter } from '@/hooks/use-relations'
import { useProLedger, writeLedger } from '@/hooks/use-pro-ledger'
import { useTasks } from '@/hooks/use-tasks'
import { OPEN_TASKS_PARAMS, useAvailability } from '@/hooks/use-availability'
import { useDateFormat } from '@/hooks/use-date-format'
import { formatLength } from '@/lib/planner-timeline'
import { NULL_DATE } from '@/lib/constants'
import type { Task } from '@/lib/vikunja-types'
import { addLocalDays, startOfWeek, toLocalDate } from '../../../shared/due-dates'
import { dateOnlyStart, startDateOf, startDayOf } from '../../../shared/pro/start-dates'
import { estimateOf } from '../../../shared/pro/ledger'
import { formatWeekdayDate } from '../../../shared/date-display'
import { blockOf } from '../../../shared/time-blocks'

const BUTTON = 'inline-flex min-h-7 shrink-0 items-center gap-1 rounded-control px-2 text-meta transition-colors duration-fade-fast'
const SET = 'border border-[var(--border-color)] text-text hover:bg-bg-hover'
const UNSET = 'border border-transparent text-text-secondary hover:bg-bg-hover hover:text-text'
const OPEN = 'border border-transparent bg-bg-selected text-accent-blue'

type Open = 'start' | 'estimate' | 'after' | null

function Chip({ prop, name, value, isSet, open, buttonRef, onClick, icon, unsetLabel, tip, shortcut }: {
  prop: string
  name: string
  value?: string
  isSet: boolean
  open: boolean
  buttonRef?: RefObject<HTMLButtonElement>
  onClick: () => void
  icon: ReactNode
  unsetLabel: string
  tip?: string
  shortcut?: string
}) {
  return (
    <Tooltip label={tip ?? name} shortcut={shortcut}>
      <button
        ref={buttonRef}
        type="button"
        data-prop={prop}
        aria-label={isSet && value ? `${name}: ${value}` : name}
        aria-expanded={buttonRef ? open : undefined}
        onClick={onClick}
        className={cn(BUTTON, open ? OPEN : isSet ? SET : UNSET)}
      >
        {isSet ? (
          <>
            {icon}
            {value && <span className="max-w-[12rem] truncate">{value}</span>}
          </>
        ) : (
          <>
            <Plus className="h-3 w-3" aria-hidden="true" />
            <span>{unsetLabel}</span>
          </>
        )}
      </button>
    </Tooltip>
  )
}

/**
 * Pro's chips on an open card (cross-app semantics 21.2 to 21.4, plan 7.2.3): start date, estimate,
 * after and flag. Shown only while the availability layer is on.
 */
export function ProCardChips({ task }: { task: Task }) {
  const { on } = useAvailability()
  const [open, setOpen] = useState<Open>(null)
  const startRef = useRef<HTMLButtonElement>(null)
  const estimateRef = useRef<HTMLButtonElement>(null)
  const afterRef = useRef<HTMLButtonElement>(null)
  const fmt = useDateFormat()
  const toggleFlags = useToggleFlags()
  const { ledger } = useProLedger()
  if (!on) return null

  const now = new Date()
  const block = blockOf(task)
  const start = startDateOf(task)
  const estimate = estimateOf(ledger, task.id)
  const blockers = blockersOf(task)
  const toggle = (which: Exclude<Open, null>) => setOpen((current) => (current === which ? null : which))
  const close = () => setOpen(null)

  return (
    <>
      {/* A block holds the start (21.3): no separate start date while the task has one. */}
      {!block && (
        <Chip
          prop="pro-start"
          name="Start date"
          tip="When it becomes available"
          value={start ? `Starts ${formatWeekdayDate(start, now, fmt)}` : undefined}
          isSet={!!start}
          open={open === 'start'}
          buttonRef={startRef}
          onClick={() => toggle('start')}
          icon={<CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />}
          unsetLabel="Start"
        />
      )}
      {open === 'start' && <StartPopover anchorRef={startRef} task={task} onClose={close} />}

      <Chip
        prop="pro-estimate"
        name="Estimate"
        value={estimate !== null ? formatLength(estimate) : undefined}
        isSet={estimate !== null}
        open={open === 'estimate'}
        buttonRef={estimateRef}
        onClick={() => toggle('estimate')}
        icon={<Hourglass className="h-3.5 w-3.5" aria-hidden="true" />}
        unsetLabel="Estimate"
      />
      {open === 'estimate' && <EstimatePopover anchorRef={estimateRef} task={task} current={estimate} onClose={close} />}

      <Chip
        prop="pro-after"
        name="After"
        tip="Tasks this one waits on"
        value={blockers.length === 0 ? undefined : blockers.length === 1 ? `After: ${blockers[0].title ?? 'a task'}` : `After ${blockers.length} tasks`}
        isSet={blockers.length > 0}
        open={open === 'after'}
        buttonRef={afterRef}
        onClick={() => toggle('after')}
        icon={<Link2 className="h-3.5 w-3.5" aria-hidden="true" />}
        unsetLabel="After"
      />
      {open === 'after' && <AfterPopover anchorRef={afterRef} task={task} onClose={close} />}

      <Chip
        prop="pro-flag"
        name="Flag"
        tip={task.is_favorite ? 'Remove flag' : 'Flag'}
        shortcut="Mod+Shift+F"
        value="Flagged"
        isSet={task.is_favorite === true}
        open={false}
        onClick={() => toggleFlags([task])}
        icon={<Flag className="h-3.5 w-3.5 fill-accent-orange text-accent-orange" aria-hidden="true" />}
        unsetLabel="Flag"
      />
    </>
  )
}

function StartPopover({ anchorRef, task, onClose }: { anchorRef: RefObject<HTMLElement | null>; task: Task; onClose: () => void }) {
  const update = useUpdateTask()
  const today = toLocalDate(new Date())
  const current = startDayOf(task)
  const set = (day: string | null) => {
    update.mutate({ id: task.id, changes: { start_date: day ? dateOnlyStart(day) : NULL_DATE }, original: task })
    onClose()
  }
  const nextMonday = addLocalDays(startOfWeek(today), 7)
  const choices: Array<{ label: string; day: string }> = [
    { label: 'Tomorrow', day: addLocalDays(today, 1) },
    { label: 'Next week', day: nextMonday },
    { label: 'In two weeks', day: addLocalDays(today, 14) },
  ]
  return (
    <Popover anchorRef={anchorRef} onClose={onClose} label="Start date" role="dialog" className="w-72 p-2">
      <div className="mb-2 flex flex-wrap gap-1">
        {choices.map((choice) => (
          <button key={choice.label} type="button" className="rounded-chip border border-border px-2 py-0.5 text-meta text-text hover:bg-bg-hover" onClick={() => set(choice.day)}>
            {choice.label}
          </button>
        ))}
      </div>
      <MonthCalendar selected={current} today={today} onPick={(day) => set(day)} />
      {current && (
        <button type="button" className="mt-2 w-full rounded-control px-2 py-1 text-left text-meta text-danger hover:bg-danger/10" onClick={() => set(null)}>
          Remove start date
        </button>
      )}
      <p className="mt-2 text-caption text-text-secondary">Until that day the task waits: it leaves Available and shows on Upcoming the day it starts.</p>
    </Popover>
  )
}

const ESTIMATES = [5, 15, 30, 60, 90, 120, 240]

function EstimatePopover({ anchorRef, task, current, onClose }: { anchorRef: RefObject<HTMLElement | null>; task: Task; current: number | null; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [typed, setTyped] = useState('')
  const set = (minutes: number | null) => {
    void writeLedger(queryClient, [{ op: 'estimate', taskId: task.id, minutes }])
    onClose()
  }
  return (
    <Popover anchorRef={anchorRef} onClose={onClose} label="Estimate" role="dialog" className="w-64 p-2">
      <div className="flex flex-wrap gap-1">
        {ESTIMATES.map((minutes) => (
          <button
            key={minutes}
            type="button"
            aria-pressed={current === minutes}
            className={cn('rounded-chip border px-2 py-0.5 text-meta', current === minutes ? 'border-accent-blue bg-accent-blue/12 text-accent-blue' : 'border-border text-text hover:bg-bg-hover')}
            onClick={() => set(minutes)}
          >
            {formatLength(minutes)}
          </button>
        ))}
      </div>
      <form
        className="mt-2 flex items-center gap-1"
        onSubmit={(event) => {
          event.preventDefault()
          const minutes = Math.round(Number(typed))
          if (minutes >= 1 && minutes <= 24 * 60) set(minutes)
        }}
      >
        <input
          type="number"
          min={1}
          max={1440}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          placeholder="Minutes"
          aria-label="Minutes"
          className="w-24 rounded-control border border-border bg-bg-page px-2 py-1 text-meta text-text"
        />
        <button type="submit" className="rounded-control px-2 py-1 text-meta font-medium text-accent-blue hover:bg-bg-hover">Set</button>
      </form>
      {current !== null && (
        <button type="button" className="mt-2 w-full rounded-control px-2 py-1 text-left text-meta text-danger hover:bg-danger/10" onClick={() => set(null)}>
          Remove estimate
        </button>
      )}
    </Popover>
  )
}

function AfterPopover({ anchorRef, task, onClose }: { anchorRef: RefObject<HTMLElement | null>; task: Task; onClose: () => void }) {
  const toggle = useToggleAfter()
  const { data: open = [] } = useTasks(OPEN_TASKS_PARAMS)
  const { cycles } = useAvailability()
  const [query, setQuery] = useState('')
  const blockers = blockersOf(task)
  const blockerIds = new Set(blockers.map((entry) => entry.id))
  const matches = useMemo(() => {
    const words = query.trim().toLowerCase()
    if (!words) return []
    return open
      .filter((other) => other.id !== task.id && !blockerIds.has(other.id) && other.title.toLowerCase().includes(words))
      .slice(0, 8)
  }, [open, query, task.id, blockerIds])

  return (
    <Popover anchorRef={anchorRef} onClose={onClose} label="After" role="dialog" className="w-80 p-2" initialFocus="input">
      <p className="mb-2 text-caption text-text-secondary">This task becomes available when these are done.</p>
      {blockers.length > 0 && (
        <ul className="mb-2 space-y-0.5">
          {blockers.map((entry) => (
            <li key={entry.id} className="flex items-center gap-2 rounded-control px-1 py-0.5 text-meta text-text">
              <Link2 className="h-3 w-3 shrink-0 text-text-secondary" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{entry.title ?? `Task ${entry.id}`}</span>
              <button
                type="button"
                aria-label={`Stop waiting on ${entry.title ?? 'this task'}`}
                className="rounded-control p-0.5 text-text-secondary hover:bg-bg-hover hover:text-text"
                onClick={() => toggle.mutate({ task, other: { id: entry.id, title: entry.title ?? '', done: !!entry.done }, add: false })}
              >
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {cycles.includes(task.id) && (
        <p className="mb-2 text-caption text-status-overdue">These tasks wait on each other in a loop, so the loop is ignored. Remove one of them.</p>
      )}
      <label className="flex items-center gap-1.5 rounded-control border border-border px-2 py-1">
        <Search className="h-3 w-3 text-text-secondary" aria-hidden="true" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find a task"
          aria-label="Find a task to wait on"
          className="min-w-0 flex-1 bg-transparent text-meta text-text outline-none"
        />
      </label>
      {matches.length > 0 && (
        <ul className="mt-1 max-h-56 overflow-y-auto" role="listbox" aria-label="Tasks">
          {matches.map((other) => (
            <li key={other.id}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                className="w-full truncate rounded-control px-2 py-1 text-left text-meta text-text hover:bg-bg-hover"
                onClick={() => {
                  toggle.mutate({ task, other: { id: other.id, title: other.title, done: other.done }, add: true })
                  setQuery('')
                }}
              >
                {other.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Popover>
  )
}
