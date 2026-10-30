import type { ParseResult, TokenType } from './task-parser'
import { formatDateChip } from './date-utils'
import type { DateFormat } from './date-display'
import { getDateFormat } from './date-format'
import { locationReminderLabel, type LocationTrigger } from '../../shared/synced-prefs'
import { formatTaskDuration } from './task-duration'

// The chips under a quick-add input: one builder for the composer, the title editor and Quick
// Entry, so the same parse gives the same words everywhere. Pure: no React, no DOM.

/** Where a chip's value came from: read from the typed text, or set with the field's own control. */
export type ChipSource = 'text' | 'chip'

export interface ChipData {
  type: TokenType
  label: string
  key: string
  source?: ChipSource
  /** The priority level, for the role colour of a priority chip. */
  priority?: number
}

const PRIORITY_NAMES = ['', 'Low', 'Medium', 'High', 'Urgent', 'Do now']

/** The word on a priority chip. */
export function priorityChipName(priority: number): string {
  return PRIORITY_NAMES[priority] || `P${priority}`
}

/** The word on a repeat chip read from text: "Every week", "Every 2 months". */
export function recurrenceChipName(interval: number, unit: string): string {
  return interval === 1 ? `Every ${unit}` : `Every ${interval} ${unit}s`
}

/** The word on a place chip: "Arrive: Home" or "Leave: Work", as the reminder chip says it. */
export function placeChipName(trigger: LocationTrigger, placeName: string): string {
  return locationReminderLabel(trigger, placeName)
}

/** A ParseResult as chips, in the order date, duration, priority, labels, project, repeat, place. */
export function parseChips(result: ParseResult, fmt: DateFormat = getDateFormat(), now: Date = new Date()): ChipData[] {
  const chips: ChipData[] = []
  if (result.dueDate) {
    chips.push({ type: 'date', label: formatDateChip(result.dueDate, !result.dueHasTime, now, fmt), key: 'date', source: 'text' })
  }
  if (result.durationMinutes !== null) {
    chips.push({ type: 'duration', label: formatTaskDuration(result.durationMinutes), key: 'duration', source: 'text' })
  }
  if (result.priority !== null && result.priority > 0) {
    chips.push({ type: 'priority', label: priorityChipName(result.priority), key: 'priority', source: 'text', priority: result.priority })
  }
  for (const lbl of result.labels) {
    chips.push({ type: 'label', label: lbl, key: `label-${lbl}`, source: 'text' })
  }
  if (result.project) {
    chips.push({ type: 'project', label: result.project, key: 'project', source: 'text' })
  }
  if (result.recurrence) {
    chips.push({ type: 'recurrence', label: recurrenceChipName(result.recurrence.interval, result.recurrence.unit), key: 'recurrence', source: 'text' })
  }
  if (result.place) {
    chips.push({ type: 'place', label: placeChipName(result.place.trigger, result.place.place.name), key: 'place', source: 'text' })
  }
  return chips
}
