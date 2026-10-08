import type { RefObject } from 'react'
import { Check } from 'lucide-react'
import { Popover, type PopoverCloseReason } from '../overlay/Popover'
import { PriorityMark } from '../shared/PriorityMark'

interface PriorityPickerPopoverProps {
  anchorRef: RefObject<HTMLElement | null>
  currentPriority: number
  onPriorityChange: (priority: number) => void
  onClose: (reason?: PopoverCloseReason) => void
}

export const PRIORITY_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: 'None' },
  { value: 1, label: 'Low' },
  { value: 2, label: 'Medium' },
  { value: 3, label: 'High' },
  { value: 4, label: 'Urgent' },
]

export function PriorityPickerPopover({
  anchorRef,
  currentPriority,
  onPriorityChange,
  onClose,
}: PriorityPickerPopoverProps) {
  const handleSelect = (value: number) => {
    onPriorityChange(value)
    onClose()
  }

  return (
    <Popover anchorRef={anchorRef} onClose={onClose} role="listbox" label="Priority" className="w-40 py-1">
      {PRIORITY_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="option"
          aria-selected={option.value === currentPriority}
          onClick={() => handleSelect(option.value)}
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
        >
          {option.value > 0 ? (
            <PriorityMark priority={option.value} decorative />
          ) : (
            <span className="h-3.5 w-3.5 shrink-0" />
          )}
          <span className="min-w-0 flex-1 truncate">{option.label}</span>
          {option.value === currentPriority && (
            <Check className="h-3.5 w-3.5 shrink-0 text-[var(--accent-blue)]" />
          )}
        </button>
      ))}
    </Popover>
  )
}
