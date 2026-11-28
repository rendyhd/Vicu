import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// The Pro ledger service against an in-memory Vikunja: the carrier it creates and merges, nothing
// sent while Pro is off, a task id remapped after an offline create, archiving, and bad operations.

const state = vi.hoisted(() => ({
  dir: '',
  tasks: new Map<number, { id: number; title: string; description: string; done: boolean; project_id: number }>(),
  nextId: 100,
  failWrites: false,
  /** Creating a task whose title starts with this fails. */
  failCreateTitlePrefix: null as string | null,
  offline: false,
  /** Called with the title of every create, before it is stored. */
  onCreate: null as null | ((title: string) => void),
  created: [] as string[],
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
    if (state.offline) return { success: false, error: 'Network error: connection refused' }
    let rows = [...state.tasks.values()].filter((task) => task.done || (typeof params.q === 'string' && params.filter === undefined))
    if (typeof params.q === 'string') rows = rows.filter((task) => task.description.includes(params.q as string))
    return { success: true, data: rows.map((task) => ({ created_by: { id: 1 }, ...task })) }
  },
  fetchTaskById: async (id: number) => {
    if (state.offline) return { success: false, error: 'Network error: connection refused' }
    const task = state.tasks.get(id)
    return task ? { success: true, data: { created_by: { id: 1 }, ...task } } : { success: false, error: 'Not found', statusCode: 404 }
  },
  createTask: async (projectId: number, body: { title: string; description: string; done?: boolean }) => {
    if (state.offline) return { success: false, error: 'Network error: connection refused' }
    if (state.failCreateTitlePrefix && body.title.startsWith(state.failCreateTitlePrefix)) return { success: false, error: 'Server error', statusCode: 500 }
    state.onCreate?.(body.title)
    state.created.push(body.title)
    const task = { id: state.nextId++, title: body.title, description: body.description, done: body.done === true, project_id: projectId }
    state.tasks.set(task.id, task)
    return { success: true, data: { ...task } }
  },
  updateTask: async (id: number, patch: { description?: string; done?: boolean }) => {
    if (state.offline || state.failWrites) return { success: false, error: 'Network error: connection refused' }
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
}))

import {
  PRO_LEDGER_TITLE,
  encodeProLedgerEnvelope,
  parseProArchiveEnvelope,
  parseProLedgerEnvelope,
} from '../pro-ledger-protocol'
import { emptyLedger, type ProLedger, type PromiseValue } from '../../shared/pro/ledger'

const DAY = 24 * 60 * 60 * 1000

async function loadService() {
  vi.resetModules()
  return await import('../pro-ledger-service')
}

function writeConfig(extra: Record<string, unknown> = {}) {
  writeFileSync(join(state.dir, 'config.json'), JSON.stringify({
    vikunja_url: 'https://tasks.example.com',
    api_token: 'unused',
    known_user: { server: 'https://tasks.example.com', id: 1 },
    inbox_project_id: 5,
    theme: 'dark',
    pro_enabled: true,
    ...extra,
  }), 'utf-8')
}

const rec = <V>(value: V | null, wall: number, device = 'other') => ({ value, revision: { wall_time_ms: wall, counter: 0, device_id: device } })

function putCarrier(id: number, ledger: ProLedger) {
  state.tasks.set(id, { id, title: PRO_LEDGER_TITLE, description: encodeProLedgerEnvelope(ledger), done: true, project_id: 5 })
}

const carriers = () => [...state.tasks.values()].filter((task) => task.title === PRO_LEDGER_TITLE)
const archiveParts = () => [...state.tasks.values()].filter((task) => task.title.startsWith('Vicu Pro archive'))
const carrierLedger = (id: number) => parseProLedgerEnvelope(state.tasks.get(id)!.description).document!

