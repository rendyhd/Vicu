import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// The custom-list service against an in-memory Vikunja: what it broadcasts to the windows, how it
// cleans up duplicate carriers and old tombstones, and how a first sync treats the list order
// (D-CL-1).

type Task = { id: number; title: string; description: string; done: boolean; project_id: number }

const state = vi.hoisted(() => ({
  dir: '',
  tasks: new Map<number, { id: number; title: string; description: string; done: boolean; project_id: number }>(),
  nextId: 100,
  deleted: [] as number[],
  failWrites: false,
  failDeletes: false,
  /** Called with the id of every GET /tasks/{id}, before the answer is built. */
  onFetchById: null as null | ((id: number) => void),
  sent: [] as Array<{ channel: string; payload: unknown }>,
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
    let rows = [...state.tasks.values()].filter((task) => task.done)
    if (typeof params.q === 'string') rows = rows.filter((task) => task.description.includes(params.q as string))
    return { success: true, data: rows.map((task) => ({ ...task })) }
  },
  fetchTaskById: async (id: number) => {
    state.onFetchById?.(id)
    const task = state.tasks.get(id)
    return task ? { success: true, data: { ...task } } : { success: false, error: 'Not found', statusCode: 404 }
  },
  createTask: async (projectId: number, body: { title: string; description: string; done?: boolean }) => {
    const task = { id: state.nextId++, title: body.title, description: body.description, done: body.done === true, project_id: projectId }
    state.tasks.set(task.id, task)
    return { success: true, data: { ...task } }
  },
  updateTask: async (id: number, patch: { description?: string; done?: boolean }) => {
    if (state.failWrites) return { success: false, error: 'Network error: connection refused' }
    const task = state.tasks.get(id)
    if (!task) return { success: false, error: 'Not found', statusCode: 404 }
    if (patch.description !== undefined) task.description = patch.description
    if (patch.done !== undefined) task.done = patch.done
    return { success: true, data: { ...task } }
  },
  deleteTask: async (id: number) => {
    if (state.failDeletes) return { success: false, error: 'Network error: connection refused' }
    state.deleted.push(id)
    state.tasks.delete(id)
    return { success: true, data: undefined }
  },
}))

import {
  CUSTOM_LIST_CARRIER_TITLE,
  activeLists,
  documentFromLists,
  encodeCustomListEnvelope,
  parseCustomListEnvelope,
  type CustomListSyncDocumentV1,
  type CustomListWire,
} from '../custom-list-protocol'

const DAY = 24 * 60 * 60 * 1000

async function loadService() {
  vi.resetModules()
  return await import('../custom-list-service')
}

const list = (id: string, name = id): CustomListWire => ({
  id,
  name,
  icon: '',
  filter: {
    project_ids: [],
    project_filter_mode: 'include',
    add_to_project_id: 0,
    sort_by: 'due_date',
    order_by: 'asc',
    due_date_filter: 'all',
    priority_filter: [],
    label_ids: [],
    include_done: false,
    include_today_all_projects: false,
  },
})

function writeConfig(extra: Record<string, unknown> = {}) {
  writeFileSync(join(state.dir, 'config.json'), JSON.stringify({
    vikunja_url: 'https://tasks.example.com',
    api_token: 'unused',
    inbox_project_id: 5,
    theme: 'dark',
    ...extra,
  }), 'utf-8')
}

function putCarrier(id: number, document: CustomListSyncDocumentV1 | string) {
  const description = typeof document === 'string' ? document : encodeCustomListEnvelope(document)
  state.tasks.set(id, { id, title: CUSTOM_LIST_CARRIER_TITLE, description, done: true, project_id: 5 })
}

const documentOf = (id: number) => parseCustomListEnvelope(state.tasks.get(id)!.description).document!
const idsOf = (document: CustomListSyncDocumentV1) => activeLists(document).map((entry) => entry.id)
const sentCount = (channel: string) => state.sent.filter((entry) => entry.channel === channel).length

