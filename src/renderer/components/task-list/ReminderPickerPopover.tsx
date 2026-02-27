import { useState, useRef, useEffect } from 'react'
import { X } from 'lucide-react'
import type { Task, TaskReminder } from '@/lib/vikunja-types'
import { NULL_DATE } from '@/lib/constants'

interface ReminderPickerPopoverProps {
  task: Task
  onReminderChange: (reminders: TaskReminder[]) => void
  onClose: () => void
}

const RELATIVE_PRESETS = [
  { label: 'At due time', offset: 0 },
  { label: '15 min before', offset: -900 },
  { label: '1 hour before', offset: -3600 },
  { label: '1 day before', offset: -86400 },
]

export function ReminderPickerPopover({ task, onReminderChange, onClose }: ReminderPickerPopoverProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [customDateTime, setCustomDateTime] = useState('')

  const reminders = task.reminders ?? []
  const hasDueDate = task.due_date && task.due_date !== NULL_DATE

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onClose])

  const addReminder = (date: Date) => {
    const newReminder: TaskReminder = { reminder: date.toISOString() }
    onReminderChange([...reminders, newReminder])
  }

  const addRelativeReminder = (offset: number) => {
    const dueTime = new Date(task.due_date).getTime()
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
    <div
      ref={ref}
      className="absolute right-0 top-full z-50 mt-1 w-64 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 shadow-lg"
    >
      {/* Existing reminders */}
      {reminders.length > 0 && (
        <div className="mb-2 flex flex-col gap-1">
          {reminders.map((r, i) => (
            <div
              key={`${r.reminder}-${i}`}
              className="flex items-center justify-between rounded px-2 py-1 text-xs text-[var(--text-primary)] bg-[var(--bg-hover)]"
            >
              <span>{formatReminder(r)}</span>
              <button
                type="button"
                onClick={() => removeReminder(i)}
                className="ml-2 text-[var(--text-secondary)] hover:text-red-500"
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
          <span className="px-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            Relative to due date
          </span>
          {RELATIVE_PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => addRelativeReminder(p.offset)}
              className="rounded px-2 py-1.5 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      {/* Quick presets */}
      <div className="mb-2 flex flex-col gap-1">
        {hasDueDate && (
          <span className="px-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            Absolute
          </span>
        )}
        {presets.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => addReminder(p.getDate())}
            className="rounded px-2 py-1.5 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Custom datetime */}
      <div className="border-t border-[var(--border-color)] pt-2">
        <input
          type="datetime-local"
          value={customDateTime}
          onChange={(e) => setCustomDateTime(e.target.value)}
          className="w-full rounded border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1.5 text-xs text-[var(--text-primary)] focus:border-[var(--accent-blue)] focus:outline-none"
        />
        <button
          type="button"
          onClick={handleAddCustom}
          disabled={!customDateTime}
          className="mt-1 w-full rounded bg-[var(--accent-blue)] px-2 py-1.5 text-xs text-white hover:opacity-90 disabled:opacity-40"
        >
          Add reminder
        </button>
      </div>
    </div>
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
