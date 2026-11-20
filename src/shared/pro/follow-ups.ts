/**
 * Follow-ups (docs/cross-app-semantics-v1.md section 21.18): everything that needs a move from you,
 * as one ordered list: verdicts due, checks before due (one line per owner), bring-back dates,
 * recaps not copied, and the weekly note. Nothing here is a notification. Both apps run the
 * `pro.followUps` vectors.
 *
 * Only imports its siblings, so every tsconfig can include it.
 */
import { addLocalDays, diffLocalDays, isoWeekday, localDateOf, type LocalDate } from '../due-dates'
import { finalVerdictOf, ledgerSettings, recordValue, type LedgerSettingsValue, type ProLedger, type RoundValue } from './ledger'
import { groupsOf } from './groups'
import { checkOnOf, checkedSince, effectiveDue, needsVerdict, type PromiseTask, type VerdictSnooze } from './promises'
import { readCheckDays, readWorkdays, workingDaysBefore } from './working-days'

export const RECAP_FOLLOW_UP_DAYS = 14
export const NOTE_MAX_DAYS = 14
export const NOTE_DEFAULT_DAYS = 7

export type FollowUpLine =
  | { kind: 'verdict'; key: string; taskId: number; person: number | null; due: LocalDate }
  | { kind: 'check'; key: string; person: number; tasks: number[]; due: LocalDate }
  | { kind: 'bring'; key: string; taskId: number; person: number | null; checkOn: LocalDate }
  | { kind: 'recap'; key: string; round: string; meeting: string; ended: string }
  | { kind: 'note'; key: string; day: LocalDate }

export interface FollowUpsInput {
  /** Open tasks (done ones are ignored). */
  tasks: readonly PromiseTask[]
  ledger: ProLedger | null | undefined
  today: LocalDate
  /** "Ask me tomorrow" per task id (`pro_verdict_snooze`). */
  snoozes?: Readonly<Record<string, VerdictSnooze>>
  /** Dismissed for today, by line key (`pro_followup_dismissed`): hidden while today is before it. */
  dismissed?: Readonly<Record<string, string>>
}

/** The day of the latest `weekday` (ISO, 1 to 7) on or before `today`. */
export function latestWeekday(today: LocalDate, weekday: number): LocalDate {
  const back = (isoWeekday(today) - weekday + 7) % 7
  return addLocalDays(today, -back)
}

export function readNoteDay(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 7 ? value : null
}

const latestDay = (marks: unknown): LocalDate | null => {
  let latest: LocalDate | null = null
  for (const mark of Array.isArray(marks) ? marks : []) {
    if (typeof mark !== 'string' || Number.isNaN(new Date(mark).getTime())) continue
    const day = localDateOf(mark)
    if (latest === null || day > latest) latest = day
  }
  return latest
}

/** The day the weekly note is due from, or null when it is not due (or no day is set). */
export function noteDue(settings: LedgerSettingsValue | null | undefined, today: LocalDate): LocalDate | null {
  const weekday = readNoteDay(settings?.note_day)
  if (weekday === null) return null
  const day = latestWeekday(today, weekday)
  const sent = latestDay(settings?.note_sent)
  return sent !== null && sent >= day ? null : day
}

/**
 * The local days a weekly note covers: from the day after the last one was copied (at most 14 days
 * back; 7 days without one) through today.
 */
export function notePeriod(settings: LedgerSettingsValue | null | undefined, today: LocalDate): { from: LocalDate; to: LocalDate } {
  const sent = latestDay(settings?.note_sent)
  const earliest = addLocalDays(today, -(NOTE_MAX_DAYS - 1))
  if (sent === null) return { from: addLocalDays(today, -(NOTE_DEFAULT_DAYS - 1)), to: today }
  const from = addLocalDays(sent, 1)
  return { from: from < earliest ? earliest : from > today ? today : from, to: today }
}

