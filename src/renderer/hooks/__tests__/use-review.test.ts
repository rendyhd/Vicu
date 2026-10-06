import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cadenceDescription,
  excludeDescription,
  reviewedDescription,
} from '../use-review'
import { updateProjectRequest } from '../use-task-mutations'
import { PROJECT_WRITABLE_FIELDS } from '@/lib/merge-patches'
import { parseReviewFooter } from '@/lib/review-metadata'
import type { Project } from '@/lib/vikunja-types'
import type { ProjectTreeNode } from '../use-projects'

// The Review screen hands these hooks a ProjectTreeNode, which carries `children`.
// Vikunja 2.4 answers a PATCH containing it with 422 "unexpected property body.children".
function treeNode(overrides: Partial<Project> = {}): ProjectTreeNode {
  const child: ProjectTreeNode = {
    id: 6,
    title: 'Child',
    description: '',
    parent_project_id: 5,
    is_archived: false,
    hex_color: '',
    position: 1,
    created: '',
    updated: '',
    children: [],
  }
  return {
    id: 5,
    title: 'Parent',
    description: 'Notes written by Android',
    parent_project_id: 0,
    is_archived: false,
    hex_color: 'ff0000',
    position: 2048,
    created: '2026-10-01T00:00:00Z',
    updated: '2026-10-01T00:00:00Z',
    children: [child],
    ...overrides,
  }
}

let updateProject: ReturnType<typeof vi.fn>

beforeEach(() => {
  updateProject = vi.fn(async () => ({ success: true as const, data: {} }))
  vi.stubGlobal('window', { api: { updateProject } })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function save(project: ProjectTreeNode, description: string | null): Promise<Record<string, unknown>> {
  if (description === null) throw new Error('expected a changed description')
  await updateProjectRequest({ id: project.id, changes: { description }, original: project })
  return updateProject.mock.calls.at(-1)?.[1] as Record<string, unknown>
}

describe('review project payloads', () => {
  it('mark reviewed sends only the description', async () => {
    const node = treeNode()

    const payload = await save(node, reviewedDescription(node, '2026-10-06'))

    expect(Object.keys(payload)).toEqual(['description'])
    expect(parseReviewFooter(payload.description as string)).toMatchObject({
      state: 'reviewed',
      lastReviewedAt: '2026-10-06',
    })
    expect(payload.description).toContain('Notes written by Android')
  })

  it('set cadence sends only the description', async () => {
    const node = treeNode()

    const payload = await save(node, cadenceDescription(node, 30))

    expect(Object.keys(payload)).toEqual(['description'])
    expect(parseReviewFooter(payload.description as string).cadenceDaysOverride).toBe(30)
  })

  it('exclude and re-include send only the description', async () => {
    const node = treeNode()

    const excluded = await save(node, excludeDescription(node, true))
    expect(Object.keys(excluded)).toEqual(['description'])
    expect(parseReviewFooter(excluded.description as string).state).toBe('excluded')

    const back = treeNode({ description: excluded.description as string })
    const included = await save(back, excludeDescription(back, false))
    expect(Object.keys(included)).toEqual(['description'])
    expect(parseReviewFooter(included.description as string).state).toBe('never')
  })

  it('never sends children or any key outside the PATCH schema', async () => {
    const node = treeNode()
    const payloads = [
      await save(node, reviewedDescription(node, '2026-10-06')),
      await save(node, cadenceDescription(node, 7)),
      await save(node, excludeDescription(node, true)),
    ]

    for (const payload of payloads) {
      expect('children' in payload).toBe(false)
      for (const key of Object.keys(payload)) {
        expect(PROJECT_WRITABLE_FIELDS as readonly string[]).toContain(key)
      }
    }
  })

  it('does not write when the review state is already what was asked for', () => {
    const reviewed = treeNode({ description: 'Notes\n\n---\n**Vicu review**: 2026-10-06' })

    expect(reviewedDescription(reviewed, '2026-10-06')).toBeNull()
    const never = treeNode({ description: 'Notes\n\n---\n**Vicu review**: never' })
    expect(excludeDescription(never, false)).toBeNull()
  })

  it('undo restores the previous description without diffing against the cache', async () => {
    const before = treeNode()

    await updateProjectRequest({ id: before.id, changes: { description: before.description } })

    expect(updateProject).toHaveBeenCalledWith(5, { description: 'Notes written by Android' })
  })
})