describe('pro ledger service', () => {
  beforeEach(() => {
    state.dir = mkdtempSync(join(tmpdir(), 'vicu-pro-ledger-'))
    state.tasks.clear()
    state.nextId = 100
    state.failWrites = false
    state.failCreateTitlePrefix = null
    state.offline = false
    state.onCreate = null
    state.created.length = 0
    state.sent.length = 0
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(state.dir, { recursive: true, force: true })
  })

  describe('a change while Pro is on', () => {
    it('marks the copy unsynced, then syncs it to a new carrier', async () => {
      writeConfig()
      state.offline = true
      const service = await loadService()

      service.mutateProLedger([{ op: 'set', collection: 'promises', id: '11', value: { dir: 'mine', person: 3 } }])
      await vi.waitFor(() => expect(service.getProLedgerStatus().state).not.toBe('syncing'))
      expect(service.hasUnsyncedProLedgerChanges()).toBe(true)
      expect(carriers()).toHaveLength(0)

      state.offline = false
      await service.syncProLedger()

      expect(service.hasUnsyncedProLedgerChanges()).toBe(false)
      expect(carriers()).toHaveLength(1)
      const document = carrierLedger(carriers()[0].id)
      expect(document.promises['11'].value).toMatchObject({ dir: 'mine', person: 3 })
      expect(carriers()[0].project_id).toBe(5)
    })

    it('tells the windows about the change', async () => {
      writeConfig()
      state.offline = true
      const service = await loadService()
      service.mutateProLedger([{ op: 'set', collection: 'owed', id: 'o1', value: { what: 'A decision' } }])
      expect(state.sent.some((entry) => entry.channel === 'pro-ledger-changed')).toBe(true)
    })
  })

  describe('a second device', () => {
    it('is merged: the verdicts, sent marks and checks of both sides survive', async () => {
      writeConfig()
      const now = Date.now()
      const remote: ProLedger = {
        ...emptyLedger(),
        promises: {
          '11': rec<PromiseValue>({
            dir: 'theirs',
            person: 3,
            verdicts: [{ id: 'a', at: new Date(now - 3 * DAY).toISOString(), kind: 'not_yet' }],
            sent: ['2026-11-01T10:00:00.000Z'],
            checked: ['2026-11-02T10:00:00.000Z'],
          }, now - 2 * DAY),
        },
      }
      putCarrier(7, remote)
      const service = await loadService()

      service.mutateProLedger([{
        op: 'set',
        collection: 'promises',
        id: '11',
        value: {
          dir: 'theirs',
          person: 3,
          verdicts: [{ id: 'b', at: new Date(now - DAY).toISOString(), kind: 'not_yet' }],
          sent: ['2026-11-05T10:00:00.000Z'],
          checked: ['2026-11-06T10:00:00.000Z'],
        },
      }])
      await vi.waitFor(() => expect(service.hasUnsyncedProLedgerChanges()).toBe(false))

      for (const document of [carrierLedger(7), service.getProLedger().ledger]) {
        const value = document.promises['11'].value!
        expect((value.verdicts ?? []).map((verdict) => verdict.id)).toEqual(['a', 'b'])
        expect(value.sent).toEqual(['2026-11-01T10:00:00.000Z', '2026-11-05T10:00:00.000Z'])
        expect(value.checked).toEqual(['2026-11-02T10:00:00.000Z', '2026-11-06T10:00:00.000Z'])
      }
      expect(carriers()).toHaveLength(1)
    })
  })

  describe('with Pro off', () => {
    it('sends nothing when asked to sync', async () => {
      writeConfig({ pro_enabled: false })
      putCarrier(7, { ...emptyLedger(), owed: { o1: rec({ what: 'x', opened: '2026-11-01' }, Date.now() - DAY) } })
      const before = state.tasks.get(7)!.description
      const service = await loadService()

      await service.syncProLedger()

      expect(state.created).toEqual([])
      expect(state.tasks.get(7)!.description).toBe(before)
      expect(service.hasUnsyncedProLedgerChanges()).toBe(false)
    })

    it('creates no carrier in the Inbox from a sync', async () => {
      writeConfig({ pro_enabled: false })
      const service = await loadService()
      await service.syncProLedger()
      expect(carriers()).toHaveLength(0)
    })
  })

  describe('remapProLedgerTask', () => {
    it('renames a temporary task id and leaves a tombstone under the old key', async () => {
      writeConfig()
      state.offline = true
      const service = await loadService()
      service.mutateProLedger([
        { op: 'set', collection: 'promises', id: '-5', value: { dir: 'mine', person: 3 } },
        { op: 'set', collection: 'promises', id: '12', value: { dir: 'mine', person: 3, needs: [-5] } },
        { op: 'estimate', taskId: -5, minutes: 30 },
      ])

      service.remapProLedgerTask(-5, 55)

      const ledger = service.getProLedger().ledger
      expect(ledger.promises['55'].value).toMatchObject({ dir: 'mine', person: 3 })
      expect(ledger.promises['-5'].value).toBeNull()
      expect(ledger.promises['12'].value?.needs).toEqual([55])
      expect(ledger.estimates['55']?.[0]).toBe(30)
      expect(ledger.estimates['-5']).toBeUndefined()
    })

    it('does nothing when the ledger never named the task', async () => {
      writeConfig()
      state.offline = true
      const service = await loadService()
      service.mutateProLedger([{ op: 'set', collection: 'owed', id: 'o1', value: { what: 'x' } }])
      const before = JSON.stringify(service.getProLedger().ledger)
      service.remapProLedgerTask(-9, 99)
      expect(JSON.stringify(service.getProLedger().ledger)).toBe(before)
    })
  })

  describe('archiving', () => {
    const oldLog = () => ({
      ...emptyLedger(),
      log: {
        old: rec({ kind: 'decision', text: 'Long ago', at: '2024-01-15' }, Date.now() - 400 * DAY),
        fresh: rec({ kind: 'decision', text: 'Today', at: new Date().toISOString().slice(0, 10) }, Date.now() - DAY),
      },
    })

    it('writes the archive part before it tombstones the records', async () => {
      writeConfig()
      putCarrier(7, oldLog())
      const service = await loadService()
      let heldWhenWritten: unknown = 'not written'
      state.onCreate = (title) => {
        if (title.startsWith('Vicu Pro archive')) heldWhenWritten = service.getProLedger().ledger.log.old?.value
      }

      await service.syncProLedger()
      await vi.waitFor(() => expect(service.getProLedger().ledger.log.old?.value).toBeNull())

      // At the moment the part was written the record was still in the ledger.
      expect(heldWhenWritten).toMatchObject({ text: 'Long ago' })
      expect(archiveParts()).toHaveLength(1)
      const part = parseProArchiveEnvelope(archiveParts()[0].description).document!
      expect(part.quarter).toBe('2024-Q1')
      expect(part.log?.old.value).toMatchObject({ text: 'Long ago' })
      expect(service.getProLedger().ledger.log.fresh.value).toMatchObject({ text: 'Today' })
    })

    it('tombstones nothing when the part cannot be written', async () => {
      writeConfig()
      putCarrier(7, oldLog())
      state.failCreateTitlePrefix = 'Vicu Pro archive'
      const service = await loadService()

      await service.syncProLedger()
      // Give the background archiving its turn.
      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(archiveParts()).toHaveLength(0)
      expect(service.getProLedger().ledger.log.old.value).toMatchObject({ text: 'Long ago' })
    })
  })

  describe('an invalid operation list', () => {
    it.each([
      ['not a list', { op: 'set' }],
      ['an unknown operation', [{ op: 'frobnicate' }]],
      ['an unknown collection', [{ op: 'set', collection: 'nope', id: 'x', value: 1 }]],
      ['an empty id', [{ op: 'set', collection: 'owed', id: '', value: 1 }]],
      ['a bad estimate', [{ op: 'estimate', taskId: 1, minutes: 5000 }]],
      ['settings that are a list', [{ op: 'settings', value: [] }]],
    ])('throws for %s and changes nothing', async (_name, operations) => {
      writeConfig()
      state.offline = true
      const service = await loadService()
      service.mutateProLedger([{ op: 'set', collection: 'owed', id: 'o1', value: { what: 'kept' } }])
      const before = JSON.stringify(service.getProLedger().ledger)

      expect(() => service.mutateProLedger(operations)).toThrow('Invalid Pro ledger change')
      expect(JSON.stringify(service.getProLedger().ledger)).toBe(before)
    })

    it('applies none of a list when one operation in it is invalid', async () => {
      writeConfig()
      state.offline = true
      const service = await loadService()
      expect(() => service.mutateProLedger([
        { op: 'set', collection: 'owed', id: 'good', value: { what: 'x' } },
        { op: 'bogus' },
      ])).toThrow()
      expect(service.getProLedger().ledger.owed.good).toBeUndefined()
    })
  })
})