function savedConfig(): { custom_lists?: Array<{ id: string }>; custom_lists_sync?: { document: CustomListSyncDocumentV1 } } {
  return JSON.parse(readFileSync(join(state.dir, 'config.json'), 'utf-8'))
}

describe('custom-list service', () => {
  beforeEach(() => {
    state.dir = mkdtempSync(join(tmpdir(), 'vicu-list-service-'))
    state.tasks.clear()
    state.nextId = 100
    state.deleted.length = 0
    state.failWrites = false
    state.failDeletes = false
    state.onFetchById = null
    state.sent.length = 0
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(state.dir, { recursive: true, force: true })
  })

  describe('what it tells the windows', () => {
    it('sends viewer-config-changed when the lists change, but not when only the sync status does', async () => {
      writeConfig({ custom_lists: [] })
      const service = await loadService()

      service.upsertCustomList(list('a'))
      await vi.waitFor(() => expect(service.getCustomListSyncStatus().state).toBe('idle'))
      const afterFirstChange = sentCount('viewer-config-changed')
      expect(afterFirstChange).toBe(1)
      expect(sentCount('custom-lists-changed')).toBe(1)

      const statusMessages = sentCount('custom-list-sync-status')
      for (let i = 0; i < 3; i++) await service.syncCustomLists()

      // Every sync goes syncing -> idle: the status goes out, the viewer is left alone.
      expect(sentCount('custom-list-sync-status')).toBeGreaterThan(statusMessages)
      expect(sentCount('viewer-config-changed')).toBe(afterFirstChange)
      expect(sentCount('custom-lists-changed')).toBe(1)
    })

    it('tells the viewer once when a sync brings in a list from another device', async () => {
      writeConfig({ custom_lists: [] })
      const service = await loadService()
      await service.syncCustomLists()
      state.sent.length = 0

      putCarrier(7, documentFromLists([list('x', 'From Android')], 'android', Date.now() - DAY))
      await service.syncCustomLists()

      expect(sentCount('viewer-config-changed')).toBe(1)
      const changed = state.sent.find((entry) => entry.channel === 'custom-lists-changed')
      expect((changed?.payload as Array<{ id: string }>).map((entry) => entry.id)).toEqual(['x'])
    })

    it('does not tell the viewer anything when a sync changes nothing', async () => {
      writeConfig({ custom_lists: [] })
      putCarrier(7, documentFromLists([list('x')], 'android', Date.now() - DAY))
      const service = await loadService()
      await service.syncCustomLists()
      state.sent.length = 0

      await service.syncCustomLists()
      await service.syncCustomLists()

      expect(sentCount('viewer-config-changed')).toBe(0)
      expect(sentCount('custom-lists-changed')).toBe(0)
      expect(sentCount('custom-list-sync-status')).toBeGreaterThan(0)
    })
  })

  describe('the first sync of a device that has no lists', () => {
    it('takes the order from the carrier instead of overwriting it with an empty one', async () => {
      writeConfig({})
      const remote = documentFromLists([list('a'), list('b')], 'android', Date.now() - 10 * DAY)
      remote.order = { ids: ['b', 'a'], revision: { wall_time_ms: Date.now() - 5 * DAY, counter: 0, device_id: 'android' } }
      putCarrier(7, remote)
      const service = await loadService()

      expect((await service.syncCustomLists()).state).toBe('idle')

      expect(service.getCustomLists().map((entry) => entry.id)).toEqual(['b', 'a'])
      expect(idsOf(documentOf(7))).toEqual(['b', 'a'])
      expect(documentOf(7).order.ids).toEqual(['b', 'a'])
      expect(documentOf(7).order.revision.device_id).toBe('android')
    })

    it('does not write to the carrier at all when it already says everything', async () => {
      writeConfig({})
      const remote = documentFromLists([list('a'), list('b')], 'android', Date.now() - 10 * DAY)
      remote.order = { ids: ['b', 'a'], revision: { wall_time_ms: Date.now() - 5 * DAY, counter: 0, device_id: 'android' } }
      putCarrier(7, remote)
      const before = state.tasks.get(7)!.description
      const service = await loadService()
      await service.syncCustomLists()
      expect(state.tasks.get(7)!.description).toBe(before)
    })
  })

  describe('duplicate carriers', () => {
    it('merges them into the oldest one and deletes the others', async () => {
      writeConfig({ custom_lists: [] })
      putCarrier(7, documentFromLists([list('x', 'From Android')], 'android', Date.now() - 10 * DAY))
      putCarrier(100, documentFromLists([list('y', 'From the web')], 'other', Date.now() - 5 * DAY))
      putCarrier(120, documentFromLists([list('z', 'Third')], 'third', Date.now() - 2 * DAY))
      const service = await loadService()

      expect((await service.syncCustomLists()).state).toBe('idle')

      expect(idsOf(documentOf(7)).sort()).toEqual(['x', 'y', 'z'])
      expect(state.deleted.sort()).toEqual([100, 120])
      expect([...state.tasks.keys()]).toEqual([7])
      expect(service.getCustomLists().map((entry) => entry.id).sort()).toEqual(['x', 'y', 'z'])
    })

    it('does not look for the deleted ones again on the next sync', async () => {
      writeConfig({ custom_lists: [] })
      putCarrier(7, documentFromLists([list('x')], 'android', Date.now() - 10 * DAY))
      putCarrier(100, documentFromLists([list('y')], 'other', Date.now() - 5 * DAY))
      const service = await loadService()
      await service.syncCustomLists()
      const fetched: number[] = []
      state.onFetchById = (id) => fetched.push(id)

      expect((await service.syncCustomLists()).state).toBe('idle')
      expect(fetched).not.toContain(100)
      expect(state.deleted).toEqual([100])
    })

    it('keeps the extra carriers when the merged write to the oldest one fails', async () => {
      writeConfig({ custom_lists: [] })
      putCarrier(7, documentFromLists([list('x')], 'android', Date.now() - 10 * DAY))
      putCarrier(100, documentFromLists([list('y')], 'other', Date.now() - 5 * DAY))
      state.failWrites = true
      const service = await loadService()

      expect((await service.syncCustomLists()).state).not.toBe('idle')

      expect(state.deleted).toEqual([])
      expect(state.tasks.has(100)).toBe(true)
      // What was read is not lost: the lists are shown and the next sync writes them.
      expect(service.getCustomLists().map((entry) => entry.id).sort()).toEqual(['x', 'y'])

      state.failWrites = false
      expect((await service.syncCustomLists()).state).toBe('idle')
      expect(idsOf(documentOf(7)).sort()).toEqual(['x', 'y'])
      expect(state.deleted).toEqual([100])
    })

    it('never deletes a carrier it could not read', async () => {
      writeConfig({ custom_lists: [] })
      putCarrier(7, documentFromLists([list('x')], 'android', Date.now() - 10 * DAY))
      putCarrier(100, '<!-- vicu-custom-lists:v1:not-a-document -->')
      const service = await loadService()

      await service.syncCustomLists()

      expect(state.deleted).toEqual([])
      expect(state.tasks.has(100)).toBe(true)
    })

    it('never deletes a carrier of a newer format', async () => {
      writeConfig({ custom_lists: [] })
      putCarrier(7, documentFromLists([list('x')], 'android', Date.now() - 10 * DAY))
      putCarrier(100, '<!-- vicu-custom-lists:v2:AAAA -->')
      const service = await loadService()

      expect((await service.syncCustomLists()).state).toBe('update_required')
      expect(state.deleted).toEqual([])
    })

    it('keeps a duplicate that gained a list after it was read', async () => {
      writeConfig({ custom_lists: [] })
      putCarrier(7, documentFromLists([list('x')], 'android', Date.now() - 10 * DAY))
      putCarrier(100, documentFromLists([list('y')], 'other', Date.now() - 5 * DAY))
      const service = await loadService()
      // The first direct read of carrier 100 is the one just before it would be deleted: another
      // device writes a list into it right then.
      state.onFetchById = (id) => {
        if (id !== 100) return
        state.onFetchById = null
        putCarrier(100, documentFromLists([list('y'), list('late', 'Added meanwhile')], 'other', Date.now()))
      }

      await service.syncCustomLists()

      expect(state.deleted).toEqual([])
      expect(state.tasks.has(100)).toBe(true)

      // The next sync merges it and then removes it.
      await service.syncCustomLists()
      expect(idsOf(documentOf(7)).sort()).toEqual(['late', 'x', 'y'])
      expect(state.deleted).toEqual([100])
    })

    it('still reports idle when a duplicate cannot be deleted right now', async () => {
      writeConfig({ custom_lists: [] })
      putCarrier(7, documentFromLists([list('x')], 'android', Date.now() - 10 * DAY))
      putCarrier(100, documentFromLists([list('y')], 'other', Date.now() - 5 * DAY))
      state.failDeletes = true
      const service = await loadService()

      expect((await service.syncCustomLists()).state).toBe('idle')
      expect(state.tasks.has(100)).toBe(true)

      state.failDeletes = false
      await service.syncCustomLists()
      expect(state.deleted).toEqual([100])
    })

    it('leaves a single carrier alone', async () => {
      writeConfig({ custom_lists: [] })
      putCarrier(7, documentFromLists([list('x')], 'android', Date.now() - 10 * DAY))
      const service = await loadService()
      await service.syncCustomLists()
      expect(state.deleted).toEqual([])
    })
  })

  describe('old tombstones', () => {
    function documentWithTombstones(): CustomListSyncDocumentV1 {
      const document = documentFromLists([list('live')], 'android', Date.now() - 200 * DAY)
      document.lists.old = { value: null, revision: { wall_time_ms: Date.now() - 100 * DAY, counter: 0, device_id: 'android' } }
      document.lists.recent = { value: null, revision: { wall_time_ms: Date.now() - 10 * DAY, counter: 0, device_id: 'android' } }
      return document
    }

    it('drops the ones older than 90 days when the carrier is written, and keeps the recent ones', async () => {
      writeConfig({ custom_lists: [] })
      putCarrier(7, documentWithTombstones())
      const service = await loadService()

      expect((await service.syncCustomLists()).state).toBe('idle')

      const onServer = documentOf(7)
      expect(Object.keys(onServer.lists).sort()).toEqual(['live', 'recent'])
      expect(onServer.lists.recent.value).toBeNull()
      expect(Object.keys(savedConfig().custom_lists_sync!.document.lists).sort()).toEqual(['live', 'recent'])
      expect(service.getCustomLists().map((entry) => entry.id)).toEqual(['live'])
    })

    it('does not write for recent tombstones alone', async () => {
      writeConfig({ custom_lists: [] })
      const document = documentFromLists([list('live')], 'android', Date.now() - 20 * DAY)
      document.lists.recent = { value: null, revision: { wall_time_ms: Date.now() - 10 * DAY, counter: 0, device_id: 'android' } }
      putCarrier(7, document)
      const before = state.tasks.get(7)!.description
      const service = await loadService()

      await service.syncCustomLists()

      expect(state.tasks.get(7)!.description).toBe(before)
    })

    it('does not bring a pruned tombstone back from the local copy on later syncs', async () => {
      writeConfig({ custom_lists: [] })
      putCarrier(7, documentWithTombstones())
      const service = await loadService()
      await service.syncCustomLists()
      const afterFirst = state.tasks.get(7)!.description

      await service.syncCustomLists()

      expect(state.tasks.get(7)!.description).toBe(afterFirst)
    })
  })
})
