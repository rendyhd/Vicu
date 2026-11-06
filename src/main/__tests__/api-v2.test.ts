import { describe, expect, it } from 'vitest'
import {
  buildTaskAttachmentDownloadUrl,
  buildProjectCollectionUrl,
  buildProjectTaskCountUrl,
  createTaskCollectionSearchParams,
  finishTaskCollection,
  readEnvelopeTotal,
  withoutNestedSubtasks,
  COLLAB_SIGNALS_PARAM,
  buildTaskCommentsUrl,
  readCommentPage,
  sniffImageType,
} from '../api-v2'

describe('project collection URL', () => {
  it('requests archived projects only when the complete snapshot is needed', () => {
    expect(buildProjectCollectionUrl('https://vikunja.example/', true))
      .toBe('https://vikunja.example/api/v2/projects?is_archived=true&expand=permissions')
    expect(buildProjectCollectionUrl('https://vikunja.example/', false))
      .toBe('https://vikunja.example/api/v2/projects?expand=permissions')
  })
})

describe('collaboration requests', () => {
  it('asks for comment counts and unread flags only when told to, as repeated expands', () => {
    expect(createTaskCollectionSearchParams({}).getAll('expand')).toEqual(['subtasks'])
    const params = createTaskCollectionSearchParams({ [COLLAB_SIGNALS_PARAM]: true, filter: 'done = false' })
    expect(params.getAll('expand')).toEqual(['subtasks', 'comment_count', 'is_unread'])
    expect(params.has(COLLAB_SIGNALS_PARAM)).toBe(false)
  })

  it('reads comments newest first, 50 a page', () => {
    expect(buildTaskCommentsUrl('https://vikunja.example/', 12, 2)).toBe(
      'https://vikunja.example/api/v2/tasks/12/comments?order_by=desc&per_page=50&page=2',
    )
    expect(readCommentPage({ items: [{ id: 1 }], total_pages: 3 }, 2)).toEqual({ items: [{ id: 1 }], page: 2, totalPages: 3 })
    expect(readCommentPage({ items: null }, 1)).toEqual({ items: [], page: 1, totalPages: 1 })
  })

  it('recognises avatar images by their first bytes', () => {
    const enc = (s: string) => new TextEncoder().encode(s)
    expect(sniffImageType(enc('<svg viewBox="0 0 1 1"></svg>'))).toBe('image/svg+xml')
    expect(sniffImageType(enc('<?xml version="1.0"?>\n<svg width="1">'))).toBe('image/svg+xml')
    expect(sniffImageType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png')
    expect(sniffImageType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg')
    expect(sniffImageType(enc('<html><script>x</script>'))).toBeNull()
  })
})

describe('task hierarchy', () => {
  it('requests complete subtask hierarchies for task collections', () => {
    const params = createTaskCollectionSearchParams({
      q: 'needle',
      filter: 'done = false',
      page: 2,
    })

    expect(params.getAll('expand')).toEqual(['subtasks'])
    expect(params.get('q')).toBe('needle')
    expect(params.get('filter')).toBe('done = false')
    expect(params.get('page')).toBe('2')
  })

  it('keeps a child nested when its parent is in the same result', () => {
    const parent = { id: 1, title: 'Parent', related_tasks: { subtask: [{ id: 2 }] } }
    const child = { id: 2, title: 'Child', related_tasks: { parenttask: [{ id: 1 }] } }

    expect(withoutNestedSubtasks([parent, child])).toEqual([parent])
  })

  it('keeps a matching child visible when its parent is outside the result', () => {
    const child = { id: 2, title: 'Child', related_tasks: { parenttask: [{ id: 1 }] } }

    expect(withoutNestedSubtasks([child])).toEqual([child])
  })

  it('does not promote a child whose omitted parent is completed', () => {
    const child = {
      id: 2,
      title: 'Child',
      related_tasks: { parenttask: [{ id: 1, title: 'Parent', done: true }] },
    }

    expect(withoutNestedSubtasks([child])).toEqual([])
  })
})

describe('finishTaskCollection', () => {
  const parent = { id: 1, title: 'Parent', related_tasks: { subtask: [{ id: 2 }] } }
  const child = { id: 2, title: 'Child', related_tasks: { parenttask: [{ id: 1 }] } }

  it('hides nested subtasks by default', () => {
    expect(finishTaskCollection([parent, child], {})).toEqual([parent])
    expect(finishTaskCollection([parent, child], { filter: 'done = false' })).toEqual([parent])
  })

  it('keeps every task when the caller will filter first (Tag view, custom lists)', () => {
    expect(finishTaskCollection([parent, child], { keep_nested_subtasks: true })).toEqual([parent, child])
  })

  it('does not send the option to the server', () => {
    const query = createTaskCollectionSearchParams({ filter: 'done = false', keep_nested_subtasks: true })
    expect([...query.keys()].sort()).toEqual(['expand', 'filter'])
  })
})

describe('buildTaskAttachmentDownloadUrl', () => {
  it('builds the original attachment URL without a preview size', () => {
    expect(buildTaskAttachmentDownloadUrl('https://vikunja.example/', 42, 7))
      .toBe('https://vikunja.example/api/v2/tasks/42/attachments/7')
  })

  it('requests a bounded server-side image preview', () => {
    expect(buildTaskAttachmentDownloadUrl('https://vikunja.example/base', 42, 7, 'lg'))
      .toBe('https://vikunja.example/base/api/v2/tasks/42/attachments/7?preview_size=lg')
  })
})

describe('project task count request', () => {
  it('asks for a page of one task, filtered by done, in the project', () => {
    const done = new URL(buildProjectTaskCountUrl('https://vikunja.example/', 42, true))
    expect(done.pathname).toBe('/api/v2/projects/42/tasks')
    expect(done.searchParams.get('filter')).toBe('done = true')
    expect(done.searchParams.get('per_page')).toBe('1')
    expect(done.searchParams.has('page')).toBe(false)

    const open = new URL(buildProjectTaskCountUrl('https://vikunja.example', 7, false))
    expect(open.searchParams.get('filter')).toBe('done = false')
  })

  it('reads the total of the envelope and nothing else', () => {
    expect(readEnvelopeTotal({ items: [], total: 12, page: 1, per_page: 1, total_pages: 12 })).toBe(12)
    expect(readEnvelopeTotal({ items: null, total: 0 })).toBe(0)
    expect(readEnvelopeTotal({ items: [] })).toBeNull()
    expect(readEnvelopeTotal({ total: '3' })).toBeNull()
    expect(readEnvelopeTotal({ total: -1 })).toBeNull()
    expect(readEnvelopeTotal([])).toBeNull()
    expect(readEnvelopeTotal(null)).toBeNull()
  })
})
