import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { ApiResult } from '../api-result'
import {
  CUSTOM_LIST_CARRIER_SPEC,
  DISCOVERY_INTERVAL_MS,
  FULL_SCAN_INTERVAL_MS,
  ROUTINE_CARRIER_SPEC,
  carrierIdsPath,
  createCarrierLoader,
  createFileCarrierIdStore,
  createMemoryCarrierIdStore,
  type CarrierIdStore,
  type CarrierTask,
} from '../carrier-discovery'

const SERVER = 'https://tasks.example.com'

const routineCarrier = (id: number): CarrierTask => ({
  id,
  title: `Routine ${id}`,
  done: true,
  description: `<!-- vicu-routine:v1:e30 -->`,
})
const archivePart = (id: number): CarrierTask => ({
  id,
  title: 'Vicu routine archive',
  done: true,
  description: `<!-- vicu-routine:archive:v1:e30 -->`,
})
const listCarrier = (id: number): CarrierTask => ({
  id,
  title: 'Vicu custom lists (sync metadata — do not delete)',
  done: true,
  description: `<!-- vicu-custom-lists:v1:e30 -->`,
})
const plainDone = (id: number): CarrierTask => ({ id, title: `Done ${id}`, done: true, description: '<p>nothing</p>' })

/** A tiny fake server: done tasks by id, with a search that behaves like Vikunja's `q` (substring). */
function fakeServer(initial: CarrierTask[]) {
  const tasks = new Map<number, CarrierTask>(initial.map((task) => [task.id, task]))
  const calls = { list: [] as Array<Record<string, unknown>>, byId: [] as number[] }
  const failing = { list: null as null | string, byId: null as null | { id: number; statusCode?: number; error: string } }

  const fetchTasks = async (params: Record<string, unknown>): Promise<ApiResult<unknown[]>> => {
    calls.list.push(params)
    if (failing.list) return { success: false, error: failing.list }
    let result = [...tasks.values()].filter((task) => task.done)
    if (typeof params.q === 'string') {
      const q = params.q
      result = result.filter((task) => (task.title ?? '').includes(q) || (task.description ?? '').includes(q))
    }
    return { success: true, data: result }
  }
  const fetchTaskById = async (id: number): Promise<ApiResult<unknown>> => {
    calls.byId.push(id)
    if (failing.byId && failing.byId.id === id) return { success: false, error: failing.byId.error, statusCode: failing.byId.statusCode }
    const task = tasks.get(id)
    return task ? { success: true, data: task } : { success: false, error: 'Not found', statusCode: 404 }
  }
  return { tasks, calls, failing, fetchTasks, fetchTaskById }
}

function setup(initial: CarrierTask[], store: CarrierIdStore = createMemoryCarrierIdStore()) {
  const server = fakeServer(initial)
  let nowMs = Date.parse('2026-10-07T09:00:00Z')
  const loader = createCarrierLoader({
    fetchTasks: server.fetchTasks,
    fetchTaskById: server.fetchTaskById,
    store,
    now: () => nowMs,
  })
  return {
    server,
    store,
    loader,
    advance: (ms: number) => { nowMs += ms },
    reset: () => { server.calls.list.length = 0; server.calls.byId.length = 0 },
    ids: async (spec = ROUTINE_CARRIER_SPEC) => {
      const result = await loader.load(spec, SERVER)
      if (!result.success) throw new Error(result.error)
      return result.data.map((task) => task.id)
    },
  }
}

