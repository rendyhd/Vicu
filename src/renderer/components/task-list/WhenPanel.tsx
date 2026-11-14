import { useId, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react'
import { cn } from '@/lib/cn'
import { toLocalDate, type LocalDate } from '@/lib/due-dates'
import { useDateFormat } from '@/hooks/use-date-format'
import { MonthCalendar } from './MonthCalendar'
import {
  TIME_CHOICES,
  focusStaysInside,
  parseTimeText,
  parseWhenText,
  quickChoices,
  timeLabel,
  whenText,
  withDate,
  withTime,
  type WhenValue,
} from '@/lib/when-logic'
import { useWeekStart } from '@/hooks/use-week-start'

export interface WhenPanelChange {
  /** True when the pick finishes the job (a quick choice, Enter in the text field). */
  commit: boolean
}

interface WhenPanelProps {
  /** The picked day and time. The panel shows it; the caller keeps it. */
  value: WhenValue
  onChange: (value: WhenValue, options: WhenPanelChange) => void
  /** "Now" for the quick choices and for reading typed text. Defaults to the time the panel opened. */
  now?: Date
}

/**
 * The When panel (card 3.4a1): a text field read by the quick-add parser with a live preview, quick
 * choices, a month grid and a row of times. It has no popover of its own; WhenPopover and the
 * reminder picker put it in one. A day without a time is date-only; the caller turns the value
 * into a due date with `dueOfWhenValue`.
 */
export function WhenPanel({ value, onChange, now: nowProp }: WhenPanelProps) {
  const fmt = useDateFormat()
  const [opened] = useState(() => new Date())
  const now = nowProp ?? opened
  const today = toLocalDate(now)
  const ids = useId()

  const [text, setText] = useState(() => whenText(value, now, fmt))
  // What the text reads as while the user types. It is shown in the grid and the time row but only
  // reaches the caller on Enter.
  const [typed, setTyped] = useState<WhenValue | null>(null)
  const selected = typed ?? value

  // A day chosen or typed turns the month grid to it.
  const [reveal, setReveal] = useState<{ date: LocalDate } | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const [customTime, setCustomTime] = useState('')
  const [customInvalid, setCustomInvalid] = useState(false)

  const weekStart = useWeekStart()
  const choices = useMemo(() => quickChoices(today, fmt, weekStart), [today, fmt, weekStart])

  const showDay = (date: LocalDate) => setReveal({ date })

  const apply = (next: WhenValue, commit: boolean) => {
    setTyped(null)
    setText(whenText(next, now, fmt))
    if (next.date) showDay(next.date)
    onChange(next, { commit })
  }

  const onText = (raw: string) => {
    setText(raw)
    const parsed = parseWhenText(raw, now, fmt.locale, value.date)
    setTyped(parsed ? parsed.value : null)
    if (parsed?.value.date) showDay(parsed.value.date)
  }

  const onTextKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
    event.preventDefault()
    if (typed) apply(typed, true)
  }

  // Enter confirms the typed time. Leaving the field for another control of the same popover (Tab to
  // Repeat, a click on a day) confirms it too; Escape and a press outside blur it with focus going
  // elsewhere, and discard it.
  const onCustomBlur = (event: FocusEvent<HTMLInputElement>) => {
    const surface = panelRef.current?.closest('[popover]') ?? panelRef.current
    if (focusStaysInside(surface, event.relatedTarget)) commitCustomTime()
  }

  const commitCustomTime = () => {
    if (!customTime.trim()) {
      setCustomInvalid(false)
      return
    }
    const time = parseTimeText(customTime)
    setCustomInvalid(time === null)
    if (time === null) return
    setCustomTime('')
    apply(withTime(selected, time, today), false)
  }

  const typedHint = (() => {
    if (!text.trim() || text === whenText(selected, now, fmt)) return null
    return typed ? `${whenText(typed, now, fmt)}, Enter to set` : 'No date found'
  })()

  const timeIsPreset = selected.time !== null && (TIME_CHOICES as readonly string[]).includes(selected.time)

  return (
    // Plain keys stay in the panel: the list behind it has window-level shortcuts (Enter opens a task,
    // the arrows move its focus) that would otherwise act on a key meant for the grid.
    <div ref={panelRef} className="flex flex-col gap-2" onKeyDown={keepInPanel}>
      <div>
        <input
          type="text"
          data-autofocus
          aria-label="Date and time"
          aria-describedby={`${ids}-preview`}
          aria-invalid={typedHint === 'No date found'}
          placeholder="Type a day, a date or a time"
          value={text}
          onChange={(e) => onText(e.target.value)}
          onKeyDown={onTextKey}
          onFocus={(e) => e.currentTarget.select()}
          spellCheck={false}
          autoComplete="off"
          className="w-full rounded-control border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1.5 text-meta text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]"
        />
        <p id={`${ids}-preview`} role="status" aria-live="polite" className="mt-1 min-h-4 px-0.5 text-caption text-[var(--text-secondary)]" data-testid="when-preview">
          {typedHint}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-x-1" role="group" aria-label="Quick choices">
        {choices.map((choice) => (
          <button
            key={choice.id}
            type="button"
            onClick={() => apply(withDate(selected, choice.date), true)}
            className="flex min-h-7 items-center justify-between gap-2 rounded-control px-2 py-1 text-left text-meta text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
          >
            <span>{choice.label}</span>
            <span className="text-[var(--text-secondary)]">{choice.hint}</span>
          </button>
        ))}
      </div>

      <div className="border-t border-[var(--border-color)] pt-2">
        <MonthCalendar
          selected={selected.date}
          today={today}
          reveal={reveal}
          onPick={(date) => apply(withDate(selected, date), false)}
        />
      </div>

      <div className="border-t border-[var(--border-color)] pt-2" role="group" aria-label="Time">
        <div className="flex flex-wrap items-center gap-1">
          <TimeChip pressed={selected.time === null} onClick={() => apply(withTime(selected, null, today), false)}>
            None
          </TimeChip>
          {TIME_CHOICES.map((time) => (
            <TimeChip key={time} pressed={selected.time === time} onClick={() => apply(withTime(selected, time, today), false)}>
              {timeLabel(time, fmt)}
            </TimeChip>
          ))}
          <input
            type="text"
            aria-label="Custom time"
            aria-invalid={customInvalid}
            placeholder={selected.time !== null && !timeIsPreset ? timeLabel(selected.time, fmt) : 'Custom time'}
            value={customTime}
            onChange={(e) => { setCustomTime(e.target.value); setCustomInvalid(false) }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
              e.preventDefault()
              commitCustomTime()
            }}
            onBlur={onCustomBlur}
            autoComplete="off"
            spellCheck={false}
            className={cn(
              'h-7 min-w-[5.5rem] flex-1 rounded-chip border bg-[var(--bg-secondary)] px-2.5 text-chip text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]',
              selected.time !== null && !timeIsPreset ? 'border-[var(--accent-blue)] placeholder:text-[var(--text-primary)]' : 'border-[var(--border-color)]',
              customInvalid && 'border-danger',
            )}
          />
        </div>
      </div>
    </div>
  )
}

function keepInPanel(event: KeyboardEvent<HTMLElement>): void {
  if (!event.ctrlKey && !event.metaKey && event.key !== 'Escape') event.stopPropagation()
}

function TimeChip({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        'h-7 rounded-chip border px-2.5 text-chip transition-colors',
        pressed
          ? 'border-transparent bg-accent-fill text-on-accent'
          : 'border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]',
      )}
    >
      {children}
    </button>
  )
}
