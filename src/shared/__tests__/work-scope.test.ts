import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  effectiveWorkMode,
  isWorkProArea,
  isWorkTask,
  isWritableWorkValue,
  newTaskStaysPersonal,
  parseWorkMode,
  proAllowedInWorkMode,
  projectsShownInMode,
  readWorkLabel,
  shownInWorkMode,
  workEntryToWrite,
  workLabelForNewTask,
  workModeClause,
  workProjectIdOfKey,
  workProjectIds,
  workProjectKey,
  WORK_LABEL_KEY,
  type WorkMode,
  type WorkModeSwitches,
  type WorkScope,
} from '../work-scope'

interface FixtureTask {
  id: number
  project: number
  labels: number[] | null
  parent?: number
}

interface Fixture {
  workMode: {
    inboxProjectId: number
    projects: Array<{ id: number; parent: number }>
    keys: Array<{ key: string; expect: number | null }>
    writable: Array<{ key: string; value: unknown; expect: boolean }>
    label: Array<{ value: unknown; expect: number | null }>
    resolve: Array<{ name: string; entries: Record<string, unknown>; expect: number[] }>
    tasks: FixtureTask[]
    classify: Array<{ name: string; entries: Record<string, unknown>; expectWork: number[] }>
    modes: Array<{ value: unknown; expect: WorkMode }>
    effective: Array<{ name: string; settings: WorkModeSwitches; expect: WorkMode }>
    rows: {
      label: number
      tasks: FixtureTask[]
      vectors: Array<{ name: string; mode: WorkMode; nested: boolean; expect: number[] }>
    }
    projectList: { entries: Record<string, unknown>; vectors: Array<{ mode: WorkMode; expect: number[] }> }
    newTask: Array<{
      name: string
      mode: WorkMode
      label: number | null
      workProjects: number[]
      task: { project: number; labels: number[] }
      expectAdd: number | null
      expectStaysPersonal: boolean
    }>
    mark: Array<{ name: string; parentIsWork: boolean; want: boolean; expectWrite: boolean | null }>
    proOnly: Array<{ name: string; settings: WorkModeSwitches; expectProAllowed: boolean }>
    proArea: Array<{ value: unknown; expectWork: boolean }>
    clause: Array<{
      name: string
      mode: WorkMode
      label: number | null
      workProjects: number[]
      expect: string | null
      expectEmpty: boolean
    }>
  }
}

const fixture = JSON.parse(
  readFileSync(join(process.cwd(), 'test-fixtures', 'cross-app-semantics-v1.json'), 'utf8'),
) as Fixture
const world = fixture.workMode

const projects = world.projects.map((project) => ({ id: project.id, parent_project_id: project.parent }))
const sorted = (ids: Iterable<number>) => [...ids].sort((a, b) => a - b)
const taskOf = (task: { id?: number; project: number; labels: number[] | null }) => ({
  id: task.id ?? 0,
  project_id: task.project,
  labels: task.labels === null ? null : task.labels.map((id) => ({ id })),
})

function scopeOf(entries: Record<string, unknown>): WorkScope {
  return {
    label: readWorkLabel(entries[WORK_LABEL_KEY]),
    projects: workProjectIds(projects, (id) => entries[workProjectKey(id)], world.inboxProjectId),
  }
}

describe('workMode (contract section 22)', () => {
  for (const vector of world.keys) {
    it(`key ${vector.key}`, () => expect(workProjectIdOfKey(vector.key)).toBe(vector.expect))
  }

  for (const vector of world.writable) {
    it(`writable ${vector.key} = ${JSON.stringify(vector.value)}`, () => {
      expect(isWritableWorkValue(vector.key, vector.value)).toBe(vector.expect)
    })
  }

  for (const vector of world.label) {
    it(`label ${JSON.stringify(vector.value)}`, () => expect(readWorkLabel(vector.value)).toBe(vector.expect))
  }

  for (const vector of world.resolve) {
    it(`work projects: ${vector.name}`, () => expect(sorted(scopeOf(vector.entries).projects)).toEqual(vector.expect))
  }

  for (const vector of world.classify) {
    it(`work tasks: ${vector.name}`, () => {
      const scope = scopeOf(vector.entries)
      expect(world.tasks.filter((task) => isWorkTask(taskOf(task), scope)).map((task) => task.id)).toEqual(
        vector.expectWork,
      )
    })
  }

  for (const vector of world.modes) {
    it(`mode ${JSON.stringify(vector.value)}`, () => expect(parseWorkMode(vector.value)).toBe(vector.expect))
  }

  for (const vector of world.effective) {
    it(`mode in effect: ${vector.name}`, () => expect(effectiveWorkMode(vector.settings)).toBe(vector.expect))
  }

  for (const vector of world.rows.vectors) {
    it(`rows: ${vector.name}`, () => {
      const scope: WorkScope = { label: world.rows.label, projects: new Set() }
      const parents = new Map(world.rows.tasks.map((task) => [task.id, task.parent ?? null]))
      const shown = shownInWorkMode(
        world.rows.tasks.map(taskOf),
        scope,
        vector.mode,
        vector.nested ? (task) => parents.get(task.id) : undefined,
      )
      expect(shown.map((task) => task.id)).toEqual(vector.expect)
    })
  }

  for (const vector of world.projectList.vectors) {
    it(`project list in ${vector.mode}`, () => {
      const work = scopeOf(world.projectList.entries).projects
      expect(sorted(projectsShownInMode(projects, work, vector.mode, world.inboxProjectId))).toEqual(vector.expect)
    })
  }

  for (const vector of world.newTask) {
    it(`new task: ${vector.name}`, () => {
      const scope: WorkScope = { label: vector.label, projects: new Set(vector.workProjects) }
      const task = taskOf(vector.task)
      expect(workLabelForNewTask(task, scope, vector.mode)).toBe(vector.expectAdd)
      expect(newTaskStaysPersonal(task, scope, vector.mode)).toBe(vector.expectStaysPersonal)
    })
  }

  for (const vector of world.mark) {
    it(`marking: ${vector.name}`, () => {
      expect(workEntryToWrite(vector.want, vector.parentIsWork)).toBe(vector.expectWrite)
    })
  }

  for (const vector of world.proOnly) {
    it(`Pro: ${vector.name}`, () => expect(proAllowedInWorkMode(vector.settings)).toBe(vector.expectProAllowed))
  }

  for (const vector of world.proArea) {
    it(`Pro's area ${JSON.stringify(vector.value)}`, () => expect(isWorkProArea(vector.value)).toBe(vector.expectWork))
  }

  for (const vector of world.clause) {
    it(`server clause: ${vector.name}`, () => {
      const scope: WorkScope = { label: vector.label, projects: new Set(vector.workProjects) }
      expect(workModeClause(scope, vector.mode)).toEqual({ clause: vector.expect, empty: vector.expectEmpty })
    })
  }
})
