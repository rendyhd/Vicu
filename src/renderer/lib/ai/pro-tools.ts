/**
 * Ask's Pro read tools (docs/ai-assistant-v1.md section 11.3): `get_promises`, `get_person`,
 * `get_portfolio` and `get_initiative`, run on the device against the ledger and the open tasks.
 * Offered only while Pro's assistant switch is on; without the Pro data in the tool context they
 * answer `invalid_arguments`, so no ledger data leaves the device with the switch off.
 */
import { PRO_AI } from '../../../shared/ai/contract'
import { toLocalDate, type LocalDate } from '../../../shared/due-dates'
import {
  finalVerdictOf,
  recordValue,
  activeVerdicts,
  type EscalationValue,
  type LogValue,
  type OwedValue,
  type ProLedger,
  type PromiseValue,
} from '../../../shared/pro/ledger'
import { matchPerson, normalizeName, patternText, personCounts, type Person } from '../../../shared/pro/people'
import { effectiveDue, missesOf, needsVerdict } from '../../../shared/pro/promises'
import { capState, rankedInitiatives, readiness } from '../../../shared/pro/portfolio'
import type { Task } from '../vikunja-types'
import { isVisibleTask, summariseTask } from './task-summary'
import { pathOf } from './workspace'
import { ToolError, type ToolContext } from './ask-tools'

/** What the Pro tools read besides the tasks; null while Pro's assistant switch is off. */
export interface ProToolData {
  ledger: ProLedger
  people: Person[]
}

export const PRO_TOOL_NAMES: ReadonlySet<string> = new Set(PRO_AI.askTools.map((tool) => tool.name))

type Args = Record<string, unknown>

async function openTasks(ctx: ToolContext): Promise<Task[]> {
  return (await ctx.fetchTasks({ filter: 'done = false', keep_nested_subtasks: true })).filter(isVisibleTask)
}

function personOf(data: ProToolData, name: string): Person {
  const match = matchPerson(name, data.people)
  if (match.match === 'ambiguous') throw new ToolError('invalid_arguments', `More than one person is called ${name}.`)
  const person = data.people.find((candidate) => candidate.id === match.id)
  if (!person) throw new ToolError('not_found', `No person called ${name}.`)
  return person
}

function nameOf(data: ProToolData, id: number | null | undefined): string | null {
  return typeof id === 'number' ? data.people.find((person) => person.id === id)?.title ?? null : null
}

function promiseEntry(task: Task, promise: PromiseValue, data: ProToolData, ctx: ToolContext) {
  return {
    task: summariseTask(task, ctx.ws),
    person: nameOf(data, promise.person),
    direction: promise.dir,
    due: effectiveDue(task, promise),
    misses: missesOf(promise),
    words: promise.words ?? null,
    done_when: promise.done_when ?? null,
    verdicts: activeVerdicts(promise).map((verdict) => ({ kind: verdict.kind, on: toLocalDate(new Date(verdict.at)), new_due: verdict.new_due ?? null })),
  }
}

function openPromises(tasks: readonly Task[], data: ProToolData): Array<{ task: Task; promise: PromiseValue }> {
  return tasks.flatMap((task) => {
    const promise = recordValue(data.ledger.promises, task.id)
    return promise && !finalVerdictOf(promise) ? [{ task, promise }] : []
  })
}

async function getPromises(args: Args, ctx: ToolContext, data: ProToolData, today: LocalDate) {
  const direction = args.direction === 'theirs' || args.direction === 'mine' ? args.direction : 'any'
  const person = typeof args.person === 'string' && args.person.trim() ? personOf(data, args.person) : null
  const verdictDue = args.verdict_due === true
  const matching = openPromises(await openTasks(ctx), data).filter(({ task, promise }) =>
    (direction === 'any' || promise.dir === direction) &&
    (!person || promise.person === person.id) &&
    (!verdictDue || needsVerdict(task, promise, today)))
  matching.sort((a, b) => (effectiveDue(a.task, a.promise) ?? '9999').localeCompare(effectiveDue(b.task, b.promise) ?? '9999') || a.task.id - b.task.id)
  const max = PRO_AI.limits.get_promises_max
  return { promises: matching.slice(0, max).map(({ task, promise }) => promiseEntry(task, promise, data, ctx)), more: Math.max(0, matching.length - max) }
}

