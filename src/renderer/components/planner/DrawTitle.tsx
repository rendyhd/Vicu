import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { Popover } from '@/components/overlay/Popover'
import { cn } from '@/lib/cn'
import { useDateFormat } from '@/hooks/use-date-format'
import { formatDateDisplay } from '@/lib/date-display'
import { readEventText } from '@/lib/event-quick-add'
import { formatBlockRange } from '../../../shared/date-display'
import { startOfLocalDay, toLocalDate, type LocalDate } from '../../../shared/due-dates'
import { MAX_EVENT_MINUTES, choiceIndex, repeatChoices, repeatText, type EventRepeat } from '../../../shared/plan-events'
import { atClock, minutesOfDay } from '../../../shared/time-blocks'

export type DrawnKind = 'task' | 'event'

/** Where a new Event goes: its first day and wall-clock minutes. */
export interface DrawnPlace {
  day: LocalDate
  startMinute: number
  endMinute: number
}

interface DrawTitleProps {
  anchorRef: RefObject<HTMLElement | null>
  day: LocalDate
  start: Date
  end: Date
  /** What the box starts as: a task (drawing, Ctrl+N) or an Event (New event, Ctrl+Shift+N). */
  initialKind?: DrawnKind
  /** The project a task goes into, for the line under the field. */
  projectName?: string
  /** `place` is the Event's day and time after the quick-add text; a task keeps the drawn time. */
  onSubmit: (title: string, kind: DrawnKind, repeat: EventRepeat, place: DrawnPlace) => void
  onCancel: () => void
}

const NO_REPEAT: EventRepeat = { kind: 'none' }

/**
 * The name of what was drawn on an empty time: a task (the default), or an Event, a time you are
 * not available that can repeat. An Event's name is read like quick add ("Manager call every Tue
 * 10:00 for 30m": the day, time, length and repeat). Enter adds it; Escape or a press outside drops it.
 */
export function DrawTitle({ anchorRef, day, start, end, initialKind = 'task', projectName, onSubmit, onCancel }: DrawTitleProps) {
  const fmt = useDateFormat()
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<DrawnKind>(initialKind)
  const [repeat, setRepeat] = useState<EventRepeat>(NO_REPEAT)
  const submitted = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // The box was opened for `start`: a time alone in the text stays on that day.
  const read = useMemo(() => {
    if (kind !== 'event' || !title.trim()) return null
    const now = new Date()
    const reference = toLocalDate(now) === day ? now : startOfLocalDay(day)
    return readEventText(title, { day, reference, locale: fmt.locale })
  }, [kind, title, day, fmt.locale])

  const drawnStart = minutesOfDay(start)
  const drawnLength = Math.max(1, Math.round((end.getTime() - start.getTime()) / 60_000))
  const place: DrawnPlace = useMemo(() => {
    const placeDay = read?.day ?? day
    const startMinute = read?.startMinute ?? drawnStart
    const minutes = Math.min(MAX_EVENT_MINUTES, read?.minutes ?? drawnLength)
    return { day: placeDay, startMinute, endMinute: startMinute + minutes }
  }, [read, day, drawnStart, drawnLength])

  // The text's repeat takes the list's place while it names one; otherwise the list stays as chosen.
  const textRepeat = read?.repeat ?? null
  const textRepeatKey = textRepeat ? JSON.stringify(textRepeat) : ''
  useEffect(() => {
    if (textRepeat) setRepeat(textRepeat)
  }, [textRepeatKey])

  const choices = useMemo(() => repeatChoices(place.day), [place.day])
  const current = choiceIndex(choices, repeat)

  const submit = () => {
    const text = (kind === 'event' ? read?.title : undefined) ?? title.trim()
    if (!text.trim()) {
      onCancel()
      return
    }
    submitted.current = true
    onSubmit(text.trim(), kind, repeat, place)
  }

  const when =
    kind === 'event'
      ? `${place.day === day ? '' : `${formatDateDisplay('header.day', startOfLocalDay(place.day), new Date(), true, fmt)}, `}${formatBlockRange(
          atClock(place.day, place.startMinute),
          atClock(place.day, place.endMinute),
          fmt,
        )}`
      : formatBlockRange(start, end, fmt)

  return (
    <Popover
      anchorRef={anchorRef}
      label={kind === 'task' ? 'New task' : 'New event'}
      role="dialog"
      placement="right-start"
      onClose={() => {
        if (!submitted.current) onCancel()
      }}
      className="w-72 p-3"
    >
      <form
        data-plan-draw-title
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <div role="radiogroup" aria-label="Add as" className="mb-2 flex rounded-full border border-border p-0.5">
          {(['task', 'event'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={kind === value}
              data-plan-draw-kind={value}
              onClick={() => {
                setKind(value)
                inputRef.current?.focus()
              }}
              className={cn(
                'flex-1 rounded-full px-3 py-0.5 text-meta font-medium',
                kind === value ? 'bg-bg-selected text-text' : 'text-text-secondary hover:text-text',
              )}
            >
              {value === 'task' ? 'Task' : 'Event'}
            </button>
          ))}
        </div>
        <input
          ref={inputRef}
          data-autofocus
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={kind === 'task' ? 'New task' : 'Manager call every Tue 10:00 for 30m'}
          aria-label={kind === 'task' ? 'Task title' : 'Event title'}
          className="w-full rounded-control border border-border bg-transparent px-2 py-1.5 text-task-title text-text placeholder:text-text-secondary"
        />
        {kind === 'event' && (
          <select
            aria-label="Repeat"
            data-plan-draw-repeat
            value={current}
            onChange={(event) => {
              const index = Number(event.target.value)
              if (index >= 0) setRepeat(choices[index].repeat)
            }}
            onKeyDown={(event) => {
              // Enter on the list adds the event, as it does in the field.
              if (event.key === 'Enter') {
                event.preventDefault()
                submit()
              }
            }}
            className="mt-2 w-full rounded-control border border-border bg-bg-card px-1.5 py-1 text-meta text-text"
          >
            {current === -1 && <option value={-1}>{repeatText(repeat)}</option>}
            {choices.map((option, index) => (
              <option key={option.label} value={index}>
                {option.label}
              </option>
            ))}
          </select>
        )}
        <p className="mt-1.5 text-caption text-text-secondary" data-plan-draw-when>
          {when}
          {kind === 'task'
            ? projectName ? ` · ${projectName}` : ''
            : ' · not a task: shows here and counts as busy'}
        </p>
        {kind === 'event' && read && read.title !== title.trim() && (
          <p className="mt-0.5 truncate text-caption text-text-secondary" data-plan-draw-read>
            Adds “{read.title}”
          </p>
        )}
      </form>
    </Popover>
  )
}
