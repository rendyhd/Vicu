import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Popover } from '@/components/overlay/Popover'
import { Button } from '@/components/shared/Button'
import { Checkbox } from '@/components/shared/Checkbox'
import { cn } from '@/lib/cn'
import { useDateFormat } from '@/hooks/use-date-format'
import { usePlanEventActions } from '@/hooks/use-plan-events'
import { formatLength } from '@/lib/planner-timeline'
import { formatBlockRange } from '../../../shared/date-display'
import { addLocalDays } from '../../../shared/due-dates'
import type { CalendarEvent } from '../../../shared/calendar-events'
import {
  choiceIndex,
  repeatChoices,
  repeatText,
  type EventEdit,
  type EventScope,
  type ListedEvent,
} from '../../../shared/plan-events'

const LENGTHS = [15, 30, 45, 60, 90, 120, 180, 240]
const DAY = /^\d{4}-\d{2}-\d{2}$/
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/

/** A new end date starts four weeks after the day pressed; the date field changes it. */
const NEW_END_DAYS = 28

const SCOPES: { value: EventScope; label: string }[] = [
  { value: 'this', label: 'This time' },
  { value: 'following', label: 'This and following' },
  { value: 'all', label: 'All times' },
]

interface EventPopoverProps {
  occurrence: CalendarEvent
  element: HTMLElement
  /** Set for one of your own Events: it can be changed. */
  planEvent?: ListedEvent
  /** The calendar a read-only event comes from. */
  calendarName?: string
  /** The length an Event gets when it is given a time (planner.default_length). */
  defaultLength: number
  /** A change moved the occurrence to another Event or day (this time only, this and following). */
  onMoved?: (occurrenceId: string) => void
  /**
   * Which times a change is for, when the page keeps it: the popover opens again at the new place
   * after a change moved the occurrence, and the choice stays.
   */
  scope?: EventScope
  onScopeChange?: (scope: EventScope) => void
  onClose: () => void
}