async function getPerson(args: Args, ctx: ToolContext, data: ProToolData, today: LocalDate) {
  if (typeof args.name !== 'string' || !args.name.trim()) throw new ToolError('invalid_arguments', 'name is required.')
  const person = personOf(data, args.name)
  const tasks = await openTasks(ctx)
  const openIds = new Set(tasks.map((task) => task.id))
  const theirs = openPromises(tasks, data).filter(({ promise }) => promise.person === person.id)
  const counts = personCounts(person.id, data.ledger, (id) => openIds.has(id), today)
  const owed = Object.values(data.ledger.owed).flatMap((record) => {
    const value = record.value as OwedValue | null
    return value && !value.resolved && value.from === person.id ? [value.what] : []
  })
  return {
    name: person.title,
    promised_to_you: theirs.filter(({ promise }) => promise.dir === 'theirs').map(({ task, promise }) => promiseEntry(task, promise, data, ctx)),
    you_promised: theirs.filter(({ promise }) => promise.dir === 'mine').map(({ task, promise }) => promiseEntry(task, promise, data, ctx)),
    last_90_days: counts,
    pattern: patternText(counts),
    agenda: [
      "What's still unclear?",
      ...theirs.filter(({ promise }) => promise.dir === 'theirs').map(({ task }) => task.title.trim()),
      ...theirs.filter(({ promise }) => promise.dir === 'mine').map(({ task }) => `Mine: ${task.title.trim()}`),
      ...owed.map((what) => `Decision needed: ${what}`),
    ],
  }
}

function getPortfolio(ctx: ToolContext, data: ProToolData) {
  const { ledger } = data
  const cap = capState(ledger)
  const parked = Object.keys(ledger.initiatives).flatMap((id) => {
    const value = recordValue(ledger.initiatives, id)
    return value?.status === 'parked' ? [{ name: pathOf(ctx.ws, Number(id)), reason: value.parked?.reason ?? null, since: value.parked?.on ?? null }] : []
  })
  return {
    cap: { active: cap.active, cap: cap.cap, agreed: cap.agreed },
    initiatives: rankedInitiatives(ledger).map((entry) => {
      const ready = readiness(entry.value)
      return {
        rank: entry.rank,
        name: pathOf(ctx.ws, entry.projectId),
        owner: nameOf(data, entry.value.owner),
        sponsor: nameOf(data, entry.value.sponsor),
        readiness: { done: ready.done, total: ready.total, missing: ready.missing },
        capacity_agreed: !ready.missing.includes('capacity'),
      }
    }),
    parked,
    escalations: Object.values(ledger.escalations).flatMap((record) => {
      const value = record.value as EscalationValue | null
      return value && (value.status === 'drafted' || value.status === 'accepted') ? [{ text: value.draft, status: value.status, since: value.opened }] : []
    }),
    decisions_owed: Object.values(ledger.owed).flatMap((record) => {
      const value = record.value as OwedValue | null
      return value && !value.resolved ? [{ what: value.what, from: nameOf(data, value.from), since: value.opened }] : []
    }),
  }
}

async function getInitiative(args: Args, ctx: ToolContext, data: ProToolData) {
  if (typeof args.name !== 'string' || !args.name.trim()) throw new ToolError('invalid_arguments', 'name is required.')
  const wanted = normalizeName(args.name)
  const ids = Object.keys(data.ledger.initiatives).map(Number).filter((id) => recordValue(data.ledger.initiatives, id))
  const found = ids.filter((id) => {
    const project = ctx.ws.projects.find((candidate) => candidate.id === id)
    return project && (normalizeName(project.title) === wanted || normalizeName(pathOf(ctx.ws, id)) === wanted)
  })
  if (found.length === 0) throw new ToolError('not_found', `No initiative called ${args.name}.`)
  const id = found[0]
  const value = recordValue(data.ledger.initiatives, id)!
  const ready = readiness(value)
  const rank = rankedInitiatives(data.ledger).find((entry) => entry.projectId === id)?.rank ?? null
  const log = Object.values(data.ledger.log)
    .map((record) => record.value as LogValue | null)
    .filter((entry): entry is LogValue => !!entry && entry.initiative === id)
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .map((entry) => ({ kind: entry.kind, text: entry.text, on: entry.at }))
  const owed = Object.values(data.ledger.owed).flatMap((record) => {
    const owedValue = record.value as OwedValue | null
    return owedValue && !owedValue.resolved && owedValue.initiative === id ? [{ what: owedValue.what, from: nameOf(data, owedValue.from) }] : []
  })
  const promises = openPromises(await openTasks(ctx), data).filter(({ task, promise }) => promise.initiative === id || task.project_id === id)
  return {
    name: pathOf(ctx.ws, id),
    status: value.status ?? 'active',
    rank,
    sponsor: nameOf(data, value.sponsor),
    owner: nameOf(data, value.owner),
    readiness: { done: ready.done, total: ready.total, missing: ready.missing, items: value.ready ?? {} },
    log,
    decisions_owed: owed,
    promises: promises.map(({ task, promise }) => promiseEntry(task, promise, data, ctx)),
  }
}

/** Runs a Pro read tool. */
export async function runProTool(name: string, args: Args, ctx: ToolContext): Promise<unknown> {
  const data = ctx.pro
  if (!data) throw new ToolError('invalid_arguments', 'Pro data is not shared with the assistant.')
  const today = toLocalDate(ctx.now())
  switch (name) {
    case 'get_promises': return getPromises(args, ctx, data, today)
    case 'get_person': return getPerson(args, ctx, data, today)
    case 'get_portfolio': return getPortfolio(ctx, data)
    case 'get_initiative': return getInitiative(args, ctx, data)
    default: throw new ToolError('invalid_arguments', `Unknown tool ${name}`)
  }
}
