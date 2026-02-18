import { useState, useRef, useEffect } from 'react'
import { X, Repeat } from 'lucide-react'
import { isNullDate } from '@/lib/date-utils'
import { detectRecurrencePreset, formatRecurrenceLabel } from '@/lib/recurrence'
import { RecurrencePickerPopover } from './RecurrencePickerPopover'

interface DatePickerPopoverProps {
  currentDate: string
  onDateChange: (isoDate: string) => void
  onClose: () => void
  repeatAfter?: number
  repeatMode?: number
  onRecurrenceChange?: (repeatAfter: number, repeatMode: number) => void
}

export function DatePickerPopover({
  currentDate,
  onDateChange,
  onClose,
  repeatAfter = 0,
  repeatMode = 0,
  onRecurrenceChange,
}: DatePickerPopoverProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [dateValue, setDateValue] = useState(
    isNullDate(currentDate) ? '' : currentDate.slice(0, 10)
  )
  const [showRecurrence, setShowRecurrence] = useState(false)

  const hasRecurrence = detectRecurrencePreset(repeatAfter, repeatMode) !== 'none'

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onClose])

  const applyDate = (dateStr: string) => {
    if (!dateStr) {
      onDateChange('0001-01-01T00:00:00Z')
    } else {
      onDateChange(new Date(dateStr + 'T00:00:00').toISOString())
    }
    onClose()
  }

  const today = new Date()
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)
  const nextWeek = new Date(today)
  nextWeek.setDate(today.getDate() + (7 - today.getDay() + 1))

  const fmt = (d: Date) => d.toISOString().slice(0, 10)

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full z-50 mt-1 w-56 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 shadow-lg"
    >
      <div className="mb-2 flex flex-col gap-1">
        <button
          type="button"
          onClick={() => applyDate(fmt(today))}
          className="rounded px-2 py-1.5 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
        >
          Today
        </button>
        <button
          type="button"
          onClick={() => applyDate(fmt(tomorrow))}
          className="rounded px-2 py-1.5 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
        >
          Tomorrow
        </button>
        <button
          type="button"
          onClick={() => applyDate(fmt(nextWeek))}
          className="rounded px-2 py-1.5 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
        >
          Next Week
        </button>
      </div>

      <div className="border-t border-[var(--border-color)] pt-2">
        <input
          type="date"
          value={dateValue}
          onChange={(e) => {
            setDateValue(e.target.value)
            if (e.target.value) applyDate(e.target.value)
          }}
          className="w-full rounded border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1.5 text-xs text-[var(--text-primary)] focus:border-[var(--accent-blue)] focus:outline-none"
        />
      </div>

      {!isNullDate(currentDate) && (
        <button
          type="button"
          onClick={() => applyDate('')}
          className="mt-2 flex w-full items-center gap-1 rounded px-2 py-1.5 text-xs text-red-500 hover:bg-red-500/10"
        >
          <X className="h-3 w-3" />
          Clear date
        </button>
      )}

      {/* Repeat row */}
      {onRecurrenceChange && (
        <div className="relative mt-2 border-t border-[var(--border-color)] pt-2">
          <button
            type="button"
            onClick={() => setShowRecurrence(!showRecurrence)}
            className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
          >
            <Repeat className="h-3 w-3 text-[var(--text-secondary)]" />
            <span className="flex-1">Repeat</span>
            {hasRecurrence && (
              <span className="text-2xs font-medium text-[var(--accent-blue)]">
                {formatRecurrenceLabel(repeatAfter, repeatMode)}
              </span>
            )}
          </button>

          {showRecurrence && (
            <RecurrencePickerPopover
              repeatAfter={repeatAfter}
              repeatMode={repeatMode}
              onRecurrenceChange={onRecurrenceChange}
              onClose={() => setShowRecurrence(false)}
            />
          )}
        </div>
      )}
    </div>
  )
}
