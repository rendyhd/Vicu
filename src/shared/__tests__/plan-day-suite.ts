import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  acceptChanges,
  comingUpTasks,
  draftBlocks,
  inboxCandidates,
  leftoverChanges,
  leftoversQueue,
  onDayTasks,
  planMeter,
  withStartReminder,
  withoutStartReminder,
  withoutTasks,
  type LeftoverAction,
  type PlanSessionTask,
} from '../plan-day'
import { clockText, freeRanges, busyOfDay, type PlannerHours } from '../time-blocks'

// Section 14.10, run in three zones like the other date suites.

interface FixtureTask {
  id: number
  title: string
  due?: string
  start?: string
  end?: string
  priority?: number
  project?: number
  done?: boolean
}

const fixture = JSON.parse(
  readFileSync(join(__dirname, '../../../test-fixtures/cross-app-semantics-v1.json'), 'utf8'),
).planSession as {
  now: string
  hours: PlannerHours
  defaultLength: number
  inboxProjectId: number
  tasks: FixtureTask[]
  leftovers: number[]
  leftoverActions: { name: string; task: number; action: LeftoverAction; expect: { due?: string | null; start?: string | null; end?: string | null; done?: boolean } }[]
  groups: { name: string; day: string; expect: { onDay: number[]; inbox: number[]; comingUp: number[] } }[]
  freeRanges: { name: string; day: string; expect: number[][] }[]
  meter: { name: string; day: string; ticked: number[]; lengths?: Record<string, number>; keep?: number[]; pins?: Record<string, [number, number]>; expect: object }[]
  draft: {
    name: string
    day: string
    ticked: number[]
    lengths?: Record<string, number>
    keep?: number[]
    pins?: Record<string, [number, number]>
    starts?: [number, number][]
    expect: { placed: [number, number, number][]; noSlot: number[] }
  }[]
  accept: { name: string; task: number; day: string; draft?: [number, number]; expect: { due: string | null; start: string | null; end: string | null } | null }[]
  reminders: { name: string; before: object[]; expect: object[] }[]
}

