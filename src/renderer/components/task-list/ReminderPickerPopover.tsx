import { useState, type RefObject } from 'react'
import { X } from 'lucide-react'
import type { Task, TaskReminder } from '@/lib/vikunja-types'
import { NULL_DATE } from '@/lib/constants'
import { Popover, type PopoverCloseReason } from '../overlay/Popover'

interface ReminderPickerPopoverProps {
  anchorRef: RefObject<HTMLElement | null>
  task?: Task
  dueDate?: string
  reminders?: TaskReminder[]
  onReminderChange: (reminders: TaskReminder[]) => void
  onClose: (reason?: PopoverCloseReason) => void
}

const RELATIVE_PRESETS = [
  { label: 'At due time', offset: 0 },
  { label: '15 min before', offset: -900 },
  { label: '1 hour before', offset: -3600 },
  { label: '1 day before', offset: -86400 },
]

export function ReminderPickerPopover({ anchorRef, task, dueDate, reminders: controlledReminders, onReminderChange, onClose }: ReminderPickerPopoverProps) {
  const [customDateTime, setCustomDateTime] = useState('')

  const reminders = controlledReminders ?? task?.reminders ?? []
  const effectiveDueDate = dueDate ?? task?.due_date ?? NULL_DATE
  const hasDueDate = effectiveDueDate && effectiveDueDate !== NULL_DATE

  const addReminder = (date: Date) => {
    const newReminder: TaskReminder = { reminder: date.toISOString() }
    onReminderChange([...reminders, newReminder])
  }

  const addRelativeReminder = (offset: number) => {
    const dueTime = new Date(effectiveDueDate).getTime()
    const absoluteTime = new Date(dueTime + offset * 1000).toISOString()
    const newReminder: TaskReminder = {
      reminder: absoluteTime,
      relative_period: offset,
      relative_to: 'due_date',
    }
    onReminderChange([...reminders, newReminder])
  }

  const removeReminder = (index: number) => {
    onReminderChange(reminders.filter((_, i) => i !== index))
  }

  const handleAddCustom = () => {
    if (!customDateTime) return
    addReminder(new Date(customDateTime))
    setCustomDateTime('')
  }

  const now = new Date()

  const presets = [
    {
      label: 'In 1 hour',
      getDate: () => new Date(now.getTime() + 60 * 60 * 1000),
    },
    {
      label: 'Tomorrow 9 AM',
      getDate: () => {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0, 0)
        return d
      },
    },
    {
      label: 'In 3 days',
      getDate: () => new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000),
    },
  ]

  const formatReminder = (r: TaskReminder) => {
    if (r.relative_period !== undefined && r.relative_period !== null && r.relative_to) {
      return formatRelativeReminder(r.relative_period, r.relative_to)
    }
    const d = new Date(r.reminder)
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <Popover anchorRef={anchorRef} onClose={onClose} label="Reminders" className="w-64 p-3">
      {/* Existing reminders */}
      {reminders.length > 0 && (
        <div className="mb-2 flex flex-col gap-1">
          {reminders.map((r, i) => (
            <div
              key={`${r.reminder}-${i}`}
              className="flex items-center justify-between rounded-control px-2 py-1 text-xs text-[var(--text-primary)] bg-[var(--bg-hover)]"
            >
              <span>{formatReminder(r)}</span>
              <button
                type="button"
                onClick={() => removeReminder(i)}
                aria-label={`Remove reminder ${formatReminder(r)}`}
                title="Remove reminder"
                className="ml-2 text-[var(--text-secondary)] hover:text-danger"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Relative presets (when task has a due date) */}
      {hasDueDate && (
        <div className="mb-2 flex flex-col gap-1">
          <span className="px-2 text-caption font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            Relative to due date
          </span>
          {RELATIVE_PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => addRelativeReminder(p.offset)}
              className="rounded-control px-2 py-1.5 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      {/* Quick presets */}
      <div className="mb-2 flex flex-col gap-1">
        {hasDueDate && (
          <span className="px-2 text-caption font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            Absolute
          </span>
        )}
        {presets.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => addReminder(p.getDate())}
            className="rounded-control px-2 py-1.5 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Custom datetime */}
      <div className="border-t border-[var(--border-color)] pt-2">
        <input
          type="datetime-local"
          aria-label="Custom reminder time"
          value={customDateTime}
          onChange={(e) => setCustomDateTime(e.target.value)}
          className="w-full rounded-control border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1.5 text-xs text-[var(--text-primary)]"
        />
        <button
          type="button"
          onClick={handleAddCustom}
          disabled={!customDateTime}
          className="mt-1 w-full rounded-control bg-accent-fill px-2 py-1.5 text-xs text-on-accent hover:opacity-90 disabled:opacity-40"
        >
          Add reminder
        </button>
      </div>
    </Popover>
  )
}

function formatRelativeReminder(
  period: number,
  relativeTo: 'due_date' | 'start_date' | 'end_date'
): string {
  const target =
    relativeTo === 'start_date'
      ? 'start date'
      : relativeTo === 'end_date'
        ? 'end date'
        : 'due date'

  if (period === 0) return `At ${target}`

  const absSec = Math.abs(period)
  const direction = period < 0 ? 'before' : 'after'

  if (absSec < 60) return `${absSec}s ${direction} ${target}`
  if (absSec < 3600) return `${Math.round(absSec / 60)} min ${direction} ${target}`
  if (absSec < 86400) {
    const hours = Math.round(absSec / 3600)
    return `${hours}h ${direction} ${target}`
  }
  const days = Math.round(absSec / 86400)
  return `${days}d ${direction} ${target}`
}
