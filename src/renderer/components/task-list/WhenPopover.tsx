import { useRef, useState, type RefObject } from 'react'
import { X, Repeat } from 'lucide-react'
import { NULL_DATE } from '@/lib/constants'
import { detectRecurrencePreset, formatRecurrenceLabel } from '@/lib/recurrence'
import { dueOfWhenValue, whenValueOfDue, type WhenValue } from '@/lib/when-logic'
import { Button } from '../shared/Button'
import { Popover, type PopoverCloseReason } from '../overlay/Popover'
import { RecurrencePickerPopover } from './RecurrencePickerPopover'
import { WhenPanel } from './WhenPanel'

interface WhenPopoverProps {
  anchorRef: RefObject<HTMLElement | null>
  /** Where it opens relative to the anchor; a menu entry opens it beside the menu. */
  placement?: 'bottom-start' | 'right-start'
  currentDate: string
  /** The new due date: a date-only value (local 23:59:59), a day with a time, or NULL_DATE to clear. */
  onDateChange: (isoDate: string) => void
  onClose: (reason?: PopoverCloseReason) => void
  repeatAfter?: number
  repeatMode?: number
  onRecurrenceChange?: (repeatAfter: number, repeatMode: number) => void
  /**
   * Show "Clear date" even though no date is picked here. A bulk edit opens with no date (the tasks
   * have different ones) and must still be able to clear them all.
   */
  allowClear?: boolean
}

/**
 * The Schedule popover: the When panel with Repeat and Clear in the footer. A day or time picked in
 * the grid is applied at once and the popover stays open for the next pick; a quick choice or Enter
 * in the text field applies and closes. Clearing sends the null date.
 */
export function WhenPopover({
  anchorRef,
  placement = 'bottom-start',
  currentDate,
  onDateChange,
  onClose,
  repeatAfter = 0,
  repeatMode = 0,
  onRecurrenceChange,
  allowClear = false,
}: WhenPopoverProps) {
  const repeatButtonRef = useRef<HTMLButtonElement>(null)
  const [value, setValue] = useState<WhenValue>(() => whenValueOfDue(currentDate))
  const [showRecurrence, setShowRecurrence] = useState(false)

  const hasRecurrence = detectRecurrencePreset(repeatAfter, repeatMode) !== 'none'
  const hasDate = value.date !== null

  const change = (next: WhenValue, { commit }: { commit: boolean }) => {
    setValue(next)
    const due = dueOfWhenValue(next)
    if (due) onDateChange(due)
    if (commit) onClose()
  }

  const clear = () => {
    onDateChange(NULL_DATE)
    onClose()
  }

  return (
    <Popover anchorRef={anchorRef} onClose={onClose} placement={placement} label="Schedule" className="w-72 p-3">
      <WhenPanel value={value} onChange={change} />

      {(hasDate || allowClear || onRecurrenceChange) && (
        <div className="relative mt-2 flex items-center justify-between gap-1 border-t border-[var(--border-color)] pt-2">
          {onRecurrenceChange ? (
            <Button
              ref={repeatButtonRef}
              variant="quiet"
              aria-haspopup="dialog"
              aria-expanded={showRecurrence}
              onClick={() => setShowRecurrence(!showRecurrence)}
              className="px-2"
            >
              <Repeat className="h-3.5 w-3.5" />
              <span>Repeat</span>
              {hasRecurrence && (
                <span className="text-caption text-[var(--accent-blue)]">{formatRecurrenceLabel(repeatAfter, repeatMode)}</span>
              )}
            </Button>
          ) : (
            <span />
          )}
          {(hasDate || allowClear) && (
            <Button variant="quiet" danger onClick={clear} className="px-2">
              <X className="h-3.5 w-3.5" />
              Clear date
            </Button>
          )}

          {/* Rendered inside this popover, so the browser treats it as nested: Escape and a press
              outside close the repeat panel first, a press inside the date panel keeps this one. */}
          {showRecurrence && onRecurrenceChange && (
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