describe('carrier discovery (D-NOTIF-3, D-RT-2)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does one full scan the first time, then fetches the remembered carriers by id', async () => {
    const t = setup([routineCarrier(10), routineCarrier(11), plainDone(12), archivePart(13)])

    expect(await t.ids()).toEqual([10, 11])
    expect(t.server.calls.list).toHaveLength(1)
    expect(t.server.calls.list[0]).toMatchObject({ filter: 'done = true' })
    expect(t.server.calls.list[0].q).toBeUndefined()
    expect(t.server.calls.byId).toEqual([])

    t.reset()
    t.advance(5_000)
    expect(await t.ids()).toEqual([10, 11])
    expect(t.server.calls.list).toHaveLength(0)
    expect(t.server.calls.byId.sort()).toEqual([10, 11])
  })

  it('never lists the done tasks again for a carrier that is already known (the old every-5-minutes scan)', async () => {
    const t = setup([routineCarrier(10), plainDone(20), plainDone(21)])
    await t.ids()
    t.reset()

    for (let minute = 1; minute <= 30; minute++) {
      t.advance(60_000)
      await t.ids()
    }
    // At most one marker search per discovery interval, and none of them is a full listing.
    expect(t.server.calls.list.every((params) => typeof params.q === 'string')).toBe(true)
    expect(t.server.calls.list.length).toBeLessThanOrEqual(30)
    expect(t.server.calls.byId.length).toBe(30)
  })

  it('finds a carrier another device created with a marker search, not a full scan', async () => {
    const t = setup([routineCarrier(10)])
    await t.ids()
    t.server.tasks.set(30, routineCarrier(30))
    t.reset()

    // Inside the discovery interval the new carrier is not looked for.
    t.advance(DISCOVERY_INTERVAL_MS - 1)
    expect(await t.ids()).toEqual([10])
    expect(t.server.calls.list).toHaveLength(0)

    t.advance(2)
    expect(await t.ids()).toEqual([10, 30])
    expect(t.server.calls.list).toHaveLength(1)
    expect(t.server.calls.list[0]).toMatchObject({ q: 'vicu-routine:v', filter: 'done = true' })

    // From now on it is fetched by id.
    t.reset()
    t.advance(1_000)
    await t.ids()
    expect(t.server.calls.byId.sort()).toEqual([10, 30])
    expect(t.server.calls.list).toHaveLength(0)
  })

  it('does not download archive parts: the routine search text stops them matching', async () => {
    const t = setup([routineCarrier(10), archivePart(11), archivePart(12)])
    await t.ids()
    t.advance(DISCOVERY_INTERVAL_MS + 1)
    t.reset()
    await t.ids()

    const search = t.server.calls.list[0]
    expect(search.q).toBe('vicu-routine:v')
    // What the fake server (like Vikunja: a substring match) returns for it holds no archive part.
    const matches = [...t.server.tasks.values()].filter((task) => (task.description ?? '').includes(search.q as string))
    expect(matches.map((task) => task.id)).toEqual([10])
    // And a part is never treated as a carrier, even if a full scan returns it.
    expect(ROUTINE_CARRIER_SPEC.isCarrier(archivePart(11))).toBe(false)
    expect(ROUTINE_CARRIER_SPEC.isCarrier(routineCarrier(10))).toBe(true)
  })

  it('looks for custom-list carriers by the title or the marker, with its own search text', async () => {
    const t = setup([listCarrier(40), routineCarrier(10)])
    expect(await t.ids(CUSTOM_LIST_CARRIER_SPEC)).toEqual([40])
    t.advance(DISCOVERY_INTERVAL_MS + 1)
    t.reset()
    await t.ids(CUSTOM_LIST_CARRIER_SPEC)
    expect(t.server.calls.list[0]).toMatchObject({ q: 'vicu-custom-lists', filter: 'done = true' })
    expect(CUSTOM_LIST_CARRIER_SPEC.isCarrier({ id: 1, title: 'Vicu custom lists (sync metadata — do not delete)', description: '' })).toBe(true)
    expect(CUSTOM_LIST_CARRIER_SPEC.isCarrier(plainDone(2))).toBe(false)
  })

  it('shares one full listing between the kinds when both start together (first run)', async () => {
    const t = setup([routineCarrier(10), listCarrier(40), plainDone(1)])
    const [routines, lists] = await Promise.all([
      t.loader.load(ROUTINE_CARRIER_SPEC, SERVER),
      t.loader.load(CUSTOM_LIST_CARRIER_SPEC, SERVER),
    ])
    expect(routines).toMatchObject({ success: true })
    expect(lists).toMatchObject({ success: true })
    expect((routines as { data: CarrierTask[] }).data.map((task) => task.id)).toEqual([10])
    expect((lists as { data: CarrierTask[] }).data.map((task) => task.id)).toEqual([40])
    expect(t.server.calls.list).toHaveLength(1)
  })

  it('keeps the two kinds and two servers apart', async () => {
    const t = setup([routineCarrier(10), listCarrier(40)])
    await t.ids(ROUTINE_CARRIER_SPEC)
    await t.ids(CUSTOM_LIST_CARRIER_SPEC)
    expect(t.store.get(SERVER, 'routine').ids).toEqual([10])
    expect(t.store.get(SERVER, 'custom-lists').ids).toEqual([40])
    expect(t.store.get('https://other.example.com', 'routine').ids).toEqual([])
  })

  it('falls back to a full scan at most once a day', async () => {
    const t = setup([routineCarrier(10)])
    await t.ids()
    expect(t.store.get(SERVER, 'routine').lastFullScanAt).toBeGreaterThan(0)

    // A day minus a minute later, even with the search interval long past: searches only.
    t.reset()
    t.advance(FULL_SCAN_INTERVAL_MS - 60_000)
    await t.ids()
    expect(t.server.calls.list.every((params) => typeof params.q === 'string')).toBe(true)

    // Past a day: one full scan (a safety net for servers whose search ignores descriptions).
    t.reset()
    t.advance(120_000)
    await t.ids()
    expect(t.server.calls.list).toHaveLength(1)
    expect(t.server.calls.list[0].q).toBeUndefined()

    // And then not again until the next day.
    t.reset()
    t.advance(DISCOVERY_INTERVAL_MS + 1)
    await t.ids()
    expect(t.server.calls.list.every((params) => typeof params.q === 'string')).toBe(true)
  })

  it('does a full scan when a remembered carrier is gone (404), once, and forgets it', async () => {
    const t = setup([routineCarrier(10), routineCarrier(11)])
    await t.ids()
    t.server.tasks.delete(10)
    t.server.tasks.set(50, routineCarrier(50)) // a replacement another device made
    t.reset()
    t.advance(1_000)

    expect(await t.ids()).toEqual([11, 50])
    expect(t.server.calls.list).toHaveLength(1)
    expect(t.server.calls.list[0].q).toBeUndefined() // a full listing, not a search
    expect(t.store.get(SERVER, 'routine').ids).toEqual([11, 50])

    // The id is dropped: no repeated scan for it.
    t.reset()
    t.advance(1_000)
    await t.ids()
    expect(t.server.calls.list).toHaveLength(0)
    expect(t.server.calls.byId.sort()).toEqual([11, 50])
  })

  it('treats 403 (no longer visible to this account) like a missing carrier', async () => {
    const t = setup([routineCarrier(10)])
    await t.ids()
    t.server.failing.byId = { id: 10, statusCode: 403, error: 'Forbidden' }
    t.reset()
    t.advance(1_000)
    expect(await t.ids()).toEqual([10]) // the full scan finds it again through the listing
    expect(t.server.calls.list).toHaveLength(1)
  })

  it('drops a remembered task that was reopened or is no longer a carrier, without a scan', async () => {
    const t = setup([routineCarrier(10), routineCarrier(11)])
    await t.ids()
    t.server.tasks.set(10, { ...routineCarrier(10), done: false })
    t.reset()
    t.advance(1_000)

    expect(await t.ids()).toEqual([11])
    expect(t.server.calls.list).toHaveLength(0)
    expect(t.store.get(SERVER, 'routine').ids).toEqual([11])
  })

  it('reports an error on a failed direct fetch and keeps what it remembered', async () => {
    const t = setup([routineCarrier(10), routineCarrier(11)])
    await t.ids()
    t.server.failing.byId = { id: 11, statusCode: 500, error: 'Server error' }
    t.reset()
    t.advance(1_000)

    const result = await t.loader.load(ROUTINE_CARRIER_SPEC, SERVER)
    expect(result).toMatchObject({ success: false, error: 'Server error' })
    expect(t.server.calls.list).toHaveLength(0)
    expect(t.store.get(SERVER, 'routine').ids).toEqual([10, 11])
  })

  it('reports the error when nothing is known and the listing fails, instead of "no carriers"', async () => {
    const t = setup([routineCarrier(10)])
    t.server.failing.list = 'Network error'
    const result = await t.loader.load(ROUTINE_CARRIER_SPEC, SERVER)
    expect(result).toMatchObject({ success: false, error: 'Network error' })
    expect(t.store.get(SERVER, 'routine')).toEqual({ ids: [], lastFullScanAt: 0 })
  })

  it('uses the remembered carriers when only the discovery search fails', async () => {
    const t = setup([routineCarrier(10)])
    await t.ids()
    t.server.failing.list = 'Timed out'
    t.advance(DISCOVERY_INTERVAL_MS + 1)
    expect(await t.ids()).toEqual([10])
  })

  it('searches on every load while no carrier exists (cheap) but scans only once a day', async () => {
    const t = setup([plainDone(1)])
    expect(await t.ids()).toEqual([])
    expect(t.server.calls.list).toHaveLength(1) // the first-ever full scan

    t.reset()
    t.advance(1_000)
    await t.ids()
    await t.ids()
    expect(t.server.calls.list.every((params) => params.q === 'vicu-routine:v')).toBe(true)
  })

  it('shares one set of requests between loads that overlap', async () => {
    const t = setup([routineCarrier(10)])
    const [a, b] = await Promise.all([t.loader.load(ROUTINE_CARRIER_SPEC, SERVER), t.loader.load(ROUTINE_CARRIER_SPEC, SERVER)])
    expect(a).toEqual(b)
    expect(t.server.calls.list).toHaveLength(1)
  })

  it('fetches a carrier this app just created directly, and forgets one it deleted', async () => {
    const t = setup([routineCarrier(10)])
    await t.ids()
    t.server.tasks.set(60, routineCarrier(60))
    t.loader.remember(SERVER, 'routine', 60)
    t.reset()
    t.advance(1_000)
    expect(await t.ids()).toEqual([10, 60])
    expect(t.server.calls.list).toHaveLength(0)

    t.loader.forget(60)
    t.server.tasks.delete(60)
    t.reset()
    t.advance(1_000)
    expect(await t.ids()).toEqual([10])
    expect(t.server.calls.byId).toEqual([10]) // no 404, so no full scan
    expect(t.server.calls.list).toHaveLength(0)
  })
})

