import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  childCandidates,
  parentCandidates,
  planAttach,
  planAttachMany,
  subtaskWorld,
  subtaskWorldOf,
  undoAttach,
  type AttachPlan,
  type ParentCandidate,
} from '../subtask-attach'

interface World { parents: Record<string, number[]>; projects: Record<string, number> }

const fixture = JSON.parse(readFileSync(join(process.cwd(), 'test-fixtures', 'cross-app-semantics-v1.json'), 'utf8')) as {
  subtaskAttach: {
    world: World
    plan: Array<{ name: string; world?: World; task: number; parent: number; expect: Record<string, unknown> }>
    selection: Array<{ name: string; world?: World; tasks: number[]; parent: number; expect: unknown }>
    undo: Array<{ name: string; plan: AttachPlan; fromProject: number; expect: Record<string, unknown> }>
    candidates: {
      tasks: ParentCandidate[]
      writable: number[]
      vectors: Array<{ name: string; world?: World; attaching: number[]; search: string; expect: number[] }>
      children: Array<{ name: string; parent: number; search: string; expect: number[] }>
    }
  }
}

const vectors = fixture.subtaskAttach

function worldOf(world: World = vectors.world) {
  const parents = new Map(Object.entries(world.parents).map(([id, ids]) => [Number(id), ids]))
  const projects = new Map(Object.entries(world.projects).map(([id, project]) => [Number(id), project]))
  return subtaskWorld(parents, projects)
}

describe('subtaskAttach (contract section 24)', () => {
  describe('plan', () => {
    for (const vector of vectors.plan) {
      it(vector.name, () => {
        const plan = planAttach(worldOf(vector.world), vector.task, vector.parent)
        if ('refusal' in plan) expect(plan).toEqual(vector.expect)
        else expect(plan).toEqual({ task: vector.task, ...vector.expect })
      })
    }
  })

  describe('selection', () => {
    for (const vector of vectors.selection) {
      it(vector.name, () => {
        expect(planAttachMany(worldOf(vector.world), vector.tasks, vector.parent)).toEqual(vector.expect)
      })
    }
  })

  describe('undo', () => {
    for (const vector of vectors.undo) {
      it(vector.name, () => {
        expect(undoAttach(vector.plan, vector.fromProject)).toEqual({ task: vector.plan.task, ...vector.expect })
      })
    }
  })

  describe('candidates', () => {
    const writable = new Set(vectors.candidates.writable)
    for (const vector of vectors.candidates.vectors) {
      it(vector.name, () => {
        const offered = parentCandidates(worldOf(vector.world), vectors.candidates.tasks, {
          attaching: vector.attaching,
          writable,
          search: vector.search,
        })
        expect(offered.map((task) => task.id)).toEqual(vector.expect)
      })
    }
    for (const vector of vectors.candidates.children) {
      it(`Add existing task: ${vector.name}`, () => {
        const offered = childCandidates(worldOf(), vectors.candidates.tasks, { parent: vector.parent, writable, search: vector.search })
        expect(offered.map((task) => task.id)).toEqual(vector.expect)
      })
    }
  })
})

describe('subtaskWorldOf', () => {
  it('reads the relation from either side', () => {
    const world = subtaskWorldOf([
      { id: 1, project_id: 10, related_tasks: { subtask: [{ id: 2 }] } },
      { id: 3, project_id: 20, related_tasks: { parenttask: [{ id: 1 }] } },
      { id: 2, project_id: 10, related_tasks: { parenttask: [{ id: 1 }] } },
    ])
    expect(world.parentsOf(2)).toEqual([1])
    expect(world.parentsOf(3)).toEqual([1])
    expect(world.parentsOf(1)).toEqual([])
    expect(world.projectOf(3)).toBe(20)
    expect(world.projectOf(9)).toBeUndefined()
  })
})
