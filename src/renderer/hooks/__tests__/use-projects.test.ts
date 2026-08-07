import { describe, expect, it } from 'vitest'
import { selectProjectCollections } from '../use-projects'
import type { Project } from '@/lib/vikunja-types'

function project(id: number, options: Partial<Project> = {}): Project {
  return {
    id,
    title: `Project ${id}`,
    description: '',
    parent_project_id: 0,
    is_archived: false,
    hex_color: '',
    position: id,
    created: '',
    updated: '',
    ...options,
  }
}

describe('selectProjectCollections', () => {
  it('keeps archived projects available to Settings but out of normal collections', () => {
    const selected = selectProjectCollections([
      project(1),
      project(2, { is_archived: true }),
    ])

    expect(selected.flat.map((item) => item.id)).toEqual([1])
    expect(selected.archived.map((item) => item.id)).toEqual([2])
    expect(selected.all.map((item) => item.id)).toEqual([1, 2])
  })

  it('re-roots an active child when its parent is archived', () => {
    const selected = selectProjectCollections([
      project(1, { is_archived: true }),
      project(2, { parent_project_id: 1 }),
    ])

    expect(selected.tree.map((item) => item.id)).toEqual([2])
  })
})
