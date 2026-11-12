import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { filterCustomList } from '../custom-list-filter'
import { formatWeekdayDate } from '../date-display'
import { availabilityContext, filterByView, type AvailabilityTask } from '../pro/availability'
import { focusBlockCandidates, focusBlockMinutes } from '../pro/focus-block'
import { inFocus, projectsShownInFocus, readProFocus } from '../pro/focus'
import {
  copilotPrompt,
  exportOpen,
  matchImport,
  readImport,
  readImportDate,
  type CopilotPromptTemplate,
  type ImportItem,
} from '../pro/import'
import {
  archivePlan,
  emptyLedger,
  mergeLedger,
  normalizeLedger,
  pruneLedger,
  type LedgerCollection,
  type ProLedger,
} from '../pro/ledger'
import { hasProCondition, readGroupBy, readRowFields } from '../pro/list-conditions'
import { endRound, markAbsent, nextPerson, pickPerson, skipPerson, startRound, type RoundState } from '../pro/meeting'
import { matchPerson, patternText, personCounts, withAlias, type PersonCounts } from '../pro/people'
import { capState, draftEscalation, escalationDue, moveRank, parkedValue, rankedInitiatives, readiness, unparkedValue } from '../pro/portfolio'
import { isProPrefKey, projectOnHold, readOnHold, readProjectMode, readRepeatRule } from '../pro/prefs'
import {
  buildVerdict,
  canSnooze,
  completedElsewhere,
  confirmTitle,
  effectiveDue,
  missesOf,
  needsVerdict,
  readConfirmTitle,
  unsentPromises,
  waitingOn,
} from '../pro/promises'
import { buildRecap, recapItems } from '../pro/recap'
import { catchUpPatch, completionPlan } from '../pro/repeat-rule'
import { inProArea, isProEnabled, readProArea } from '../pro/settings'
import { blockReplacesLaterStart, dateOnlyStart, startDayOf, startsEntries, startsLater } from '../pro/start-dates'
import { mirrorText, proWeeklySteps, weeklyMirror } from '../pro/weekly'
import { DEFAULT_PRO_LAYERS } from '../pro/settings'

/**
 * The `pro` and `customListPro` vectors of test-fixtures/cross-app-semantics-v1.json (contract
 * sections 21 and 3.8), and the Copilot prompt of ai-tools-v1.json. Local wall-clock times are
 * converted in the process time zone; the zone wrappers (pro*.test.ts) set `process.env.TZ` first.
 * Vicu mobile runs the same vectors. Nothing here may build a Date at module scope.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any

const fixture = () => JSON.parse(readFileSync(join(process.cwd(), 'test-fixtures', 'cross-app-semantics-v1.json'), 'utf8'))
const aiFixture = () => JSON.parse(readFileSync(join(process.cwd(), 'test-fixtures', 'ai-tools-v1.json'), 'utf8'))

/** `2026-10-06T10:00:00` as a Date in the process time zone; a value ending in Z as UTC. */
function local(value: string): Date {
  if (/Z$|[+-]\d{2}:\d{2}$/.test(value)) return new Date(value)
  const [datePart, timePart = '00:00:00'] = value.split('T')
  const [y, m, d] = datePart.split('-').map(Number)
  const [h, mi, s = 0] = timePart.split(':').map(Number)
  return new Date(y, m - 1, d, h, mi, s)
}
const iso = (value: string | null | undefined): string | null => (value ? local(value).toISOString() : null)

/** A ledger from vector values: every record gets a revision. */
function ledgerOf(values: Record<string, Record<string, unknown>> | undefined): ProLedger {
  const ledger = emptyLedger() as Any
  let wall = 1
  for (const [collection, records] of Object.entries(values ?? {})) {
    if (collection === 'estimates') {
      ledger.estimates = records
      continue
    }
    if (collection === 'settings') {
      ledger.settings = { value: records, revision: { wall_time_ms: wall++, counter: 0, device_id: 'v' } }
      continue
    }
    ledger[collection] = {}
    for (const [id, value] of Object.entries(records)) {
      ledger[collection][id] = { value, revision: { wall_time_ms: wall++, counter: 0, device_id: 'v' } }
    }
  }
  return ledger as ProLedger
}

