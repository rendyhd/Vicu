import { useState, useRef, type RefObject } from 'react'
import { X, Repeat } from 'lucide-react'
import {
  datePickerPresets,
  isNullDate,
  localDateInputValue,
} from '@/lib/date-utils'
import { dateOnlyDue } from '@/lib/due-dates'
import { NULL_DATE } from '@/lib/constants'
import { detectRecurrencePreset, formatRecurrenceLabel } from '@/lib/recurrence'
import { Popover, type PopoverCloseReason } from '../overlay/Popover'
import { RecurrencePickerPopover } from './RecurrencePickerPopover'

interface DatePickerPopoverProps {
  anchorRef: RefObject<HTMLElement | null>
  /** Where it opens relative to the anchor; a menu entry opens it beside the menu. */
  placement?: 'bottom-start' | 'right-start'
  currentDate: string
  onDateChange: (isoDate: string) => void
  onClose: (reason?: PopoverCloseReason) => void
  repeatAfter?: number
  repeatMode?: number
  onRecurrenceChange?: (repeatAfter: number, repeatMode: number) => void
}

export function DatePickerPopover({
  anchorRef,
  placement = 'bottom-start',
  currentDate,
  onDateChange,
  onClose,
  repeatAfter = 0,
  repeatMode = 0,
  onRecurrenceChange,
}: DatePickerPopoverProps) {
  const repeatButtonRef = useRef<HTMLButtonElement>(null)
  const [dateValue, setDateValue] = useState(localDateInputValue(currentDate))
  const [showRecurrence, setShowRecurrence] = useState(false)

  const hasRecurrence = detectRecurrencePreset(repeatAfter, repeatMode) !== 'none'

  // A picked day is date-only: local 23:59:59 of that calendar day, never built from UTC.
  const applyDate = (dateStr: string) => {
    onDateChange(dateStr ? dateOnlyDue(dateStr) : NULL_DATE)
    onClose()
  }

  const presets = datePickerPresets()

  return (
    <Popover anchorRef={anchorRef} onClose={onClose} placement={placement} label="Schedule" className="w-56 p-3">
      <div className="mb-2 flex flex-col gap-1">
        <button
          type="button"
          onClick={() => applyDate(presets.today)}
          className="rounded-control px-2 py-1.5 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
        >
          Today
        </button>
        <button
          type="button"
          onClick={() => applyDate(presets.tomorrow)}
          className="rounded-control px-2 py-1.5 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
        >
          Tomorrow
        </button>
        <button
          type="button"
          onClick={() => applyDate(presets.nextWeek)}
          className="rounded-control px-2 py-1.5 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
        >
          Next Week
        </button>
      </div>

      <div className="border-t border-[var(--border-color)] pt-2">
        <input
          type="date"
          aria-label="Pick a date"
          value={dateValue}
          onChange={(e) => {
            setDateValue(e.target.value)
            if (e.target.value) applyDate(e.target.value)
          }}
          className="w-full rounded-control border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1.5 text-xs text-[var(--text-primary)]"
        />
      </div>

      {!isNullDate(currentDate) && (
        <button
          type="button"
          onClick={() => applyDate('')}
          className="mt-2 flex w-full items-center gap-1 rounded-control px-2 py-1.5 text-xs text-danger hover:bg-danger/10"
        >
          <X className="h-3 w-3" />
          Clear date
        </button>
      )}

      {/* Repeat row */}
      {onRecurrenceChange && (
        <div className="relative mt-2 border-t border-[var(--border-color)] pt-2">
          <button
            ref={repeatButtonRef}
            type="button"
            aria-haspopup="dialog"
            aria-expanded={showRecurrence}
            onClick={() => setShowRecurrence(!showRecurrence)}
            className="flex w-full items-center gap-1.5 rounded-control px-2 py-1.5 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
          >
            <Repeat className="h-3 w-3 text-[var(--text-secondary)]" />
            <span className="flex-1">Repeat</span>
            {hasRecurrence && (
              <span className="text-caption font-medium text-[var(--accent-blue)]">
                {formatRecurrenceLabel(repeatAfter, repeatMode)}
              </span>
            )}
          </button>

          {/* Rendered inside this popover, so the browser treats it as nested: Escape and a press
              outside close the repeat panel first, a press inside the date panel keeps this one. */}
          {showRecurrence && (
            <RecurrencePickerPopover
              anchorRef={repeatButtonRef}
              repeatAfter={repeatAfter}
              repeatMode={repeatMode}
              onRecurrenceChange={onRecurrenceChange}
              onClose={() => setShowRecurrence(false)}
            />
          )}
        </div>
      )}
    </Popover>
  )
}
