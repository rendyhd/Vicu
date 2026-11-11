import { useMemo, useRef, useState } from 'react'
import { Popover } from '@/components/overlay/Popover'
import { Button } from '@/components/shared/Button'
import { Checkbox } from '@/components/shared/Checkbox'
import { useDateFormat } from '@/hooks/use-date-format'
import { usePlanEventActions } from '@/hooks/use-plan-events'
import { formatLength } from '@/lib/planner-timeline'
import { formatBlockRange } from '../../../shared/date-display'
import type { CalendarEvent } from '../../../shared/calendar-events'
import { choiceIndex, repeatChoices, repeatText, type ListedEvent, type PlanEvent } from '../../../shared/plan-events'

const LENGTHS = [15, 30, 45, 60, 90, 120, 180, 240]

interface EventPopoverProps {
  occurrence: CalendarEvent
  element: HTMLElement
  /** Set for one of your own Events: it can be changed. */
  planEvent?: ListedEvent
  /** The calendar a read-only event comes from. */
  calendarName?: string
  onClose: () => void
}

/** A pressed event: your own can be changed (every time it happens) or skipped once; a calendar's is read-only. */
export function EventPopover({ occurrence, element, planEvent, calendarName, onClose }: EventPopoverProps) {
  const fmt = useDateFormat()
  const anchorRef = useRef<HTMLElement | null>(element)
  anchorRef.current = element
  const when = occurrence.allDay
    ? 'All day'
    : formatBlockRange(new Date(occurrence.start), new Date(occurrence.end), fmt)

  return (
    <Popover anchorRef={anchorRef} label={occurrence.title} role="dialog" placement="right-start" onClose={onClose} className="w-80 p-3">
      {planEvent ? (
        <OwnEvent planEvent={planEvent} occurrence={occurrence} onClose={onClose} />
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

function OwnEvent({ planEvent, occurrence, onClose }: { planEvent: ListedEvent; occurrence: CalendarEvent; onClose: () => void }) {
  const actions = usePlanEventActions()
  const { id, ...stored } = planEvent
  const [title, setTitle] = useState(planEvent.title)
  const choices = useMemo(() => repeatChoices(planEvent.start), [planEvent.start])
  const current = choiceIndex(choices, planEvent.repeat)
  const save = (patch: Partial<PlanEvent>) => void actions.update(id, { ...stored, ...patch })
  const commitTitle = () => {
    const text = title.trim()
    if (text && text !== planEvent.title) save({ title: text })
    else setTitle(planEvent.title)
  }

  return (
    <div data-plan-event-editor={id} className="space-y-2">
      <input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onBlur={commitTitle}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commitTitle()
          }
        }}
        aria-label="Event title"
        className="w-full rounded-control border border-border bg-transparent px-2 py-1.5 text-task-title text-text"
      />

      <label className="flex cursor-pointer items-center gap-2">
        <Checkbox
          checked={planEvent.time === null}
          onChange={(event) =>
            save(event.target.checked ? { time: null, minutes: 0, busy: undefined } : { time: '09:00', minutes: 30, busy: undefined })
          }
        />
        <span className="text-meta text-text">All day</span>
      </label>

      {planEvent.time !== null && (
        <div className="flex items-center gap-2">
          <input
            type="time"
            aria-label="Starts at"
            value={planEvent.time}
            onChange={(event) => {
              if (event.target.value) save({ time: event.target.value })
            }}
            className="rounded-control border border-border bg-transparent px-2 py-1 text-meta text-text"
          />
          <select
            aria-label="Length"
            value={planEvent.minutes}
            onChange={(event) => save({ minutes: Number(event.target.value) })}
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
        onChange={(event) => {
          const index = Number(event.target.value)
          if (index >= 0) save({ repeat: choices[index].repeat })
        }}
        className="w-full rounded-control border border-border bg-bg-card px-1.5 py-1 text-meta text-text"
      >
        {current === -1 && <option value={-1}>{repeatText(planEvent.repeat)}</option>}
        {choices.map((option, index) => (
          <option key={option.label} value={index}>
            {option.label}
          </option>
        ))}
      </select>

      <label className="flex cursor-pointer items-center gap-2">
        <Checkbox checked={occurrence.busy} onChange={(event) => save({ busy: event.target.checked })} />
        <span className="text-meta text-text">Counts as busy time</span>
      </label>

      <p className="text-caption text-text-secondary">Changes apply every time it happens. Shown on Plan only, on all your devices.</p>

      <div className="flex flex-wrap gap-2 border-t border-border pt-2">
        {planEvent.repeat.kind !== 'none' && occurrence.day && (
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