/** The lines, in the order of section 21.18, without the ones dismissed for today. */
export function followUps(input: FollowUpsInput): FollowUpLine[] {
  const { ledger, today } = input
  const settings = ledger ? ledgerSettings(ledger) : null
  const checkDays = readCheckDays(settings?.check_days)
  const workdays = readWorkdays(settings?.workdays)
  const groups = groupsOf(ledger)
  const groupByLabel = new Map(groups.map((group) => [group.label, group]))
  const groupMeetings = new Set(groups.map((group) => group.id))

  const verdicts: Extract<FollowUpLine, { kind: 'verdict' }>[] = []
  const checks = new Map<number, Array<{ id: number; due: LocalDate }>>()
  const brings: Extract<FollowUpLine, { kind: 'bring' }>[] = []
  const inLine = new Set<number>()

  for (const task of input.tasks) {
    if (task.done) continue
    const promise = recordValue(ledger?.promises, task.id)
    if (!promise || finalVerdictOf(promise)) continue
    const due = effectiveDue(task, promise)
    if (needsVerdict(task, promise, today, input.snoozes?.[String(task.id)] ?? null) && due !== null) {
      verdicts.push({ kind: 'verdict', key: `verdict:${task.id}`, taskId: task.id, person: typeof promise.person === 'number' ? promise.person : null, due })
      inLine.add(task.id)
      continue
    }
    if (promise.dir !== 'theirs' || typeof promise.person !== 'number' || promise.no_check === true) continue
    if (due === null || due <= today) continue
    const ofGroups = (task.labels ?? []).map((label) => groupByLabel.get(label.id)).filter((group) => group !== undefined)
    if (!ofGroups.length || ofGroups.every((group) => !group.checks)) continue
    const checkDay = workingDaysBefore(due, checkDays, workdays)
    if (today < checkDay || checkedSince(promise, checkDay)) continue
    checks.set(promise.person, [...(checks.get(promise.person) ?? []), { id: task.id, due }])
    inLine.add(task.id)
  }

  for (const task of input.tasks) {
    if (task.done || inLine.has(task.id)) continue
    const promise = recordValue(ledger?.promises, task.id)
    if (!promise || finalVerdictOf(promise)) continue
    const checkOn = checkOnOf(promise)
    if (checkOn === null || checkOn > today || checkedSince(promise, checkOn)) continue
    brings.push({ kind: 'bring', key: `bring:${task.id}`, taskId: task.id, person: typeof promise.person === 'number' ? promise.person : null, checkOn })
  }

  const lines: FollowUpLine[] = []
  lines.push(...verdicts.sort((a, b) => (a.due === b.due ? a.taskId - b.taskId : a.due < b.due ? -1 : 1)))
  const checkLines = [...checks.entries()].map(([person, list]) => {
    const sorted = [...list].sort((a, b) => (a.due === b.due ? a.id - b.id : a.due < b.due ? -1 : 1))
    return { kind: 'check' as const, key: `check:${person}`, person, tasks: sorted.map((entry) => entry.id), due: sorted[0].due }
  })
  lines.push(...checkLines.sort((a, b) => (a.due === b.due ? a.person - b.person : a.due < b.due ? -1 : 1)))
  lines.push(...brings.sort((a, b) => (a.checkOn === b.checkOn ? a.taskId - b.taskId : a.checkOn < b.checkOn ? -1 : 1)))

  const recaps: Extract<FollowUpLine, { kind: 'recap' }>[] = []
  for (const [id, record] of Object.entries(ledger?.rounds ?? {})) {
    const round = record.value as RoundValue | null
    if (!round || typeof round.ended !== 'string' || !groupMeetings.has(round.meeting)) continue
    if ((round.recap_sent ?? []).length) continue
    const age = diffLocalDays(localDateOf(round.ended), today)
    if (age < 0 || age >= RECAP_FOLLOW_UP_DAYS) continue
    recaps.push({ kind: 'recap', key: `recap:${id}`, round: id, meeting: round.meeting, ended: round.ended })
  }
  lines.push(...recaps.sort((a, b) => {
    const left = new Date(a.ended).getTime()
    const right = new Date(b.ended).getTime()
    return left - right || (a.round < b.round ? -1 : a.round > b.round ? 1 : 0)
  }))

  const note = noteDue(settings, today)
  if (note !== null) lines.push({ kind: 'note', key: `note:${note}`, day: note })

  const dismissed = input.dismissed ?? {}
  return lines.filter((line) => {
    const until = dismissed[line.key]
    return !(typeof until === 'string' && today < until)
  })
}

/** The dismissals that still hide something: entries whose day has come are dropped. */
export function pruneDismissed(dismissed: Readonly<Record<string, string>> | null | undefined, today: LocalDate): Record<string, string> {
  const kept: Record<string, string> = {}
  for (const [key, until] of Object.entries(dismissed ?? {})) {
    if (typeof until === 'string' && today < until) kept[key] = until
  }
  return kept
}
