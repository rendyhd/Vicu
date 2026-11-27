import { useId, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/cn'
import { isNoDueDate, localDateOf, startOfLocalDay, toLocalDate, type LocalDate } from '@/lib/due-dates'
import { useDateFormat } from '@/hooks/use-date-format'
import { MonthCalendar } from './MonthCalendar'
import {
  dayChoiceHint,
  focusStaysInside,
  parseTimeText,
  parseWhenText,
  timeLabel,
  whenText,
  whenValueOfDue,
  withDate,
  withTime,
  type WhenValue,
} from '@/lib/when-logic'
import { useWeekStart } from '@/hooks/use-week-start'
import { useWhenChoices } from '@/hooks/use-when-choices'
import { formatWeekdayDay } from '@/lib/date-display'
import { dayChoices, moveBy, moveDay, moveStep } from '../../../shared/when-choices'

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
  /**
   * The task's stored due date, when the panel edits an existing task: the panel then offers Move
   * by (cross-app semantics 23.3) while it has a date. Never given while a new task is entered.
   */
  moveFrom?: string | null
}

/**
 * The When panel (card 3.4a1): a text field read by the quick-add parser with a live preview, quick
 * choices, a month grid and a row of times. It has no popover of its own; WhenPopover and the
 * reminder picker put it in one. A day without a time is date-only; the caller turns the value
 * into a due date with `dueOfWhenValue`.
 */
export function WhenPanel({ value, onChange, now: nowProp, moveFrom }: WhenPanelProps) {
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
  // The account's day choices and times of day (section 23).
  const whenChoices = useWhenChoices()
  const { t } = useTranslation()
  const choices = useMemo(
    () => dayChoices(whenChoices.days, now, whenChoices.times, weekStart),
    [whenChoices.days, whenChoices.times, now, weekStart],
  )
  const movable = moveFrom && !isNoDueDate(moveFrom) && whenChoices.moveBy.length > 0 ? moveFrom : null

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
    return typed ? t('when.setHint', { when: whenText(typed, now, fmt) }) : t('when.noDateFound')
  })()

  const timeIsPreset = selected.time !== null && whenChoices.times.some((t) => t.time === selected.time)

  return (
    // Plain keys stay in the panel: the list behind it has window-level shortcuts (Enter opens a task,
    // the arrows move its focus) that would otherwise act on a key meant for the grid.
    <div ref={panelRef} className="flex flex-col gap-2" onKeyDown={keepInPanel}>
      <div>
        <input
          type="text"
          data-autofocus
          aria-label={t('when.dateAndTime')}
          aria-describedby={`${ids}-preview`}
          aria-invalid={typedHint === t('when.noDateFound')}
          placeholder={t('when.typePlaceholder')}
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

      {choices.length > 0 && (
        <div className="grid grid-cols-2 gap-x-1" role="group" aria-label={t('when.quickChoices')}>
          {choices.map((choice) => (
            <button
              key={choice.id}
              type="button"
              // A choice with its own time sets both; the others keep the time picked.
              onClick={() => apply(choice.time ? { date: choice.date, time: choice.time } : withDate(selected, choice.date), true)}
              className="flex min-h-7 items-center justify-between gap-2 rounded-control px-2 py-1 text-left text-meta text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
            >
              <span>{choice.label}</span>
              <span className="text-[var(--text-secondary)]">{dayChoiceHint(choice, fmt)}</span>
            </button>
          ))}
        </div>
      )}

      {movable && (
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label={t('when.moveBy')}>
          {whenChoices.moveBy.map((step) => {
            const day = moveDay(localDateOf(movable), step, today)
            return (
              <TimeChip key={step} pressed={false} onClick={() => apply(whenValueOfDue(moveBy(movable, step, today)), true)}>
                {`${moveStep(step).label} · ${formatWeekdayDay(startOfLocalDay(day), fmt)}`}
              </TimeChip>
            )
          })}
        </div>
      )}

      <div className="border-t border-[var(--border-color)] pt-2">
        <MonthCalendar
          selected={selected.date}
          today={today}
          reveal={reveal}
          onPick={(date) => apply(withDate(selected, date), false)}
        />
      </div>

      <div className="border-t border-[var(--border-color)] pt-2" role="group" aria-label={t('when.time')}>
        <div className="flex flex-wrap items-center gap-1">
          <TimeChip pressed={selected.time === null} onClick={() => apply(withTime(selected, null, today), false)}>
            {t('when.none')}
          </TimeChip>
          {whenChoices.times.map(({ name, time }) => (
            <TimeChip key={time} pressed={selected.time === time} onClick={() => apply(withTime(selected, time, today), false)}>
              {`${name} ${timeLabel(time, fmt)}`}
            </TimeChip>
          ))}
          <input
            type="text"
            aria-label={t('when.customTime')}
            aria-invalid={customInvalid}
            placeholder={selected.time !== null && !timeIsPreset ? timeLabel(selected.time, fmt) : t('when.customTime')}
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
