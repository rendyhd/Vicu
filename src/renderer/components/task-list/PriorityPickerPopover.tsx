import { useRef, useEffect } from 'react'
import { Check } from 'lucide-react'

interface PriorityPickerPopoverProps {
  currentPriority: number
  onPriorityChange: (priority: number) => void
  onClose: () => void
}

const PRIORITY_OPTIONS: { value: number; label: string; dot: string | null }[] = [
  { value: 0, label: 'None', dot: null },
  { value: 1, label: 'Low', dot: 'bg-accent-blue' },
  { value: 2, label: 'Medium', dot: 'bg-accent-yellow' },
  { value: 3, label: 'High', dot: 'bg-accent-orange' },
  { value: 4, label: 'Urgent', dot: 'bg-accent-red' },
]

export function PriorityPickerPopover({
  currentPriority,
  onPriorityChange,
  onClose,
}: PriorityPickerPopoverProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onClose])

  const handleSelect = (value: number) => {
    onPriorityChange(value)
    onClose()
  }

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full z-50 mt-1 w-40 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] py-1 shadow-lg"
    >
      {PRIORITY_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => handleSelect(option.value)}
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
        >
          {option.dot ? (
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${option.dot}`} />
          ) : (
            <span className="h-2.5 w-2.5 shrink-0" />
          )}
          <span className="min-w-0 flex-1 truncate">{option.label}</span>
          {option.value === currentPriority && (
            <Check className="h-3.5 w-3.5 shrink-0 text-[var(--accent-blue)]" />
          )}
        </button>
      ))}
    </div>
  )
}
