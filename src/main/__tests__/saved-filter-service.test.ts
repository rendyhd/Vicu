import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Saved filters and project views as custom lists (cross-app semantics 3.7 and 3.9) against an
// in-memory Vikunja: the first-connect import, importing again (Overwrite, Skip, Undo), the
// "Changed in Vikunja" offer and the project views. Android has the same cases in SavedFiltersTest.

const state = vi.hoisted(() => ({
  dir: '',
  tasks: new Map<number, { id: number; title: string; description: string; done: boolean; project_id: number }>(),
  nextId: 100,
  sent: [] as Array<{ channel: string; payload: unknown }>,
  requests: [] as string[],
  /** The pseudo-projects `GET projects` lists among the real ones. */
  pseudo: [] as Array<{ id: number; title: string; updated?: string }>,
  filters: new Map<number, unknown>(),
  views: new Map<number, unknown[]>(),
}))

vi.mock('electron', () => ({
  app: { getPath: () => state.dir },
  safeStorage: { isEncryptionAvailable: () => false },
  BrowserWindow: {
    getAllWindows: () => [
      {
        isDestroyed: () => false,
        webContents: { send: (channel: string, payload?: unknown) => { state.sent.push({ channel, payload }) } },
      },
    ],
  },
}))

vi.mock('../api-client', () => ({
  fetchTasks: async (params: Record<string, unknown>) => {
    let rows = [...state.tasks.values()].filter((task) => task.done || (typeof params.q === 'string' && params.filter === undefined))
    if (typeof params.q === 'string') rows = rows.filter((task) => task.description.includes(params.q as string))
    return { success: true, data: rows.map((task) => ({ created_by: { id: 1 }, ...task })) }
  },
  fetchTaskById: async (id: number) => {
    const task = state.tasks.get(id)
    return task ? { success: true, data: { created_by: { id: 1 }, ...task } } : { success: false, error: 'Not found', statusCode: 404 }
  },
  createTask: async (projectId: number, body: { title: string; description: string; done?: boolean }) => {
    const task = { id: state.nextId++, title: body.title, description: body.description, done: body.done === true, project_id: projectId }
    state.tasks.set(task.id, task)
    return { success: true, data: { ...task } }
  },
  updateTask: async (id: number, patch: { description?: string; done?: boolean }) => {
    const task = state.tasks.get(id)
    if (!task) return { success: false, error: 'Not found', statusCode: 404 }
    if (patch.description !== undefined) task.description = patch.description
    if (patch.done !== undefined) task.done = patch.done
    return { success: true, data: { ...task } }
  },
  deleteTask: async (id: number) => {
    state.tasks.delete(id)
    return { success: true, data: undefined }
  },
  fetchProjectsAndSavedFilters: async () => {
    state.requests.push('projects')
    return { success: true, data: { projects: [{ id: 4, title: 'Home', position: 1 }], pseudo: state.pseudo.map((p) => ({ ...p })) } }
  },
  fetchSavedFilter: async (id: number) => {
    state.requests.push(`filters/${id}`)
    const filter = state.filters.get(id)
    return filter ? { success: true, data: structuredClone(filter) } : { success: false, error: 'Not found', statusCode: 404 }
  },
  fetchProjectViews: async (projectId: number) => {
    state.requests.push(`projects/${projectId}/views`)
    return { success: true, data: structuredClone(state.views.get(projectId) ?? []) }
  },
}))

type Service = typeof import('../saved-filter-service')
type Lists = typeof import('../custom-list-service')

async function load(): Promise<{ filters: Service; lists: Lists }> {
  vi.resetModules()
  const filters = await import('../saved-filter-service')
  const lists = await import('../custom-list-service')
  filters.startSavedFilterImport()
  return { filters, lists }
}

function writeConfig(extra: Record<string, unknown> = {}) {
  writeFileSync(join(state.dir, 'config.json'), JSON.stringify({
    vikunja_url: 'https://tasks.example.com',
    api_token: 'unused',
    known_user: { server: 'https://tasks.example.com', id: 1 },
    inbox_project_id: 5,
    theme: 'dark',
    custom_lists: [],
    ...extra,
  }), 'utf-8')
}

const savedFilters = () =>
  (JSON.parse(readFileSync(join(state.dir, 'config.json'), 'utf-8')) as { saved_filters?: Record<string, unknown> }).saved_filters