const NULL_DATE = '0001-01-01T00:00:00Z'
const iso = (local: string | undefined) => (local ? new Date(local).toISOString() : NULL_DATE)
const pad = (n: number) => String(n).padStart(2, '0')
const wall = (value: string | null | undefined): string | null => {
  if (value === null || value === undefined || value === NULL_DATE) return null
  const d = new Date(value)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

const toTask = (task: FixtureTask): PlanSessionTask => ({
  id: task.id,
  project_id: task.project ?? 2,
  done: task.done === true,
  priority: task.priority ?? 0,
  due_date: iso(task.due),
  start_date: iso(task.start),
  end_date: iso(task.end),
})

const numberMap = <V>(record: Record<string, V> | undefined) =>
  new Map(Object.entries(record ?? {}).map(([key, value]) => [Number(key), value] as const))

export function runPlanDaySuite({ zone }: { zone: string }): void {
  describe(`Plan my day (section 14.10) in ${zone}`, () => {
    const now = () => new Date(fixture.now)
    const tasks = () => fixture.tasks.map(toTask)
    const byId = (id: number) => tasks().find((task) => task.id === id) as PlanSessionTask
    const options = (day: string) => ({ now: now(), day, hours: fixture.hours, defaultLength: fixture.defaultLength })

    it('the leftovers queue, oldest first', () => {
      expect(leftoversQueue(tasks(), now()).map((task) => task.id)).toEqual(fixture.leftovers)
    })

    for (const vector of fixture.leftoverActions) {
      it(`leftover action: ${vector.name}`, () => {
        const changes = leftoverChanges(byId(vector.task), vector.action, now())
        if (vector.expect.done) {
          expect(changes).toEqual({ done: true })
          return
        }
        expect(wall(changes.due_date)).toBe(vector.expect.due)
        expect(changes.start_date).toBeNull()
        expect(changes.end_date).toBeNull()
      })
    }

    for (const vector of fixture.groups) {
      it(`the groups: ${vector.name}`, () => {
        const onDay = onDayTasks(tasks(), vector.day, now())
        expect(onDay.map((task) => task.id)).toEqual(vector.expect.onDay)
        const inbox = withoutTasks(inboxCandidates(tasks(), fixture.inboxProjectId), onDay)
        expect(inbox.map((task) => task.id)).toEqual(vector.expect.inbox)
        const comingUp = withoutTasks(comingUpTasks(tasks(), vector.day), onDay)
        expect(comingUp.map((task) => task.id)).toEqual(vector.expect.comingUp)
      })
    }

    for (const vector of fixture.freeRanges) {
      it(`free ranges: ${vector.name}`, () => {
        const ranges = freeRanges(now(), vector.day, fixture.hours, busyOfDay(tasks(), vector.day))
        expect(ranges).toEqual(vector.expect)
      })
    }

    for (const vector of fixture.meter) {
      it(`the meter: ${vector.name}`, () => {
        const ticked = vector.ticked.map(byId)
        const meter = planMeter(ticked, tasks(), {
          ...options(vector.day),
          lengths: numberMap(vector.lengths),
          keep: new Set(vector.keep),
          pins: numberMap(vector.pins),
        })
        expect(meter).toEqual(vector.expect)
      })
    }

    for (const vector of fixture.draft) {
      it(`the draft: ${vector.name}`, () => {
        const ticked = vector.ticked.map(byId)
        const draft = draftBlocks(ticked, tasks(), {
          ...options(vector.day),
          lengths: numberMap(vector.lengths),
          keep: new Set(vector.keep),
          pins: numberMap(vector.pins),
          starts: vector.starts,
        })
        expect(draft.placed.map((block) => [block.id, block.start, block.end])).toEqual(vector.expect.placed)
        expect(draft.noSlot).toEqual(vector.expect.noSlot)
      })
    }

    for (const vector of fixture.accept) {
      it(`accepting: ${vector.name}`, () => {
        const draft = vector.draft ? { start: vector.draft[0], end: vector.draft[1] } : null
        const changes = acceptChanges(byId(vector.task), vector.day, draft)
        if (vector.expect === null) {
          expect(changes).toBeNull()
          return
        }
        expect(changes).not.toBeNull()
        expect(wall(changes?.due_date)).toBe(vector.expect.due)
        expect(wall(changes?.start_date)).toBe(vector.expect.start)
        expect(wall(changes?.end_date)).toBe(vector.expect.end)
      })
    }

    for (const vector of fixture.reminders) {
      it(`reminders: ${vector.name}`, () => {
        const added = withStartReminder(vector.before)
        expect(added).toEqual(vector.expect)
        expect(withStartReminder(added)).toEqual(vector.expect)
      })
    }

    it('turning the reminders off takes only those away', () => {
      const kept = { relative_to: 'due_date', relative_period: -3600 }
      expect(withoutStartReminder([kept, { relative_to: 'start_date', relative_period: 0 }])).toEqual([kept])
    })

    // Contract 20.2: the day's events are busy time for the meter and the draft (desktop only, the
    // fixture's vectors have no events; with none the vectors above are unchanged).
    it('the meter counts the busy time of events, overlaps once', () => {
      const ticked = [2, 1].map(byId)
      const plain = planMeter(ticked, tasks(), options('2026-10-27'))
      const call = planMeter(ticked, tasks(), { ...options('2026-10-27'), eventBusy: [[540, 600]] })
      // Now is 09:10: the event takes 09:10 to 10:00.
      expect(call.free).toBe(plain.free - 50)
      // An event at the same time as a block takes nothing more.
      const same = planMeter(ticked, tasks(), { ...options('2026-10-27'), eventBusy: [[660, 720]] })
      expect(same.free).toBe(plain.free)
    })

    it('the draft places nothing over a busy event', () => {
      const ticked = [2, 1, 5, 4, 7].map(byId)
      const draft = draftBlocks(ticked, tasks(), { ...options('2026-10-27'), eventBusy: [[540, 600]] })
      expect(draft.placed.map((block) => [block.id, block.start, block.end])).toEqual([
        [2, 600, 630],
        [1, 630, 660],
        [5, 720, 750],
        [4, 750, 780],
        [7, 780, 810],
      ])
      // The assistant's start inside the event does not fit and is laid out like the rest.
      const asked = draftBlocks([byId(4)], tasks(), { ...options('2026-10-27'), eventBusy: [[540, 600]], starts: [[4, 570]] })
      expect(asked.placed.map((block) => [block.id, block.start, block.end])).toEqual([[4, 600, 630]])
    })

    it('clock text and minutes agree for the request', () => {
      expect(clockText(555)).toBe('09:15')
    })
  })
}
