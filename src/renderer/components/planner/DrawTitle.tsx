import { useMemo, useRef, useState, type RefObject } from 'react'
import { Popover } from '@/components/overlay/Popover'
import { cn } from '@/lib/cn'
import { useDateFormat } from '@/hooks/use-date-format'
import { formatBlockRange } from '../../../shared/date-display'
import type { LocalDate } from '../../../shared/due-dates'
import { repeatChoices, type EventRepeat } from '../../../shared/plan-events'

export type DrawnKind = 'task' | 'event'

interface DrawTitleProps {
  anchorRef: RefObject<HTMLElement | null>
  day: LocalDate
  start: Date
  end: Date
  /** The project a task goes into, for the line under the field. */
  projectName?: string
  onSubmit: (title: string, kind: DrawnKind, repeat: EventRepeat) => void
  onCancel: () => void
}

/**
 * The name of what was drawn on an empty time: a task (the default), or an Event, a time you are
 * not available that can repeat. Enter adds it; Escape or a press outside drops it.
 */
export function DrawTitle({ anchorRef, day, start, end, projectName, onSubmit, onCancel }: DrawTitleProps) {
  const fmt = useDateFormat()
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<DrawnKind>('task')
  const choices = useMemo(() => repeatChoices(day), [day])
  const [choice, setChoice] = useState(0)
  const submitted = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const submit = () => {
    const text = title.trim()
    if (!text) {
      onCancel()
      return
    }
    submitted.current = true
    onSubmit(text, kind, choices[choice].repeat)
  }
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
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={kind === 'task' ? 'New task' : 'New event, such as Manager call'}
          aria-label={kind === 'task' ? 'Task title' : 'Event title'}
          className="w-full rounded-control border border-border bg-transparent px-2 py-1.5 text-task-title text-text placeholder:text-text-secondary"
        />
        {kind === 'event' && (
          <select
            aria-label="Repeat"
            data-plan-draw-repeat
            value={choice}
            onChange={(event) => setChoice(Number(event.target.value))}
            onKeyDown={(event) => {
              // Enter on the list adds the event, as it does in the field.
              if (event.key === 'Enter') {
                event.preventDefault()
                submit()
              }
            }}
            className="mt-2 w-full rounded-control border border-border bg-bg-card px-1.5 py-1 text-meta text-text"
          >
            {choices.map((option, index) => (
              <option key={option.label} value={index}>
                {option.label}
              </option>
            ))}
          </select>
        )}
        <p className="mt-1.5 text-caption text-text-secondary">
          {formatBlockRange(start, end, fmt)}
          {kind === 'task'
            ? projectName ? ` · ${projectName}` : ''
            : ' · not a task: shows here and counts as busy'}
        </p>
      </form>
    </Popover>
  )
}