const filterOne = (rule = 'done = false && priority > 2', updated = '2026-11-05T09:00:00Z') => ({
  id: 1,
  title: 'High Priority',
  updated,
  filters: { filter: rule, sort_by: ['priority'], order_by: ['desc'] },
})

/** Vikunja changes filter 1: its rule and the pseudo-project's `updated`. */
function changeFilterOne(rule: string, updated: string) {
  state.filters.set(1, filterOne(rule, updated))
  state.pseudo = state.pseudo.map((p) => (p.id === -2 ? { ...p, updated } : p))
}

async function settle(lists: Lists) {
  await vi.waitFor(() => expect(lists.getCustomListSyncStatus().state).toBe('idle'))
}

/** A device that went through its first connect: filter 1 is imported as one list. */
async function imported() {
  writeConfig()
  const loaded = await load()
  await loaded.lists.syncCustomLists()
  await settle(loaded.lists)
  return loaded
}

describe('saved-filter service', () => {
  beforeEach(() => {
    state.dir = mkdtempSync(join(tmpdir(), 'vicu-saved-filters-'))
    state.tasks.clear()
    state.nextId = 100
    state.sent.length = 0
    state.requests.length = 0
    state.pseudo = [
      { id: -1, title: 'Favorites' },
      { id: -2, title: 'High Priority', updated: '2026-11-05T09:00:00Z' },
      { id: -4, title: 'Broken', updated: '2026-11-01T08:00:00Z' },
    ]
    state.filters = new Map<number, unknown>([
      [1, filterOne()],
      [3, { id: 3, title: 'Broken', filters: { filter: 'priority >> 2' } }],
    ])
    state.views = new Map<number, unknown[]>([[4, [
      { id: 21, project_id: 4, title: 'List', view_kind: 'list', position: 1, filter: { filter: 'done = false', s: '', sort_by: null, order_by: null, filter_include_nulls: false }, updated: '2026-10-01T08:00:00Z' },
      { id: 22, project_id: 4, title: 'All items', view_kind: 'list', position: 2, filter: null, updated: '2026-11-03T10:00:00Z' },
      { id: 23, project_id: 4, title: 'Kanban', view_kind: 'kanban', position: 3, filter: null, updated: '2026-10-01T08:00:00Z' },
    ]]])
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(state.dir, { recursive: true, force: true })
  })

  it('first connect imports every readable filter once, with its base', async () => {
    const { filters, lists } = await imported()
    const all = lists.getCustomLists()
    expect(all).toHaveLength(1)
    expect(all[0].saved_filter_id).toBe(1)
    expect(all[0].import_base).toEqual({
      updated: '2026-11-05T09:00:00Z',
      name: 'High Priority',
      rule: 'done = false && priority > 2',
      sort_by: 'priority',
      order_by: 'desc',
    })
    expect(filters.getSavedFilterState().imported).toEqual([1])
    expect(savedFilters()?.known).toEqual([
      { id: 1, title: 'High Priority', updated: '2026-11-05T09:00:00Z' },
      { id: 3, title: 'Broken', updated: '2026-11-01T08:00:00Z' },
    ])

    // Later syncs import nothing more.
    await lists.syncCustomLists()
    await settle(lists)
    expect(lists.getCustomLists()).toHaveLength(1)
  })

  it('importing again compares, overwrites in place and undoes', async () => {
    const { filters, lists } = await imported()
    const listId = lists.getCustomLists()[0].id
    lists.upsertCustomList({ ...lists.getCustomListWires()[0], name: 'Prio' })
    lists.upsertCustomList({ id: 'after', name: 'After', icon: '', filter: { ...lists.getCustomListWires()[0].filter, rule: undefined } })
    await settle(lists)
    changeFilterOne('done = false && priority > 3', '2026-11-05T10:00:00Z')

    const preview = (await filters.previewSavedFilters())!.find((item) => item.filter_id === 1)!
    expect(preview.existing?.id).toBe(listId)
    expect(preview.comparison?.status).toBe('both')
    expect(preview.comparison?.parts.name).toBe('vicu')
    expect(preview.comparison?.parts.rule).toBe('vikunja')

    // Asking for a source that has a list never adds a second one.
    expect(await filters.applySavedFilterImport(['filter:1'], [])).toEqual({ count: 0, list_id: null })
    expect(lists.getCustomLists()).toHaveLength(2)

    const outcome = await filters.applySavedFilterImport([], [{ key: 'filter:1', answer: 'overwrite' }])
    expect(outcome).toMatchObject({ count: 0, updated: 1, skipped: 0 })
    const updated = lists.getCustomLists()
    expect(updated.map((list) => list.id)).toEqual([listId, 'after'])
    expect(updated[0].name).toBe('High Priority')
    expect(updated[0].filter.rule).toBe('done = false && priority > 3')
    expect(updated[0].import_base?.updated).toBe('2026-11-05T10:00:00Z')
    expect(state.sent.some((entry) => entry.channel === 'saved-filters-imported')).toBe(true)

    expect(filters.undoSavedFilterImport(outcome!.undo_id!)).toBe(true)
    const undone = lists.getCustomLists()
    expect(undone.map((list) => list.id)).toEqual([listId, 'after'])
    expect(undone[0].name).toBe('Prio')
    expect(undone[0].filter.rule).toBe('done = false && priority > 2')
    expect(undone[0].import_base?.updated).toBe('2026-11-05T09:00:00Z')
    expect(filters.undoSavedFilterImport(outcome!.undo_id!)).toBe(false)
  })

  it('Skip keeps the list and takes the new base', async () => {
    const { filters, lists } = await imported()
    changeFilterOne('done = false && priority > 3', '2026-11-05T10:00:00Z')
    await filters.previewSavedFilters()
    const outcome = await filters.applySavedFilterImport([], [{ key: 'filter:1', answer: 'skip' }])
    expect(outcome).toMatchObject({ updated: 0, skipped: 1 })

    const kept = lists.getCustomLists()[0]
    expect(kept.filter.rule).toBe('done = false && priority > 2')
    expect(kept.import_base?.updated).toBe('2026-11-05T10:00:00Z')
    const again = (await filters.previewSavedFilters())!.find((item) => item.filter_id === 1)!
    expect(again.comparison?.status).toBe('vicu')
  })

  it('offers a filter changed in Vikunja once per change, until Not now', async () => {
    const { filters, lists } = await imported()
    expect(filters.getSavedFilterState().changed_offer).toEqual([])

    changeFilterOne('done = false && priority > 3', '2026-11-05T10:00:00Z')
    filters.recordKnownSavedFilters(state.pseudo)
    state.requests.length = 0
    await lists.syncCustomLists()
    await settle(lists)
    expect(filters.getSavedFilterState().changed_offer.map((ref) => ref.id)).toEqual([1])
    expect(state.requests).toEqual(['filters/1'])

    // Read once per change.
    state.requests.length = 0
    await lists.syncCustomLists()
    await settle(lists)
    expect(state.requests).toEqual([])

    filters.dismissSavedFilters([], [1])
    expect(filters.getSavedFilterState().changed_offer).toEqual([])
    expect(lists.getCustomLists()).toHaveLength(1)
  })

  it('does not offer a change that only touches what Vicu does not import', async () => {
    const { filters, lists } = await imported()
    changeFilterOne('done = false && priority > 2', '2026-11-05T10:00:00Z')
    filters.recordKnownSavedFilters(state.pseudo)
    await lists.syncCustomLists()
    await settle(lists)
    expect(filters.getSavedFilterState().changed_offer).toEqual([])
  })

  it('offers and imports project views', async () => {
    writeConfig({ saved_filters: { known: [], first_connect_done: true } })
    const { filters, lists } = await load()
    const views = (await filters.previewProjectViews())!
    expect(views.map((view) => view.title)).toEqual(['Home: All items'])

    const outcome = await filters.applySavedFilterImport(['view:22'], [])
    expect(outcome?.count).toBe(1)
    const list = lists.getCustomLists()[0]
    expect(list.project_view).toEqual({ project_id: 4, view_id: 22 })
    expect(list.filter.project_ids).toEqual([4])
    expect(list.filter.include_done).toBe(true)
    expect(list.saved_filter_id).toBeUndefined()

    // Imported, it is listed with its comparison and cannot be ticked while it is the same.
    const again = (await filters.previewProjectViews())!
    expect(again).toHaveLength(1)
    expect(again[0].existing?.id).toBe(list.id)
    expect(again[0].comparison?.status).toBe('same')
  })

  it('keeps project_view and import_base through an edit of the list', async () => {
    const { lists } = await imported()
    const wire = lists.getCustomListWires()[0]
    lists.upsertCustomList({ ...wire, name: 'Renamed', extra_field: { kept: true } })
    const after = lists.getCustomListWires()[0]
    expect(after.import_base).toEqual(wire.import_base)
    expect(after.extra_field).toEqual({ kept: true })
  })
})
