import type { RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import type { TranslationKey } from '../../../shared/i18n'
import { Check } from 'lucide-react'
import { Popover, type PopoverCloseReason } from '../overlay/Popover'
import { PriorityMark } from '../shared/PriorityMark'

interface PriorityPickerPopoverProps {
  anchorRef: RefObject<HTMLElement | null>
  currentPriority: number
  onPriorityChange: (priority: number) => void
  onClose: (reason?: PopoverCloseReason) => void
}

export const PRIORITY_OPTIONS: { value: number; label: TranslationKey }[] = [
  { value: 0, label: 'task.priority.none' },
  { value: 1, label: 'task.priority.low' },
  { value: 2, label: 'task.priority.medium' },
  { value: 3, label: 'task.priority.high' },
  { value: 4, label: 'task.priority.urgent' },
]

export function PriorityPickerPopover({
  anchorRef,
  currentPriority,
  onPriorityChange,
  onClose,
}: PriorityPickerPopoverProps) {
  const { t } = useTranslation()
  const handleSelect = (value: number) => {
    onPriorityChange(value)
    onClose()
  }

  return (
    <Popover anchorRef={anchorRef} onClose={onClose} role="listbox" label={t('task.priority.label')} className="w-40 py-1">
      {PRIORITY_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="option"
          tabIndex={-1}
          aria-selected={option.value === currentPriority}
          onClick={() => handleSelect(option.value)}
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
        >
          {option.value > 0 ? (
            <PriorityMark priority={option.value} decorative />
          ) : (
            <span className="h-3.5 w-3.5 shrink-0" />
          )}
          <span className="min-w-0 flex-1 truncate">{t(option.label)}</span>
          {option.value === currentPriority && (
            <Check className="h-3.5 w-3.5 shrink-0 text-[var(--accent-blue)]" />
          )}
        </button>
      ))}
    </Popover>
  )
}