/** A pressed event: your own can be changed or skipped once; a calendar's is read-only. */
export function EventPopover({ occurrence, element, planEvent, calendarName, defaultLength, onMoved, scope, onScopeChange, onClose }: EventPopoverProps) {
  const fmt = useDateFormat()
  const anchorRef = useRef<HTMLElement | null>(element)
  anchorRef.current = element
  const when = occurrence.allDay
    ? 'All day'
    : formatBlockRange(new Date(occurrence.start), new Date(occurrence.end), fmt)

  return (
    <Popover anchorRef={anchorRef} label={occurrence.title} role="dialog" placement="right-start" onClose={onClose} className="w-80 p-3">
      {planEvent ? (
        <OwnEvent
          planEvent={planEvent}
          occurrence={occurrence}
          defaultLength={defaultLength}
          onMoved={onMoved}
          scope={scope}
          onScopeChange={onScopeChange}
          onClose={onClose}
        />
      ) : (
        <div data-plan-event-details>
          <p className="text-card-title text-text">{occurrence.title}</p>
          <p className="mt-1 text-meta text-text-secondary">
            {when}
            {occurrence.location ? ` · ${occurrence.location}` : ''}
          </p>
          <p className="mt-1 text-caption text-text-secondary">
            {[occurrence.tentative ? 'Tentative' : null, occurrence.busy ? null : 'Free', `From ${calendarName ?? 'a calendar'}, read only`]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
      )}
    </Popover>
  )
}

/**
 * Your own Event. A repeating one says at the top which times a change is for (contract 20.6): All
 * times by default, This time, or This and following. One choice for the whole popover, instead of a
 * question after each field, because a change is usually several fields at once (a new time and a
 * new length) and the choice stays in view while they are made.
 */
function OwnEvent({
  planEvent,
  occurrence,
  defaultLength,
  onMoved,
  scope: keptScope,
  onScopeChange,
  onClose,
}: {
  planEvent: ListedEvent
  occurrence: CalendarEvent
  defaultLength: number
  onMoved?: (occurrenceId: string) => void
  scope?: EventScope
  onScopeChange?: (scope: EventScope) => void
  onClose: () => void
}) {
  const actions = usePlanEventActions()
  const scopeLabel = useId()
  const repeats = planEvent.repeat.kind !== 'none'
  const [ownScope, setOwnScope] = useState<EventScope>('all')
  const scope = keptScope ?? ownScope
  const setScope = (next: EventScope) => {
    setOwnScope(next)
    onScopeChange?.(next)
  }
  const [title, setTitle] = useState(planEvent.title)
  const [time, setTime] = useState(planEvent.time ?? '')
  const [until, setUntil] = useState(planEvent.until ?? '')
  const day = occurrence.day ?? planEvent.start
  const choices = useMemo(() => repeatChoices(planEvent.start), [planEvent.start])
  const current = choiceIndex(choices, planEvent.repeat)
  // Changing the repeat or the end is never "this time only" (20.6).
  const thisOnly = repeats && scope === 'this'
  // The earliest end: the first day, or the day pressed for this and following.
  const earliestEnd = repeats && scope === 'following' ? day : planEvent.start
  // A change from elsewhere (a drag, Undo, another device) shows here too.
  useEffect(() => setTitle(planEvent.title), [planEvent.title])
  useEffect(() => setTime(planEvent.time ?? ''), [planEvent.time])
  useEffect(() => setUntil(planEvent.until ?? ''), [planEvent.until])

  const save = async (edit: EventEdit) => {
    const id = await actions.change(planEvent, day, edit, repeats ? scope : 'all')
    if (id && id !== occurrence.id) onMoved?.(id)
  }
  const commitTitle = () => {
    const text = title.trim()
    if (text && text !== planEvent.title) void save({ title: text })
    else setTitle(planEvent.title)
  }
  const commitTime = () => {
    if (CLOCK.test(time) && time !== planEvent.time) void save({ time })
    else setTime(planEvent.time ?? '')
  }
  const commitUntil = () => {
    if (DAY.test(until) && until >= earliestEnd && until !== planEvent.until) void save({ until })
    else setUntil(planEvent.until ?? '')
  }
  const onEnter = (commit: () => void) => (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      commit()
    }
  }

  return (
    <div data-plan-event-editor={planEvent.id} className="space-y-2">
      {repeats && (
        <div className="grid gap-1">
          <span id={scopeLabel} className="text-caption text-text-secondary">
            Change
          </span>
          <div role="radiogroup" aria-labelledby={scopeLabel} className="flex rounded-full border border-border p-0.5" data-plan-event-scope>
            {SCOPES.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={scope === option.value}
                data-plan-event-scope-option={option.value}
                onClick={() => setScope(option.value)}
                className={cn(
                  'flex-auto whitespace-nowrap rounded-full px-2 py-0.5 text-caption font-medium',
                  scope === option.value ? 'bg-bg-selected text-text' : 'text-text-secondary hover:text-text',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onBlur={commitTitle}
        onKeyDown={onEnter(commitTitle)}
        aria-label="Event title"
        className="w-full rounded-control border border-border bg-transparent px-2 py-1.5 text-task-title text-text"
      />

      <label className="flex cursor-pointer items-center gap-2">
        <Checkbox
          checked={planEvent.time === null}
          onChange={(event) => void save(event.target.checked ? { time: null } : { time: '09:00', minutes: defaultLength })}
        />
        <span className="text-meta text-text">All day</span>
      </label>

      {planEvent.time !== null && (
        <div className="flex items-center gap-2">
          <input
            type="time"
            aria-label="Starts at"
            data-plan-event-time
            value={time}
            onChange={(event) => setTime(event.target.value)}
            onBlur={commitTime}
            onKeyDown={onEnter(commitTime)}
            className="rounded-control border border-border bg-transparent px-2 py-1 text-meta text-text"
          />
          <select
            aria-label="Length"
            data-plan-event-length
            value={planEvent.minutes}
            onChange={(event) => void save({ minutes: Number(event.target.value) })}
            className="rounded-control border border-border bg-bg-card px-1.5 py-1 text-meta text-text"
          >
            {(LENGTHS.includes(planEvent.minutes) ? LENGTHS : [...LENGTHS, planEvent.minutes].sort((a, b) => a - b)).map((minutes) => (
              <option key={minutes} value={minutes}>
                {formatLength(minutes)}
              </option>
            ))}
          </select>
        </div>
      )}

      <select
        aria-label="Repeat"
        data-plan-event-repeat
        value={current}
        disabled={thisOnly}
        onChange={(event) => {
          const index = Number(event.target.value)
          if (index >= 0) void save({ repeat: choices[index].repeat })
        }}
        className="w-full rounded-control border border-border bg-bg-card px-1.5 py-1 text-meta text-text disabled:opacity-60"
      >
        {current === -1 && <option value={-1}>{repeatText(planEvent.repeat)}</option>}
        {choices.map((option, index) => (
          <option key={option.label} value={index}>
            {option.label}
          </option>
        ))}
      </select>

      {repeats && (
        <div className="flex items-center gap-2">
          <span className="text-meta text-text">Ends</span>
          <select
            aria-label="Ends"
            data-plan-event-ends
            value={planEvent.until ? 'date' : 'never'}
            disabled={thisOnly}
            onChange={(event) => {
              if (event.target.value === 'never') void save({ until: null })
              else void save({ until: addLocalDays(day, NEW_END_DAYS) })
            }}
            className="rounded-control border border-border bg-bg-card px-1.5 py-1 text-meta text-text disabled:opacity-60"
          >
            <option value="never">Never</option>
            <option value="date">On a date</option>
          </select>
          {planEvent.until && (
            <input
              type="date"
              aria-label="Ends on"
              data-plan-event-until
              value={until}
              min={earliestEnd}
              disabled={thisOnly}
              onChange={(event) => setUntil(event.target.value)}
              onBlur={commitUntil}
              onKeyDown={onEnter(commitUntil)}
              className="min-w-0 flex-1 rounded-control border border-border bg-transparent px-2 py-1 text-meta text-text disabled:opacity-60"
            />
          )}
        </div>
      )}
      {thisOnly && <p className="text-caption text-text-secondary">The repeat and the end change for this and following, or all times.</p>}

      {planEvent.time !== null && (
        <label className="flex cursor-pointer items-center gap-2">
          <Checkbox checked={occurrence.busy} onChange={(event) => void save({ busy: event.target.checked })} />
          <span className="text-meta text-text">Counts as busy time</span>
        </label>
      )}

      <p className="text-caption text-text-secondary">Shown on Plan only, on all your devices.</p>

      <div className="flex flex-wrap gap-2 border-t border-border pt-2">
        {repeats && occurrence.day && (
          <Button
            variant="secondary"
            data-plan-event-skip
            onClick={() => {
              void actions.skip(planEvent, occurrence.day!)
              onClose()
            }}
          >
            Skip this one
          </Button>
        )}
        <Button
          variant="secondary"
          danger
          data-plan-event-delete
          onClick={() => {
            void actions.remove(planEvent)
            onClose()
          }}
        >
          Delete event
        </Button>
      </div>
    </div>
  )
}
