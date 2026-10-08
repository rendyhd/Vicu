import { useEffect, useRef, useState, type RefObject } from 'react'
import { X } from 'lucide-react'
import type { Task, TaskReminder } from '@/lib/vikunja-types'
import { NULL_DATE } from '@/lib/constants'
import { formatDateChip } from '@/lib/date-utils'
import { DEFAULT_REMINDER_TIME, EMPTY_WHEN, instantOf, whenText, type WhenValue } from '@/lib/when-logic'
import { useDateFormat } from '@/hooks/use-date-format'
import { Button } from '../shared/Button'
import { Popover, type PopoverCloseReason } from '../overlay/Popover'
import { WhenPanel } from './WhenPanel'

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
  // The day and time picked in the panel and not added yet; a quick choice or Enter adds at once.
  const [staged, setStaged] = useState<WhenValue>(EMPTY_WHEN)
  const [panelKey, setPanelKey] = useState(0)
  const dateFormat = useDateFormat()
  const panelHost = useRef<HTMLDivElement>(null)

  // Adding remounts the panel (it starts empty again), which destroys the focused control. The
  // Popover only focuses on open, so put focus on the new panel's first field.
  useEffect(() => {
    if (panelKey === 0) return
    panelHost.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus()
  }, [panelKey])

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

  const now = new Date()

  // A day without a time gets the default reminder time; a time picked first starts from today.
  const addPicked = (value: WhenValue) => {
    if (!value.date) return
    addReminder(instantOf(value.date, value.time ?? DEFAULT_REMINDER_TIME))
    setStaged(EMPTY_WHEN)
    setPanelKey((k) => k + 1)
  }

  const formatReminder = (r: TaskReminder) => {
    if (r.relative_period !== undefined && r.relative_period !== null && r.relative_to) {
      return formatRelativeReminder(r.relative_period, r.relative_to)
    }
    const d = new Date(r.reminder)
    return formatDateChip(d, false, now, dateFormat)
  }

  return (
    <Popover anchorRef={anchorRef} onClose={onClose} label="Reminders" className="w-72 p-3">
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

      {hasDueDate && (
        <span className="mb-1 block px-2 text-caption font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
          Absolute
        </span>
      )}
      {/* A quick choice or Enter in the text field adds the reminder; a day or time picked in the grid
          waits for the button, which is there as soon as a day is picked. */}
      <div ref={panelHost}>
        <WhenPanel
          key={panelKey}
          value={staged}
          onChange={(value, { commit }) => (commit ? addPicked(value) : setStaged(value))}
        />
      </div>
      {staged.date && (
        <Button
          variant="primary"
          onClick={() => addPicked(staged)}
          aria-label={`Add reminder, ${whenText({ date: staged.date, time: staged.time ?? DEFAULT_REMINDER_TIME }, now, dateFormat)}`}
          className="mt-2 w-full"
        >
          Add reminder
        </Button>
      )}
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
