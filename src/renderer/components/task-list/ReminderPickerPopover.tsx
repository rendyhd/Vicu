import { useEffect, useRef, useState, type RefObject } from 'react'
import { MapPin, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { t as translate, type TranslationKey } from '../../../shared/i18n'
import type { Task, TaskReminder } from '@/lib/vikunja-types'
import { NULL_DATE } from '@/lib/constants'
import { formatDateChip } from '@/lib/date-utils'
import { DEFAULT_REMINDER_TIME, EMPTY_WHEN, instantOf, whenText, type WhenValue } from '@/lib/when-logic'
import { useDateFormat } from '@/hooks/use-date-format'
import { useLocationReminders } from '@/hooks/use-location-reminders'
import {
  DEFAULT_LOCATION_RADIUS,
  LOCATION_RADIUS_OPTIONS,
  locationReminderLabel,
  type LocationTrigger,
} from '../../../shared/synced-prefs'
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

const RELATIVE_PRESETS: ReadonlyArray<{ label: TranslationKey; offset: number }> = [
  { label: 'task.reminder.atDue', offset: 0 },
  { label: 'task.reminder.min15', offset: -900 },
  { label: 'task.reminder.hour1', offset: -3600 },
  { label: 'task.reminder.day1', offset: -86400 },
]

export function ReminderPickerPopover({ anchorRef, task, dueDate, reminders: controlledReminders, onReminderChange, onClose }: ReminderPickerPopoverProps) {
  const { t } = useTranslation()
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
    <Popover anchorRef={anchorRef} onClose={onClose} label={t('task.reminder.title')} className="w-72 p-3">
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
                aria-label={t('task.reminder.removeNamed', { reminder: formatReminder(r) })}
                title={t('task.reminder.remove')}
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
            {t('task.reminder.relativeHeading')}
          </span>
          {RELATIVE_PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => addRelativeReminder(p.offset)}
              className="rounded-control px-2 py-1.5 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
            >
              {t(p.label)}
            </button>
          ))}
        </div>
      )}

      {hasDueDate && (
        <span className="mb-1 block px-2 text-caption font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
          {t('task.reminder.absoluteHeading')}
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
          aria-label={t('task.reminder.addNamed', { when: whenText({ date: staged.date, time: staged.time ?? DEFAULT_REMINDER_TIME }, now, dateFormat) })}
          className="mt-2 w-full"
        >
          {t('task.reminder.add')}
        </Button>
      )}
      {/* A new task has no id yet: a location reminder is set once it exists. */}
      {task && task.id > 0 && <PlaceReminderSection taskId={task.id} />}
    </Popover>
  )
}

/**
 * "At a place" (cross-app semantics section 11.7): arrive at or leave a place saved on a phone.
 * The phone reminds there; the desktop only chooses the place, the trigger and the distance.
 */
function PlaceReminderSection({ taskId }: { taskId: number }) {
  const { t } = useTranslation()
  const { places, reminderFor, setReminder, removeReminder } = useLocationReminders()
  const current = reminderFor(taskId)
  const [trigger, setTrigger] = useState<LocationTrigger>(current?.trigger ?? 'arrive')
  const [radius, setRadius] = useState<number>(current?.radius_m ?? DEFAULT_LOCATION_RADIUS)
  const choice = 'rounded-control px-2 py-1 text-xs'
  const chosen = (on: boolean) => (on
    ? `${choice} bg-[var(--bg-selected)] font-medium text-[var(--text-primary)]`
    : `${choice} text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]`)

  return (
    <div className="mt-3 flex flex-col gap-1 border-t border-[var(--border-color)] pt-2">
      <span className="px-2 text-caption font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
        {t('task.reminder.atPlace')}
      </span>
      {current && (
        <div className="flex items-center justify-between rounded-control bg-[var(--bg-hover)] px-2 py-1 text-xs text-[var(--text-primary)]">
          <span className="flex items-center gap-1.5">
            <MapPin className="h-3 w-3" aria-hidden="true" />
            {locationReminderLabel(current.trigger, current.placeName)}, {current.radius_m} m
          </span>
          <button
            type="button"
            onClick={() => removeReminder(taskId)}
            aria-label={t('task.reminder.removeLocationNamed', { reminder: locationReminderLabel(current.trigger, current.placeName) })}
            title={t('task.reminder.removeLocation')}
            className="ml-2 text-[var(--text-secondary)] hover:text-danger"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
      {places.length === 0 ? (
        <p className="px-2 text-xs text-[var(--text-secondary)]">
          {t('task.reminder.noPlaces')}
        </p>
      ) : (
        <>
          <div className="flex gap-1 px-1" role="group" aria-label={t('task.reminder.remindMe')}>
            {(['arrive', 'leave'] as const).map((value) => (
              <button key={value} type="button" aria-pressed={trigger === value} onClick={() => setTrigger(value)} className={chosen(trigger === value)}>
                {value === 'arrive' ? t('task.reminder.whenArrive') : t('task.reminder.whenLeave')}
              </button>
            ))}
          </div>
          <div className="flex gap-1 px-1" role="group" aria-label={t('task.reminder.distance')}>
            {LOCATION_RADIUS_OPTIONS.map((meters) => (
              <button key={meters} type="button" aria-pressed={radius === meters} onClick={() => setRadius(meters)} className={chosen(radius === meters)}>
                {meters} m
              </button>
            ))}
          </div>
          {places.map((place) => {
            const isCurrent = current?.place === place.id && current.trigger === trigger && current.radius_m === radius
            return (
              <button
                key={place.id}
                type="button"
                disabled={isCurrent}
                onClick={() => setReminder(taskId, place.id, trigger, radius)}
                className="flex items-center gap-1.5 rounded-control px-2 py-1.5 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-60"
              >
                <MapPin className="h-3 w-3 text-[var(--text-secondary)]" aria-hidden="true" />
                {locationReminderLabel(trigger, place.name)}
              </button>
            )
          })}
          <p className="px-2 text-caption text-[var(--text-secondary)]">{t('task.reminder.phoneReminds')}</p>
        </>
      )}
    </div>
  )
}

function formatRelativeReminder(
  period: number,
  relativeTo: 'due_date' | 'start_date' | 'end_date'
): string {
  const target =
    relativeTo === 'start_date'
      ? translate('task.reminder.targetStart')
      : relativeTo === 'end_date'
        ? translate('task.reminder.targetEnd')
        : translate('task.reminder.targetDue')

  if (period === 0) return translate('task.reminder.relAt', { target })

  const absSec = Math.abs(period)
  const before = period < 0

  if (absSec < 60) return translate(before ? 'task.reminder.secBefore' : 'task.reminder.secAfter', { amount: absSec, target })
  if (absSec < 3600) return translate(before ? 'task.reminder.minBefore' : 'task.reminder.minAfter', { amount: Math.round(absSec / 60), target })
  if (absSec < 86400) {
    return translate(before ? 'task.reminder.hourBefore' : 'task.reminder.hourAfter', { amount: Math.round(absSec / 3600), target })
  }
  return translate(before ? 'task.reminder.dayBefore' : 'task.reminder.dayAfter', { amount: Math.round(absSec / 86400), target })
}
