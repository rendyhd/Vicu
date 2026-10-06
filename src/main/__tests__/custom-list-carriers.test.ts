import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

type Task = { id: number; title: string; description: string; done: boolean; project_id: number }

const state = vi.hoisted(() => ({
  dir: '',
  tasks: new Map<number, { id: number; title: string; description: string; done: boolean; project_id: number }>(),
  nextId: 100,
  /** A server that ignores `done` on create. */
  ignoreDoneOnCreate: false,
  calls: { list: [] as Array<Record<string, unknown>>, byId: [] as number[], create: 0, update: 0 },
}))

vi.mock('electron', () => ({
  app: { getPath: () => state.dir },
  safeStorage: { isEncryptionAvailable: () => false },
  BrowserWindow: { getAllWindows: () => [] },
}))

vi.mock('../api-client', () => ({
  fetchTasks: async (params: Record<string, unknown>) => {
    state.calls.list.push(params)
    let rows = [...state.tasks.values()].filter((task) => task.done)
    if (typeof params.q === 'string') rows = rows.filter((task) => task.description.includes(params.q as string))
    return { success: true, data: rows }
  },
  fetchTaskById: async (id: number) => {
    state.calls.byId.push(id)
    const task = state.tasks.get(id)
    return task ? { success: true, data: task } : { success: false, error: 'Not found', statusCode: 404 }
  },
  createTask: async (projectId: number, body: { title: string; description: string; done?: boolean }) => {
    state.calls.create += 1
    const task = {
      id: state.nextId++,
      title: body.title,
      description: body.description,
      done: state.ignoreDoneOnCreate ? false : body.done === true,
      project_id: projectId,
    }
    state.tasks.set(task.id, task)
    return { success: true, data: { ...task } }
  },
  updateTask: async (id: number, patch: { description?: string; done?: boolean }) => {
    state.calls.update += 1
    const task = state.tasks.get(id)
    if (!task) return { success: false, error: 'Not found', statusCode: 404 }
    if (patch.description !== undefined) task.description = patch.description
    if (patch.done !== undefined) task.done = patch.done
    return { success: true, data: { ...task } }
  },
}))

import {
  CUSTOM_LIST_CARRIER_TITLE,
  activeLists,
  documentFromLists,
  encodeCustomListEnvelope,
  parseCustomListEnvelope,
  type CustomListWire,
} from '../custom-list-protocol'

async function loadService() {
  vi.resetModules()
  return await import('../custom-list-service')
}

const list = (id: string, name: string): CustomListWire => ({
  id,
  name,
  icon: 'star',
  color: '#ff8800',
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

const resetCalls = () => {
  state.calls.list.length = 0
  state.calls.byId.length = 0
  state.calls.create = 0
  state.calls.update = 0
}

function writeConfig(extra: Record<string, unknown> = {}) {
  writeFileSync(join(state.dir, 'config.json'), JSON.stringify({
    vikunja_url: 'https://tasks.example.com',
    api_token: 'unused',
    inbox_project_id: 5,
    theme: 'dark',
    custom_lists: [],
    ...extra,
  }), 'utf-8')
}

describe('custom-list carrier sync (D-NOTIF-3, D-RT-2)', () => {
  beforeEach(() => {
    state.dir = mkdtempSync(join(tmpdir(), 'vicu-list-carriers-'))
    state.tasks.clear()
    state.nextId = 100
    state.ignoreDoneOnCreate = false
    resetCalls()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(state.dir, { recursive: true, force: true })
  })

  it('creates the carrier in one request, already done, and does not patch it again', async () => {
    writeConfig()
    const service = await loadService()
    service.upsertCustomList(list('a', 'First'))
    await service.syncCustomLists()

    expect(state.calls.create).toBe(1)
    expect(state.calls.update).toBe(0)
    const carrier = [...state.tasks.values()][0]
    expect(carrier.done).toBe(true)
    expect(carrier.title).toBe(CUSTOM_LIST_CARRIER_TITLE)
    expect(carrier.project_id).toBe(5)
    expect(activeLists(parseCustomListEnvelope(carrier.description).document!).map((l) => l.id)).toEqual(['a'])
    // The create response is the read-back: no GET after it either.
    expect(state.calls.byId).toEqual([])
    expect(service.getCustomListSyncStatus().state).toBe('idle')
  })

  it('finishes a carrier with a second request only when the server ignored done on create', async () => {
    writeConfig()
    state.ignoreDoneOnCreate = true
    const service = await loadService()
    service.upsertCustomList(list('a', 'First'))
    await service.syncCustomLists()

    expect(state.calls.create).toBe(1)
    expect(state.calls.update).toBe(1)
    expect([...state.tasks.values()][0].done).toBe(true)
    expect(service.getCustomListSyncStatus().state).toBe('idle')
  })

  it('a sync with nothing to change reads the carrier by id and does not list the done tasks', async () => {
    writeConfig()
    const service = await loadService()
    service.upsertCustomList(list('a', 'First'))
    await service.syncCustomLists()
    expect(state.calls.list.length).toBeGreaterThan(0) // the very first sync looked for carriers

    resetCalls()
    await service.syncCustomLists()
    expect(state.calls.update).toBe(0)
    expect(state.calls.create).toBe(0)
    // One GET for the remembered carrier; no verification GET because nothing was written.
    expect(state.calls.byId).toHaveLength(1)
    expect(state.calls.list.every((params) => typeof params.q === 'string')).toBe(true)
    expect(service.getCustomListSyncStatus().state).toBe('idle')
  })

  it('reads the carrier back after writing an edit', async () => {
    writeConfig()
    const service = await loadService()
    service.upsertCustomList(list('a', 'First'))
    await service.syncCustomLists()
    resetCalls()

    service.upsertCustomList(list('b', 'Second'))
    await vi.waitFor(() => expect(service.getCustomListSyncStatus().state).toBe('idle'))
    const carrier = [...state.tasks.values()][0]
    expect(activeLists(parseCustomListEnvelope(carrier.description).document!).map((l) => l.id).sort()).toEqual(['a', 'b'])
    expect(state.calls.update).toBe(1)
    expect(state.calls.byId.length).toBe(2) // the direct fetch of the carrier, then the read-back
    expect(state.calls.create).toBe(0)
  })

  it('remembers the carrier across restarts and still finds one another device made', async () => {
    writeConfig()
    const first = await loadService()
    first.upsertCustomList(list('a', 'First'))
    await first.syncCustomLists()
    expect(existsSync(join(state.dir, 'carrier-ids.json'))).toBe(true)
    expect(JSON.parse(readFileSync(join(state.dir, 'carrier-ids.json'), 'utf-8')).servers['https://tasks.example.com']['custom-lists'].ids).toEqual([100])

    // Another device (Android) wrote its own carrier with a list.
    const other = documentFromLists([list('x', 'From Android')], 'android-device')
    state.tasks.set(7, { id: 7, title: CUSTOM_LIST_CARRIER_TITLE, description: encodeCustomListEnvelope(other), done: true, project_id: 5 })

    const restarted = await loadService()
    resetCalls()
    await restarted.syncCustomLists()
    // A fresh process searches once (by marker, not a full listing) and finds it.
    expect(state.calls.list.some((params) => params.q === 'vicu-custom-lists')).toBe(true)
    expect(state.calls.list.every((params) => typeof params.q === 'string')).toBe(true)
    expect(restarted.getCustomLists().map((l) => l.id).sort()).toEqual(['a', 'x'])
  })
})