/** A ledger from the compact merge form `{ v, r: [wall, counter, device] }`. */
function compactLedger(document: Record<string, Any>): ProLedger {
  const expand = (record: Any) => {
    const { v, r, ...rest } = record
    return { ...rest, value: v, revision: { wall_time_ms: r[0], counter: r[1], device_id: r[2] } }
  }
  const ledger: Any = { version: 1 }
  for (const [key, value] of Object.entries(document)) {
    if (key === 'settings') ledger.settings = expand(value)
    else if (key === 'estimates') ledger.estimates = value
    else if (['promises', 'initiatives', 'log', 'owed', 'escalations', 'meetings', 'rounds', 'people'].includes(key)) {
      ledger[key] = Object.fromEntries(Object.entries(value as Record<string, Any>).map(([id, record]) => [id, expand(record)]))
    } else ledger[key] = value
  }
  return normalizeLedger(ledger)
}

function vectorTask(raw: Any): AvailabilityTask & Any {
  return {
    id: raw.id,
    project_id: raw.project_id ?? 1,
    title: raw.title ?? `Task ${raw.id}`,
    done: raw.done === true,
    due_date: iso(raw.due) ?? '0001-01-01T00:00:00Z',
    start_date: iso(raw.start),
    end_date: iso(raw.end),
    position: raw.position ?? 0,
    priority: raw.priority ?? 0,
    is_favorite: raw.flagged === true,
    created: raw.created ? iso(raw.created) : null,
    labels: (raw.labels ?? []).map((id: number) => ({ id })),
    related_tasks: {
      blocked: (raw.blocked ?? []).map(([id, done]: [number, boolean]) => ({ id, done })),
      parenttask: raw.parent ? [{ id: raw.parent }] : [],
    },
  }
}

