/**
 * The weekly execution review (docs/cross-app-semantics-v1.md section 21.11): Pro's steps before the
 * usual weekly review (section 14.7) and the mirror line. Both apps run the `pro.weeklyPro` vectors.
 *
 * Only imports its siblings, so every tsconfig can include it.
 */
import { addLocalDays, isoWeekday, localDateOf, type LocalDate } from '../due-dates'
import { blockOf, type BlockFields } from '../time-blocks'
import { finalVerdictOf, recordValue, type ProLedger } from './ledger'
import { needsVerdict, readConfirmTitle, unsentPromises, type PromiseTask } from './promises'
import { capState, rankedInitiatives, readiness } from './portfolio'
import type { ProLayers } from './settings'

export type ProWeeklyStepId = 'verdicts' | 'unsent' | 'escalations' | 'portfolio' | 'value'

export const PRO_WEEKLY_STEP_TITLES: Record<ProWeeklyStepId, string> = {
  verdicts: 'Give verdicts',
  unsent: 'Send what was agreed',
  escalations: 'Escalations and decisions',
  portfolio: 'Check the portfolio',
  value: 'Note the value delivered',
}

export interface ProWeeklyStep {
  id: ProWeeklyStepId
  title: string
  count: number
}

export interface WeeklyTask extends PromiseTask, BlockFields {
  project_id: number
  title?: string
  done_at?: string | null
}

export interface ProWeeklyInput {
  tasks: readonly WeeklyTask[]
  ledger: ProLedger | null
  layers: ProLayers
  today: LocalDate
  /** Active initiatives with no available task (from the availability context). */
  stalledInitiatives: number
}

/**
 * The steps, in this order, for the layers that are on: promises (verdicts due, promises not sent
 * yet), portfolio (escalations drafted or accepted plus open owed decisions; initiatives not ready,
 * over the cap or stalled; initiatives closed in the last 7 days without a value entry). A step with
 * nothing to do is still listed with 0, so the review has the same shape each week.
 */
export function proWeeklySteps(input: ProWeeklyInput): ProWeeklyStep[] {
  const { ledger, today } = input
  const steps: ProWeeklyStep[] = []
  const step = (id: ProWeeklyStepId, count: number) => steps.push({ id, title: PRO_WEEKLY_STEP_TITLES[id], count })
  if (input.layers.promises) {
    step('verdicts', input.tasks.filter((task) => needsVerdict(task, recordValue(ledger?.promises, task.id), today)).length)
    step('unsent', unsentPromises(input.tasks, ledger).length)
  }
  if (input.layers.portfolio) {
    const escalations = Object.values(ledger?.escalations ?? {}).filter((record) =>
      record.value && (record.value.status === 'drafted' || record.value.status === 'accepted')).length
    const owed = Object.values(ledger?.owed ?? {}).filter((record) => record.value && !record.value.resolved).length
    step('escalations', escalations + owed)
    const ranked = rankedInitiatives(ledger)
    const cap = capState(ledger)
    const notReady = ranked.filter((entry) => !readiness(entry.value).ready).length
    step('portfolio', notReady + (cap.active > cap.cap ? 1 : 0) + input.stalledInitiatives)
    const weekStart = addLocalDays(today, -6)
    let closedWithoutValue = 0
    for (const [id, record] of Object.entries(ledger?.initiatives ?? {})) {
      const value = record.value
      if (!value || value.status !== 'closed' || !value.closed_on || value.closed_on < weekStart || value.closed_on > today) continue
      const hasValue = Object.values(ledger?.log ?? {}).some((entry) => entry.value?.kind === 'value' && entry.value.initiative === Number(id))
      if (!hasValue) closedWithoutValue++
    }
    step('value', closedWithoutValue)
  }
  return steps
}

// --- The mirror ------------------------------------------------------------------------------------

export interface WeeklyMirror {
  /** Promises of others you finished yourself ("taken over") in the last 7 days. */
  rescues: number
  /** Workdays (Monday to Friday) of the last 7 days with a focus block done. */
  focusDays: number
  workdays: number
  /** Your open tasks (not someone else's promise). */
  youHold: number
  /** Open promises others made to you. */
  othersHold: number
  /** Open "Confirm with" tasks. */
  unconfirmed: number
}

/**
 * A day had a focus block when a task in a ranked initiative had a block of at least 60 minutes on
 * that day and is done.
 */
export function weeklyMirror(tasks: readonly WeeklyTask[], ledger: ProLedger | null, today: LocalDate): WeeklyMirror {
  const from = addLocalDays(today, -6)
  const ranked = new Set(rankedInitiatives(ledger).map((entry) => entry.projectId))
  let rescues = 0
  for (const record of Object.values(ledger?.promises ?? {})) {
    const final = finalVerdictOf(record.value)
    if (final?.kind !== 'taken_over') continue
    const day = localDateOf(final.at)
    if (day >= from && day <= today) rescues++
  }
  const focusDays = new Set<LocalDate>()
  let workdays = 0
  for (let day = from; day <= today; day = addLocalDays(day, 1)) if (isoWeekday(day) <= 5) workdays++
  let youHold = 0
  let othersHold = 0
  let unconfirmed = 0
  for (const task of tasks) {
    const block = blockOf(task)
    if (task.done && block && block.minutes >= 60 && ranked.has(task.project_id) && block.day >= from && block.day <= today && isoWeekday(block.day) <= 5) {
      focusDays.add(block.day)
    }
    if (task.done) continue
    const promise = recordValue(ledger?.promises, task.id)
    const theirs = promise?.dir === 'theirs' && !finalVerdictOf(promise)
    if (theirs) othersHold++
    else youHold++
    if (task.title && readConfirmTitle(task.title)) unconfirmed++
  }
  return { rescues, focusDays: focusDays.size, workdays, youHold, othersHold, unconfirmed }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** The mirror in plain words. */
export function mirrorText(mirror: WeeklyMirror): string {
  const rescues = mirror.rescues === 0 ? 'took over no promises' : `took over ${plural(mirror.rescues, 'promise', 'promises')}`
  const parts = [
    `Last 7 days: you ${rescues} and had a focus block on ${mirror.focusDays} of ${plural(mirror.workdays, 'workday', 'workdays')}.`,
    `You hold ${plural(mirror.youHold, 'open task', 'open tasks')}; others hold ${plural(mirror.othersHold, 'promise', 'promises')} to you.`,
  ]
  if (mirror.unconfirmed) parts.push(`${mirror.unconfirmed} still to confirm.`)
  return parts.join(' ')
}
