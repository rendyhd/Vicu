import { useState, type RefObject } from 'react'
import { Popover, type PopoverCloseReason } from '../overlay/Popover'

interface DurationPickerPopoverProps {
  anchorRef: RefObject<HTMLElement | null>
  durationMinutes: number | null
  onDurationChange: (minutes: number | null) => void
  onClose: (reason?: PopoverCloseReason) => void
}

/** Edit the task's duration in its canonical unit: whole minutes. */
export function DurationPickerPopover({
  anchorRef,
  durationMinutes,
  onDurationChange,
  onClose,
}: DurationPickerPopoverProps) {
  const [value, setValue] = useState(durationMinutes === null ? '' : String(durationMinutes))
  const minutes = Number(value)
  const valid = value.trim() !== '' && Number.isSafeInteger(minutes) && minutes > 0

  const apply = () => {
    if (!valid) return
    onDurationChange(minutes)
    onClose()
  }

  return (
    <Popover anchorRef={anchorRef} onClose={onClose} label="Duration" role="dialog" className="w-56 p-3">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          apply()
        }}
      >
        <label htmlFor="task-duration-minutes" className="mb-1 block text-meta text-text-secondary">
          Duration in minutes
        </label>
        <input
          id="task-duration-minutes"
          data-autofocus
          type="number"
          min={1}
          step={1}
          inputMode="numeric"
          aria-invalid={!valid}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="45"
          className="w-full rounded-control border border-border bg-[var(--bg-secondary)] px-2 py-1.5 text-meta text-text focus:outline-none"
        />
        <div className="mt-3 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => {
              onDurationChange(null)
              onClose()
            }}
            className="rounded-control px-2 py-1 text-meta text-text-secondary hover:bg-bg-hover hover:text-text"
          >
            Clear
          </button>
          <button
            type="submit"
            disabled={!valid}
            className="rounded-control bg-accent-fill px-3 py-1 text-meta text-on-accent disabled:opacity-40"
          >
            Apply
          </button>
        </div>
      </form>
    </Popover>
  )
}