export function runProSuite(options: { zone: string; expectedOffsetMinutesInNovember?: number }): void {
  describe(`Pro rules in ${options.zone}`, () => {
    const all = fixture()
    const v = all.pro
    const fmtOf = (locale: string, hour12: boolean) => ({ locale, hour12 })

    it('is running in the requested time zone', () => {
      if (options.expectedOffsetMinutesInNovember !== undefined) {
        expect(new Date(2026, 10, 12).getTimezoneOffset()).toBe(options.expectedOffsetMinutesInNovember)
      }
    })

    describe('settings', () => {
      for (const c of v.settings.enabled) {
        it(c.name, () => expect(isProEnabled(c.config, c.layer ?? undefined)).toBe(c.expect))
      }
      const projects = new Map(v.settings.area.projects.map((p: Any) => [p.id, p]))
      for (const c of v.settings.area.cases) {
        it(`area: ${c.name}`, () => {
          const category = (id: number) => v.settings.area.categories[String(id)] ?? null
          expect(inProArea(c.project, readProArea(c.area), projects as Any, category)).toBe(c.expect)
        })
      }
    })

    describe('prefs', () => {
      it('keys', () => {
        for (const c of v.prefs.keys) expect([c.key, isProPrefKey(c.key)]).toEqual([c.key, c.pro])
      })
      it('project mode', () => {
        for (const c of v.prefs.projectMode) expect(readProjectMode(c.value)).toBe(c.expect)
      })
      it('on hold', () => {
        for (const c of v.prefs.onHold) expect(readOnHold(c.value)).toBe(c.expect)
      })
      it('repeat rule', () => {
        for (const c of v.prefs.repeatRule) expect(readRepeatRule(c.value)).toEqual(c.expect)
      })
    })

    describe('availability', () => {
      for (const world of v.availability) {
        it(world.name, () => {
          const tasks = world.tasks.map(vectorTask)
          const context = availabilityContext({
            now: local(world.now),
            tasks,
            projects: world.projects,
            prefs: world.prefs,
            ledger: ledgerOf(world.ledger),
          })
          for (const [index, raw] of world.tasks.entries()) {
            const result = context.of(tasks[index])
            expect({ id: raw.id, reasons: result.reasons }).toEqual({ id: raw.id, reasons: raw.expect })
            expect({ id: raw.id, available: result.available }).toEqual({ id: raw.id, available: raw.expect.length === 0 })
            if (raw.blockers) expect(result.blockers).toEqual(raw.blockers)
            expect({ id: raw.id, next: result.next }).toEqual({ id: raw.id, next: raw.next === true })
          }
          expect(context.cycles).toEqual(world.cycles)
          if (world.views) {
            for (const view of ['available', 'remaining', 'all'] as const) {
              expect(filterByView(tasks, view, context).map((task: Any) => task.id)).toEqual(world.views[view])
            }
          }
        })
      }
    })

    describe('start dates', () => {
      for (const c of v.startVsBlock.cases) {
        it(c.name, () => {
          const task = { start_date: iso(c.start), end_date: iso(c.end) }
          expect(startDayOf(task)).toBe(c.startDay)
          expect(startsLater(task, local(c.now))).toBe(c.startsLater)
          expect(blockReplacesLaterStart(task, local(c.blockStart))).toBe(c.warn)
        })
      }
      it('a date-only start is the local midnight', () => {
        for (const c of v.startVsBlock.dateOnlyStart) expect(dateOnlyStart(c.day)).toBe(iso(c.expect))
      })
      it("Upcoming's starts entries", () => {
        const u = v.startVsBlock.upcoming
        const tasks = u.tasks.map((t: Any) => ({ id: t.id, done: t.done === true, start_date: iso(t.start), end_date: iso(t.end) }))
        expect(startsEntries(tasks, local(u.now))).toEqual(u.expect)
      })
    })

    describe('ledger', () => {
      for (const c of v.ledgerMerge) {
        it(`merge: ${c.name}`, () => {
          const merged = mergeLedger(compactLedger(c.local), compactLedger(c.server))
          expect(merged).toEqual(compactLedger(c.expect))
        })
      }
      it('pruning tombstones', () => {
        const pruned = pruneLedger(compactLedger(v.ledgerPrune.ledger), v.ledgerPrune.nowMs)
        expect(Object.keys(pruned.promises).sort()).toEqual(v.ledgerPrune.keptPromises)
        expect(Object.keys(pruned.estimates).sort()).toEqual(v.ledgerPrune.keptEstimates)
      })
      it('the archive plan', () => {
        const plan = archivePlan(ledgerOf(v.archive.ledger), v.archive.today)
        const parts: Record<string, Record<string, string[]>> = {}
        for (const [quarter, records] of Object.entries(plan.parts)) {
          parts[quarter] = Object.fromEntries(Object.entries(records).map(([collection, byId]) => [collection, Object.keys(byId as object).sort()]))
        }
        expect(parts).toEqual(v.archive.parts)
        expect(plan.moved.map((m: { collection: LedgerCollection; id: string }) => `${m.collection}/${m.id}`)).toEqual(v.archive.moved)
      })
    })

    describe('promises', () => {
      const p = v.promises
      for (const c of p.verdictDue) {
        it(c.name, () => {
          const task = { id: 1, due_date: iso(c.task.due) ?? '0001-01-01T00:00:00Z', done: c.task.done === true }
          expect(effectiveDue(task, c.promise)).toBe(c.due)
          expect(needsVerdict(task, c.promise, p.today, c.snooze ?? null)).toBe(c.needs)
          if (c.canSnooze !== undefined) expect(canSnooze(task, c.promise, c.snooze ?? null)).toBe(c.canSnooze)
          if (c.completedElsewhere !== undefined) expect(completedElsewhere(task, c.promise)).toBe(c.completedElsewhere)
          if (c.misses !== undefined) expect(missesOf(c.promise)).toBe(c.misses)
        })
      }
      for (const c of p.build) {
        it(`verdict: ${c.name}`, () => {
          const task = { id: 1, due_date: iso(c.task.due) ?? '0001-01-01T00:00:00Z', done: c.task.done === true }
          const change = buildVerdict(task, c.kind, { id: 'v', at: '2026-11-12T09:00:00Z', newDue: c.newDue ?? null, blocker: c.blocker ?? null })
          expect(change.verdict).toEqual(c.verdict)
          const patch = c.patch && c.patch.due_date ? { due_date: iso(c.patch.due_date) } : c.patch
          expect(change.taskPatch).toEqual(patch)
        })
      }
      it('confirm titles', () => {
        for (const c of p.confirmTitles) {
          if (c.name) expect(confirmTitle(c.name, c.what)).toBe(c.title)
          else expect(readConfirmTitle(c.title)).toEqual(c.read)
        }
      })
      it('waiting on and unsent', () => {
        const w = v.waitingOn
        const tasks = w.tasks.map((t: Any) => ({ id: t.id, done: t.done === true, due_date: iso(t.due) ?? '0001-01-01T00:00:00Z', labels: (t.labels ?? []).map((id: number) => ({ id })) }))
        const ledger = ledgerOf(w.ledger)
        expect(waitingOn(tasks, ledger, (id) => w.onHoldLabels.includes(id), (id) => w.people.includes(id))).toEqual(w.groups)
        expect(unsentPromises(tasks, ledger)).toEqual(w.unsent)
      })
    })

    describe('people', () => {
      for (const c of v.personMatch.cases) {
        it(`match "${c.name}"`, () => expect(matchPerson(c.name, v.personMatch.people)).toEqual({ id: c.id, match: c.match }))
      }
      it('aliases', () => {
        for (const c of v.personMatch.aliases) expect(withAlias(c.aliases, c.add)).toEqual(c.expect)
      })
      it('pattern text', () => {
        for (const c of v.personPattern.texts) expect(patternText({ ...c.counts, openTheirs: 0, openMine: 0 } as PersonCounts)).toBe(c.text)
      })
      it('90-day counts', () => {
        const c = v.personPattern.counts
        const counts = personCounts(c.person, ledgerOf(c.ledger), (id) => c.openTasks.includes(id), c.today)
        expect(counts).toEqual(c.expect)
        expect(patternText(counts)).toBe(c.text)
      })
    })

    describe('recap', () => {
      const r = v.recapText
      for (const c of r.cases) {
        it(c.name, () => {
          const tasks = r.tasks.map((t: Any) => ({ id: t.id, title: t.title, done: r.doneTasks.includes(t.id), due_date: iso(t.due) ?? '0001-01-01T00:00:00Z', created: iso(t.created) }))
          const items = recapItems(c.scope, tasks, ledgerOf(r.ledger))
          const sections: Record<string, number[]> = {}
          for (const item of items) (sections[item.section] ??= []).push(item.taskId)
          expect(sections).toEqual(c.sections)
          const recap = buildRecap({
            title: c.title,
            date: c.date,
            items,
            personName: (id) => r.names[String(id)] ?? '?',
            notDiscussed: c.notDiscussed,
            absent: c.absent,
            includeQuotes: c.includeQuotes,
            now: local(r.now),
            fmt: fmtOf(c.locale, c.hour12),
          })
          expect(recap.text.split('\n')).toEqual(c.text)
          expect(recap.html).toBe(c.html)
          expect(recap.taskIds).toEqual(c.taskIds)
        })
      }
    })

    describe('meeting rounds', () => {
      for (const c of v.meetingRound) {
        it(c.name, () => {
          const view = (state: RoundState) => ({ current: state.current, discussed: state.discussed, skipped: state.skipped, absent: state.absent })
          let state = startRound(c.people, c.withMe)
          expect(view(state)).toEqual(c.start)
          for (const step of c.steps) {
            if (step.op === 'next') state = nextPerson(state)
            else if (step.op === 'skip') state = skipPerson(state)
            else if (step.op === 'pick') state = pickPerson(state, step.person)
            else if (step.op === 'absent') state = markAbsent(state, step.person)
            expect(view(state)).toEqual(step.expect)
          }
          expect(endRound(state, 'm1', '2026-11-12')).toEqual(c.round)
        })
      }
    })

    describe('portfolio', () => {
      const pf = v.portfolio
      it('ranking and moves', () => {
        const ledger = ledgerOf(pf.ledger)
        expect(rankedInitiatives(ledger).map((entry) => entry.projectId)).toEqual(pf.ranked)
        for (const move of pf.moves) {
          const ranks = moveRank(ledger, move.project, move.to)
          expect(Object.fromEntries(Object.entries(ranks).map(([id, rank]) => [id, rank]))).toEqual(move.ranks)
        }
      })
      it('the cap', () => {
        for (const c of pf.cap) {
          const ledger = ledgerOf({ ...pf.ledger, ...(c.settings ? { settings: c.settings } : {}) })
          expect(capState(ledger)).toEqual(c.expect)
        }
      })
      it('parking', () => {
        expect(parkedValue(pf.park.value, pf.park.on, pf.park.reason)).toEqual(pf.park.expect)
        expect(unparkedValue(ledgerOf(pf.ledger), pf.unpark.value)).toEqual(pf.unpark.expect)
      })
      for (const c of v.readiness) {
        it(`readiness: ${c.name}`, () => {
          const result = readiness(c.value)
          expect(result.done).toBe(c.done)
          expect(result.missing).toEqual(c.missing)
          expect(result.ready).toBe(c.missing.length === 0)
        })
      }
      it('escalations', () => {
        const e = v.escalationDraft
        const ledger = ledgerOf(e.ledger)
        const tasks = new Map<number, Any>(e.tasks.map((t: Any) => [t.id, { id: t.id, title: t.title, due_date: iso(t.due) ?? '0001-01-01T00:00:00Z' }]))
        for (const c of e.due) expect([c.task, escalationDue(ledger, c.task)]).toEqual([c.task, c.expect])
        for (const c of e.drafts) {
          const draft = draftEscalation({
            ledger,
            taskId: c.task,
            tasks,
            personName: (id) => e.names[String(id)],
            projectName: (id) => e.projects[String(id)],
            dateText: (day) => formatWeekdayDate(local(`${day}T12:00:00`), local(e.now), fmtOf(e.locale, false)),
            today: e.today,
          })
          expect(draft).toEqual(c.expect)
        }
        const withEscalation = ledgerOf({ ...e.ledger, escalations: { x: e.drafts[0].expect } })
        expect(escalationDue(withEscalation, e.afterDraft.task)).toBe(e.afterDraft.expect)
      })
    })

    describe('import', () => {
      for (const c of v.importDates) {
        it(`date "${c.text}" from ${c.ref}`, () => expect(readImportDate(c.text, c.ref)).toBe(c.expect))
      }
      for (const c of v.importRead) {
        it(`read: ${c.name}`, () => {
          const read = readImport(c.input.join('\n'), c.today)
          expect(read.ok).toBe(c.ok)
          expect(read.source).toEqual(c.source)
          expect(read.items).toEqual(c.items)
          expect(read.problems).toEqual(c.problems)
        })
      }
      it('matching', () => {
        const m = v.importMatch
        const match = matchImport({ ok: true, source: { kind: 'meeting', title: '', date: '2026-11-12' }, items: m.items as ImportItem[], problems: [] }, m.world)
        const rows = match.rows.map(({ item: _item, type: _type, ...row }) => row)
        expect(rows).toEqual(m.rows)
        expect(match.notMentioned).toEqual(m.notMentioned)
      })
      it('export', () => {
        const x = v.exportOpen
        expect(JSON.parse(exportOpen(x.title, x.date, x.promises))).toEqual(x.expect)
      })
      for (const c of v.copilotPrompt) {
        it(`Copilot prompt: ${c.name}`, () => {
          const template = aiFixture().pro.copilotPrompt as CopilotPromptTemplate
          expect(copilotPrompt(template, c.input).split('\n')).toEqual(c.text)
        })
      }
    })

    describe('repeat rules', () => {
      const r = v.repeatRule
      const taskOf = (t: Any) => ({ id: 1, due_date: iso(t.due), start_date: iso(t.start), end_date: iso(t.end), repeat_after: t.repeat_after, repeat_mode: t.repeat_mode })
      for (const c of r.completion) {
        it(`complete: ${c.name}`, () => {
          const plan = completionPlan(taskOf(c.task), c.rule, local(r.now))
          expect(plan.patches).toEqual(c.patches)
          expect(plan.rule === undefined ? 'unchanged' : plan.rule).toEqual(c.ruleAfter)
          expect(plan.catchUp).toBe(c.catchUp)
        })
      }
      for (const c of r.catchUp) {
        it(`catch up: ${c.name}`, () => {
          const patch = catchUpPatch(taskOf(c.task), r.today, c.until)
          const expected = c.patch ? Object.fromEntries(Object.entries(c.patch).map(([key, value]) => [key, iso(value as string)])) : null
          expect(patch).toEqual(expected)
        })
      }
    })

    describe('focus', () => {
      const f = v.focus
      const projects = new Map<number, Any>(f.projects.map((p: Any) => [p.id, p]))
      const category = (id: number) => f.categories[String(id)] ?? null
      it('in focus and shown', () => {
        const focus = readProFocus(f.focus)
        for (const [id, expected] of Object.entries(f.inFocus)) {
          expect([id, inFocus(Number(id), focus, projects, category, f.inbox)]).toEqual([id, expected])
          expect(inFocus(Number(id), null, projects, category, f.inbox)).toBe(true)
        }
        expect([...projectsShownInFocus(focus, projects, category, f.inbox)].sort((a, b) => a - b)).toEqual(f.shown)
      })
      it('reading', () => {
        for (const c of f.read) expect(readProFocus(c.value)).toEqual(c.expect)
      })
      it('the daily focus block', () => {
        const b = v.focusBlock
        const tasks = b.tasks.map((t: Any) => ({ id: t.id, project_id: t.project_id, due_date: iso(t.due), is_favorite: t.flagged === true, priority: t.priority ?? 0 }))
        expect(focusBlockCandidates(tasks, (id) => b.ranks[String(id)] ?? null)).toEqual(b.candidates)
        for (const c of b.minutes) expect(focusBlockMinutes(c.estimates)).toBe(c.expect)
      })
    })

    describe('weekly review', () => {
      it('steps and mirror', () => {
        const w = v.weeklyPro
        const ledger = ledgerOf(w.ledger)
        const tasks = w.tasks.map((t: Any) => ({ ...vectorTask(t), title: t.title }))
        expect(proWeeklySteps({ tasks, ledger, layers: DEFAULT_PRO_LAYERS, today: w.today, stalledInitiatives: w.stalledInitiatives }).map(({ id, count }) => ({ id, count }))).toEqual(w.steps)
        expect(proWeeklySteps({ tasks, ledger, layers: { ...DEFAULT_PRO_LAYERS, promises: false }, today: w.today, stalledInitiatives: w.stalledInitiatives }).map(({ id, count }) => ({ id, count }))).toEqual(w.stepsWithoutPromises)
        const mirror = weeklyMirror(tasks, ledger, w.today)
        expect(mirror).toEqual(w.mirror)
        expect(mirrorText(mirror)).toBe(w.mirrorText)
      })
    })

    describe('custom lists with Pro conditions', () => {
      const c = all.customListPro
      const tasks = c.tasks.map(vectorTask)
      const ledger = ledgerOf(c.ledger)
      const context = availabilityContext({ now: local(c.now), tasks, projects: c.projects, prefs: c.prefs, ledger })
      for (const entry of c.cases) {
        it(JSON.stringify(entry.filter) + (entry.noContext ? ' without the data' : ''), () => {
          const pro = entry.noContext ? undefined : { availability: context, ledger, projectOnHold: (id: number) => projectOnHold(c.prefs, id) }
          const matched = filterCustomList(tasks, { due_date_filter: 'all', ...entry.filter }, local(c.now), { pro }, local(c.now))
          expect(matched.map((task: Any) => task.id)).toEqual(entry.expect)
        })
      }
      it('reading the keys', () => {
        for (const entry of c.hasCondition) expect(hasProCondition(entry.filter)).toBe(entry.expect)
        for (const entry of c.rowFields) expect(readRowFields(entry.value)).toEqual(entry.expect)
        for (const entry of c.groupBy) expect(readGroupBy(entry.value)).toBe(entry.expect)
      })
    })
  })
}
