import type { ParseResult, TokenType } from './task-parser'
import { formatDateChip } from './date-utils'
import { formatBlockRange, type DateFormat } from './date-display'
import { getDateFormat } from './date-format'
import { locationReminderLabel, type LocationTrigger } from '../../shared/synced-prefs'
import { t, type TranslationKey } from '../../shared/i18n'

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

const PRIORITY_NAMES: ReadonlyArray<TranslationKey | ''> = ['', 'composer.chip.priorityLow', 'composer.chip.priorityMedium', 'composer.chip.priorityHigh', 'composer.chip.priorityUrgent', 'composer.chip.priorityDoNow']

/** The word on a priority chip. */
export function priorityChipName(priority: number): string {
  const key = PRIORITY_NAMES[priority]
  return key ? t(key) : `P${priority}`
}

/** The word on a repeat chip read from text: "Every week", "Every 2 months". */
export function recurrenceChipName(interval: number, unit: string): string {
  if (interval === 1) {
    return unit === 'day' ? t('composer.chip.everyDay') : unit === 'week' ? t('composer.chip.everyWeek') : unit === 'month' ? t('composer.chip.everyMonth') : t('composer.chip.everyYear')
  }
  return unit === 'day' ? t('composer.chip.everyDays', { count: interval }) : unit === 'week' ? t('composer.chip.everyWeeks', { count: interval }) : unit === 'month' ? t('composer.chip.everyMonths', { count: interval }) : t('composer.chip.everyYears', { count: interval })
}

/** The word on a place chip: "Arrive: Home" or "Leave: Work", as the reminder chip says it. */
export function placeChipName(trigger: LocationTrigger, placeName: string): string {
  return locationReminderLabel(trigger, placeName)
}

/** A ParseResult as chips, in the order date, time block, priority, labels, project, repeat, place. */
export function parseChips(result: ParseResult, fmt: DateFormat = getDateFormat(), now: Date = new Date()): ChipData[] {
  const chips: ChipData[] = []
  if (result.dueDate) {
    chips.push({ type: 'date', label: formatDateChip(result.dueDate, !result.dueHasTime, now, fmt), key: 'date', source: 'text' })
  }
  if (result.block) {
    chips.push({ type: 'length', label: formatBlockRange(result.block.start, result.block.end, fmt), key: 'length', source: 'text' })
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
  // Pro's phrases (cross-app semantics 5.5); the parser reads them only while Pro is on.
  const person = personChip(result)
  if (person) chips.push(person)
  // Who it was promised to, and the day to look at it again (5.5).
  if (result.requester) {
    const token = result.tokens.find((entry) => entry.type === 'requester')
    const name = result.requester.id === null
      ? result.requester.name
      : (token?.raw ?? '').replace(/^fors+/i, '').replace(/^$/, '').replace(/^"(.*)"$/, '$1').trim()
    chips.push({ type: 'requester', label: t('pro.chip.requester', { name }), key: 'requester', source: 'text' })
  }
  if (result.checkOn) {
    const [year, month, day] = result.checkOn.split('-').map(Number)
    chips.push({ type: 'checkOn', label: t('pro.chip.checkOn', { date: formatDateChip(new Date(year, month - 1, day), true, now, fmt) }), key: 'checkOn', source: 'text' })
  }
  if (result.start && !result.block) {
    chips.push({ type: 'start', label: t('composer.chip.starts', { date: formatDateChip(result.start, true, now, fmt) }), key: 'start', source: 'text' })
  }
  if (result.estimate) {
    const hours = Math.floor(result.estimate / 60)
    const minutes = result.estimate % 60
    chips.push({ type: 'estimate', label: `~${hours ? `${hours}h` : ''}${minutes ? `${minutes}m` : ''}`, key: 'estimate', source: 'text' })
  }
  if (result.flag) chips.push({ type: 'flag', label: t('composer.chip.flagged'), key: 'flag', source: 'text' })
  if (result.request) chips.push({ type: 'request', label: t('composer.chip.request'), key: 'request', source: 'text' })
  return chips
}

/**
 * The person a capture names (cross-app semantics 5.5): "From Jan" or "For Jan", and "(new person)"
 * for a `$` name that matches nobody yet, which becomes a person when the task is saved (21.5).
 */
export function personChip(result: Pick<ParseResult, 'person' | 'tokens'>): ChipData | null {
  const token = result.tokens.find((entry) => entry.type === 'person')
  if (!result.person || !token) return null
  const name = result.person.id === null
    ? result.person.name
    : token.raw.replace(/^for\s+/i, '').replace(/:$/, '').replace(/^\$/, '').replace(/^"(.*)"$/, '$1').trim()
  const isNew = result.person.id === null
  const label = result.person.mine
    ? t(isNew ? 'composer.chip.forNewPerson' : 'composer.chip.forPerson', { name })
    : t(isNew ? 'composer.chip.fromNewPerson' : 'composer.chip.fromPerson', { name })
  return { type: 'person', label, key: 'person', source: 'text' }
}
