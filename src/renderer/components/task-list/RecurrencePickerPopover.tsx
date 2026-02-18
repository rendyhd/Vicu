import { useState, useRef, useEffect } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'
import {
  detectRecurrencePreset,
  formatRecurrenceLabel,
  getPresetValues,
  type RecurrencePreset,
} from '@/lib/recurrence'

interface RecurrencePickerPopoverProps {
  repeatAfter: number
  repeatMode: number
  onRecurrenceChange: (repeatAfter: number, repeatMode: number) => void
  onClose: () => void
}

type CustomUnit = 'days' | 'weeks'

const DAY = 86400
const WEEK = 604800

export function RecurrencePickerPopover({
  repeatAfter,
  repeatMode,
  onRecurrenceChange,
  onClose,
}: RecurrencePickerPopoverProps) {
  const ref = useRef<HTMLDivElement>(null)
  const activePreset = detectRecurrencePreset(repeatAfter, repeatMode)
  const hasRecurrence = activePreset !== 'none'

  // Custom interval state
  const [showCustom, setShowCustom] = useState(activePreset === 'custom')
  const [customValue, setCustomValue] = useState(() => {
    if (activePreset !== 'custom' || repeatMode === 1) return 2
    if (repeatAfter % WEEK === 0) return repeatAfter / WEEK
    if (repeatAfter % DAY === 0) return repeatAfter / DAY
    return Math.round(repeatAfter / DAY)
  })
  const [customUnit, setCustomUnit] = useState<CustomUnit>(() => {
    if (activePreset !== 'custom') return 'days'
    if (repeatAfter % WEEK === 0 && repeatAfter >= WEEK) return 'weeks'
    return 'days'
  })
  const [fromCompletion, setFromCompletion] = useState(repeatMode === 2)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onClose])

  const applyPreset = (preset: 'daily' | 'weekly' | 'monthly') => {
    const values = getPresetValues(preset)
    onRecurrenceChange(values.repeat_after, values.repeat_mode)
    setShowCustom(false)
  }

  const applyCustom = () => {
    const val = Math.max(1, Math.round(customValue))
    const seconds = customUnit === 'weeks' ? val * WEEK : val * DAY
    const mode = fromCompletion ? 2 : 0
    onRecurrenceChange(seconds, mode)
  }

  const clearRecurrence = () => {
    onRecurrenceChange(0, 0)
  }

  const presetButtons: { key: 'daily' | 'weekly' | 'monthly'; label: string }[] = [
    { key: 'daily', label: 'Daily' },
    { key: 'weekly', label: 'Weekly' },
    { key: 'monthly', label: 'Monthly' },
  ]

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full z-[60] mt-1 w-60 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 shadow-lg"
    >
      {/* Current recurrence display */}
      {hasRecurrence && (
        <div className="mb-2 flex items-center justify-between rounded bg-[var(--bg-hover)] px-2 py-1.5">
          <span className="text-xs font-medium text-[var(--text-primary)]">
            {formatRecurrenceLabel(repeatAfter, repeatMode)}
          </span>
          <button
            type="button"
            onClick={clearRecurrence}
            className="text-[var(--text-secondary)] hover:text-red-500"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* Presets */}
      <div className="flex flex-col gap-1">
        {presetButtons.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => applyPreset(key)}
            className={cn(
              'rounded px-2 py-1.5 text-left text-xs transition-colors',
              activePreset === key
                ? 'bg-[var(--accent-blue)]/10 font-medium text-[var(--accent-blue)]'
                : 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
            )}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setShowCustom(!showCustom)}
          className={cn(
            'rounded px-2 py-1.5 text-left text-xs transition-colors',
            showCustom || activePreset === 'custom'
              ? 'bg-[var(--accent-blue)]/10 font-medium text-[var(--accent-blue)]'
              : 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
          )}
        >
          Custom...
        </button>
      </div>

      {/* Custom interval */}
      {showCustom && (
        <div className="mt-2 border-t border-[var(--border-color)] pt-2">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-[var(--text-secondary)]">Every</span>
            <input
              type="number"
              min={1}
              max={365}
              value={customValue}
              onChange={(e) => setCustomValue(Number(e.target.value))}
              className="w-14 rounded border border-[var(--border-color)] bg-[var(--bg-secondary)] px-1.5 py-1 text-center text-xs text-[var(--text-primary)] focus:border-[var(--accent-blue)] focus:outline-none"
            />
            <select
              value={customUnit}
              onChange={(e) => setCustomUnit(e.target.value as CustomUnit)}
              className="rounded border border-[var(--border-color)] bg-[var(--bg-secondary)] px-1.5 py-1 text-xs text-[var(--text-primary)] focus:border-[var(--accent-blue)] focus:outline-none"
            >
              <option value="days">days</option>
              <option value="weeks">weeks</option>
            </select>
          </div>

          <label className="mt-2 flex items-center gap-1.5 px-0.5">
            <input
              type="checkbox"
              checked={fromCompletion}
              onChange={(e) => setFromCompletion(e.target.checked)}
              className="h-3 w-3 rounded border-[var(--border-color)] accent-[var(--accent-blue)]"
            />
            <span className="text-2xs text-[var(--text-secondary)]">From completion date</span>
          </label>

          <button
            type="button"
            onClick={applyCustom}
            className="mt-2 w-full rounded bg-[var(--accent-blue)] px-2 py-1.5 text-xs text-white hover:opacity-90"
          >
            Apply
          </button>
        </div>
      )}
    </div>
  )
}