describe('carrier id file', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vicu-carrier-ids-'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(dir, { recursive: true, force: true })
  })

  it('survives a restart, per server and kind', async () => {
    const path = carrierIdsPath(dir)
    const first = setup([routineCarrier(10), listCarrier(40)], createFileCarrierIdStore(path))
    await first.ids(ROUTINE_CARRIER_SPEC)
    await first.ids(CUSTOM_LIST_CARRIER_SPEC)
    expect(existsSync(path)).toBe(true)

    // A new process: the ids come from the file, so there is no listing at all.
    const second = setup([routineCarrier(10), listCarrier(40)], createFileCarrierIdStore(path))
    second.advance(10_000)
    expect(await second.ids(ROUTINE_CARRIER_SPEC)).toEqual([10])
    expect(second.server.calls.byId).toEqual([10])
    // (a fresh process searches once per kind per session: it has never looked yet)
    expect(second.server.calls.list.every((params) => typeof params.q === 'string')).toBe(true)
  })

  it('writes only when something changed', async () => {
    const path = carrierIdsPath(dir)
    const store = createFileCarrierIdStore(path)
    store.set(SERVER, 'routine', { ids: [3, 1], lastFullScanAt: 5 })
    const written = readFileSync(path, 'utf-8')
    writeFileSync(path, written + ' ', 'utf-8') // a marker that a rewrite would erase
    store.set(SERVER, 'routine', { ids: [3, 1], lastFullScanAt: 5 })
    expect(readFileSync(path, 'utf-8')).toBe(written + ' ')
  })

  it('forgets an id everywhere', () => {
    const path = carrierIdsPath(dir)
    const store = createFileCarrierIdStore(path)
    store.set(SERVER, 'routine', { ids: [1, 2], lastFullScanAt: 1 })
    store.set('https://other.example.com', 'custom-lists', { ids: [2, 3], lastFullScanAt: 1 })
    store.forget(2)
    const reread = createFileCarrierIdStore(path)
    expect(reread.get(SERVER, 'routine').ids).toEqual([1])
    expect(reread.get('https://other.example.com', 'custom-lists').ids).toEqual([3])
  })

  it('starts empty from a damaged file and ignores junk entries', () => {
    const path = carrierIdsPath(dir)
    writeFileSync(path, '{"servers": {"a": {"routine": {"ids": [3, "x", -1, 2, 2.5], "lastFullScanAt": "later"}}, "b": 7}', 'utf-8')
    expect(createFileCarrierIdStore(path).get('a', 'routine')).toEqual({ ids: [], lastFullScanAt: 0 })

    writeFileSync(path, JSON.stringify({ servers: { a: { routine: { ids: [3, 'x', -1, 2, 2.5, 3], lastFullScanAt: 'later' } }, b: 7 } }), 'utf-8')
    expect(createFileCarrierIdStore(path).get('a', 'routine')).toEqual({ ids: [2, 3], lastFullScanAt: 0 })
  })
})
