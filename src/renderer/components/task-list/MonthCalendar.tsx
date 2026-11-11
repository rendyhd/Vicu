import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/cn'
import { startOfLocalDay, type LocalDate } from '@/lib/due-dates'
import { formatFullDateWithYear, formatMonthYear, formatWeekdayShort } from '@/lib/date-display'
import { useDateFormat } from '@/hooks/use-date-format'
import { addMonths, monthGrid, monthStart, moveGridFocus } from '@/lib/when-logic'

interface MonthCalendarProps {
  /** The picked day, ringed in the accent fill. */
  selected: LocalDate | null
  today: LocalDate
  /**
   * A day to show: the month opens on it, and each new object (a day typed or chosen outside the grid)
   * turns the calendar to it again. Without one it opens on `selected`, else today.
   */
  reveal?: { date: LocalDate } | null
  onPick: (date: LocalDate) => void
  /** A day that cannot be picked (a past day for a time block). */
  isDisabled?: (date: LocalDate) => boolean
}

const MONDAY = new Date(2026, 9, 5)

/**
 * A month of six Monday-first weeks (`monthGrid`, the same grid as Android's MonthCalendar) with the
 * month arrows and arrow-key movement. The When panel and the planner's day picker use it.
 */
export function MonthCalendar({ selected, today, reveal, onPick, isDisabled }: MonthCalendarProps) {
  const fmt = useDateFormat()
  const opening = reveal?.date ?? selected ?? today
  const [viewMonth, setViewMonth] = useState(() => monthStart(opening))
  const [focusDate, setFocusDate] = useState<LocalDate>(opening)
  const gridRef = useRef<HTMLDivElement>(null)
  const focusAfterRender = useRef(false)

  // A day chosen or typed outside the grid turns the calendar to it.
  const [lastReveal, setLastReveal] = useState(reveal)
  if (reveal !== lastReveal) {
    setLastReveal(reveal)
    if (reveal) {
      setFocusDate(reveal.date)
      setViewMonth(monthStart(reveal.date))
    }
  }

  useEffect(() => {
    if (!focusAfterRender.current) return
    focusAfterRender.current = false
    gridRef.current?.querySelector<HTMLElement>(`[data-date="${focusDate}"]`)?.focus()
  }, [focusDate, viewMonth])

  const grid = useMemo(() => monthGrid(viewMonth), [viewMonth])
  const weekdayNames = useMemo(
    () => Array.from({ length: 7 }, (_, i) => formatWeekdayShort(new Date(MONDAY.getFullYear(), MONDAY.getMonth(), MONDAY.getDate() + i), fmt)),
    [fmt],
  )

  const showDay = (date: LocalDate) => {
    setFocusDate(date)
    setViewMonth(monthStart(date))
  }

  const onGridKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return
    const next = moveGridFocus(focusDate, event.key, event.shiftKey)
    if (!next) return
    event.preventDefault()
    focusAfterRender.current = true
    showDay(next)
  }

  const shiftMonth = (months: number) => {
    setViewMonth(monthStart(addMonths(viewMonth, months)))
    setFocusDate(addMonths(focusDate, months))
  }

  const monthLabel = formatMonthYear(startOfLocalDay(viewMonth), fmt)

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="px-1 text-section text-[var(--text-primary)]" aria-live="polite">{monthLabel}</span>
        <div className="flex gap-0.5">
          <button
            type="button"
            aria-label="Previous month"
            onClick={() => shiftMonth(-1)}
            className="flex h-7 w-7 items-center justify-center rounded-control text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Next month"
            onClick={() => shiftMonth(1)}
            className="flex h-7 w-7 items-center justify-center rounded-control text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div ref={gridRef} role="grid" aria-label={monthLabel} onKeyDown={onGridKey}>
        <div role="row" className="grid grid-cols-7">
          {weekdayNames.map((name) => (
            <div key={name} role="columnheader" className="py-1 text-center text-caption text-[var(--text-secondary)]">
              {name}
            </div>
          ))}
        </div>
        {grid.map((week) => (
          <div key={week[0].date} role="row" className="grid grid-cols-7">
            {week.map((day) => {
              const isSelected = day.date === selected
              const isToday = day.date === today
              const disabled = isDisabled?.(day.date) === true
              return (
                <div key={day.date} role="gridcell" aria-selected={isSelected} className="flex justify-center">
                  <button
                    type="button"
                    data-date={day.date}
                    tabIndex={day.date === focusDate ? 0 : -1}
                    aria-label={formatFullDateWithYear(startOfLocalDay(day.date), fmt)}
                    aria-current={isToday ? 'date' : undefined}
                    aria-disabled={disabled || undefined}
                    onClick={() => {
                      setFocusDate(day.date)
                      if (!disabled) onPick(day.date)
                    }}
                    className={cn(
                      'flex h-7 w-7 items-center justify-center rounded-full text-meta transition-colors',
                      disabled && 'cursor-not-allowed opacity-50',
                      isSelected
                        ? 'bg-accent-fill text-on-accent'
                        : cn(
                            !disabled && 'hover:bg-[var(--bg-hover)]',
                            day.inMonth ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]',
                          ),
                      isToday && 'ring-1 ring-inset ring-[var(--accent-blue)]',
                    )}
                  >
                    {Number(day.date.slice(8, 10))}
                  </button>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
