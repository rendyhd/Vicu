import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// The synced preferences (cross-app semantics section 11) against an in-memory Vikunja: the
// carrier is made only once an entry exists, the Inbox moves once, the carrier's Inbox wins, and
// another user's or a newer version's carrier is never written.

const state = vi.hoisted(() => ({
  dir: '',
  tasks: new Map<number, { id: number; title: string; description: string; done: boolean; project_id: number; created_by: { id: number } }>(),
  nextId: 100,
  /** Every request fails as if the server could not be reached. */
  offline: false,
  sent: [] as Array<{ channel: string; payload: unknown }>,
  user: { id: 1, username: 'me', email: '', name: 'Me', default_project_id: 3 } as null | { id: number; username: string; email: string; name: string; default_project_id?: number },
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

vi.mock('../auth/user-info', () => ({ fetchCurrentUser: async () => state.user }))

vi.mock('../api-client', () => {
  const search = (q: string) => [...state.tasks.values()].filter((task) => task.description.includes(q)).map((task) => ({ ...task }))
  return {
    fetchTasks: async (params: Record<string, unknown>) => {
      if (state.offline) return { success: false, error: 'Network error: connection refused' }
      let rows = [...state.tasks.values()]
      if (params.filter === 'done = true') rows = rows.filter((task) => task.done)
      if (typeof params.q === 'string') rows = search(params.q)
      return { success: true, data: rows.map((task) => ({ ...task })) }
    },
    searchTasksAt: async (_url: string, _token: string, q: string) => ({ success: true, data: search(q) }),
    fetchTaskById: async (id: number) => {
      if (state.offline) return { success: false, error: 'Network error: connection refused' }
      const task = state.tasks.get(id)
      return task ? { success: true, data: { ...task } } : { success: false, error: 'Not found', statusCode: 404 }
    },
    createTask: async (projectId: number, body: { title: string; description: string; done?: boolean }) => {
      const task = { id: state.nextId++, title: body.title, description: body.description, done: body.done === true, project_id: projectId, created_by: { id: 1 } }
      state.tasks.set(task.id, task)
      return { success: true, data: { ...task } }
    },
    updateTask: async (id: number, patch: { title?: string; description?: string; done?: boolean }) => {
      if (state.offline) return { success: false, error: 'Network error: connection refused' }
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
  }
})

import { PREFS_CARRIER_TITLE, encodePrefsEnvelope, parsePrefsEnvelope } from '../synced-prefs-protocol'
import type { SyncedPrefsDocument } from '../../shared/synced-prefs'

async function loadService() {
  vi.resetModules()
  return await import('../synced-preferences')
}

function writeConfig(extra: Record<string, unknown> = {}) {
  writeFileSync(join(state.dir, 'config.json'), JSON.stringify({
    vikunja_url: 'https://tasks.example.com',
    api_token: 'unused',
    known_user: { server: 'https://tasks.example.com', id: 1 },
    inbox_project_id: 5,
    theme: 'dark',
    ...extra,
  }), 'utf-8')
}

const savedConfig = () => JSON.parse(readFileSync(join(state.dir, 'config.json'), 'utf-8')) as {
  inbox_project_id: number
  synced_prefs_sync?: { dirty: boolean; moved?: boolean; document: SyncedPrefsDocument }
}

const entry = (value: unknown, wall = 1_792_000_000_000) => ({ value, revision: { wall_time_ms: wall, counter: 0, device_id: 'phone' } })

function putCarrier(id: number, document: SyncedPrefsDocument | string, owner = 1) {
  const description = typeof document === 'string' ? document : encodePrefsEnvelope(document)
  state.tasks.set(id, { id, title: PREFS_CARRIER_TITLE, description, done: true, project_id: 5, created_by: { id: owner } })
}

const documentOf = (id: number) => parsePrefsEnvelope(state.tasks.get(id)!.description).document!
const carriers = () => [...state.tasks.values()].filter((task) => task.title === PREFS_CARRIER_TITLE)

describe('synced preferences', () => {
  beforeEach(() => {
    state.dir = mkdtempSync(join(tmpdir(), 'vicu-prefs-'))
    state.tasks.clear()
    state.nextId = 100
    state.offline = false
    state.sent.length = 0
    state.user = { id: 1, username: 'me', email: '', name: 'Me', default_project_id: 3 }
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(state.dir, { recursive: true, force: true })
  })

  it('creates no carrier for a device that never chose a synced setting', async () => {
    writeConfig({ inbox_project_id: 0 })
    const service = await loadService()
    expect((await service.syncSyncedPrefs()).state).toBe('idle')
    expect(carriers()).toEqual([])
    expect(savedConfig().synced_prefs_sync?.moved).toBe(true)
  })

  it("moves this device's Inbox into a new carrier, in the Inbox, done, after the first read", async () => {
    writeConfig({ inbox_project_id: 5 })
    const service = await loadService()
    await service.syncSyncedPrefs()
    await vi.waitFor(() => expect(carriers()).toHaveLength(1))
    await vi.waitFor(() => expect(savedConfig().synced_prefs_sync?.dirty).toBe(false))

    const [carrier] = carriers()
    expect(carrier).toMatchObject({ project_id: 5, done: true })
    expect(carrier.description.startsWith('<!-- vicu-prefs:v1:')).toBe(true)
    expect(documentOf(carrier.id).entries.inbox_project_id.value).toBe(5)
  })

  it("takes the account's Inbox from the carrier instead of writing its own, and says so once", async () => {
    writeConfig({ inbox_project_id: 5 })
    putCarrier(7, { version: 1, entries: { inbox_project_id: entry(9) } })
    const before = state.tasks.get(7)!.description
    const service = await loadService()

    expect((await service.syncSyncedPrefs()).state).toBe('idle')
    expect(savedConfig().inbox_project_id).toBe(9)
    expect(state.tasks.get(7)!.description).toBe(before)
    const announced = state.sent.filter((entry) => entry.channel === 'synced-prefs-changed').map((entry) => entry.payload as { adoptedInbox?: number })
    expect(announced.some((payload) => payload.adoptedInbox === 9)).toBe(true)

    // Later changes on another device are followed silently.
    putCarrier(7, { version: 1, entries: { inbox_project_id: entry(11, 1_792_000_100_000) } })
    state.sent.length = 0
    await service.syncSyncedPrefs()
    expect(savedConfig().inbox_project_id).toBe(11)
    const later = state.sent.filter((entry) => entry.channel === 'synced-prefs-changed').map((entry) => entry.payload as { adoptedInbox?: number })
    expect(later.length).toBeGreaterThan(0)
    expect(later.every((payload) => payload.adoptedInbox === undefined)).toBe(true)
  })

  it('writes a choice, keeps unknown keys and values, and refuses keys it does not know', async () => {
    writeConfig({ inbox_project_id: 0 })
    putCarrier(7, { version: 1, entries: { future_setting: entry({ mode: 'x' }), 'task_order.project.4': entry('sideways') }, note: 'kept' })
    const service = await loadService()
    await service.syncSyncedPrefs()

    service.setSyncedPreference('task_order', 'manual')
    await vi.waitFor(() => expect(documentOf(7).entries.task_order?.value).toBe('manual'))
    const document = documentOf(7)
    expect(document.entries.future_setting.value).toEqual({ mode: 'x' })
    expect(document.entries['task_order.project.4'].value).toBe('sideways')
    expect(document.note).toBe('kept')

    expect(() => service.setSyncedPreference('theme', 'dark')).toThrow()
    expect(() => service.setSyncedPreference('task_order', 'sideways')).toThrow()
    expect(() => service.setSyncedPreference('inbox_project_id', 0)).toThrow()
    // "Default" is a null entry, which reaches every device.
    service.setSyncedPreference('task_order', null)
    await vi.waitFor(() => expect(documentOf(7).entries.task_order.value).toBeNull())
  })

  it('writes a location reminder at a saved place and never a place', async () => {
    writeConfig({ inbox_project_id: 0 })
    putCarrier(7, { version: 1, entries: { 'place.home': entry({ name: 'Home' }) } })
    const service = await loadService()
    await service.syncSyncedPrefs()

    service.setSyncedPreference('location_reminder.42', { place: 'home', trigger: 'leave', radius_m: 500 })
    await vi.waitFor(() => expect(documentOf(7).entries['location_reminder.42']?.value).toEqual({ place: 'home', trigger: 'leave', radius_m: 500 }))
    expect(documentOf(7).entries['place.home'].value).toEqual({ name: 'Home' })

    // Positions stay on the phone: the desktop cannot create, rename or delete a place.
    expect(() => service.setSyncedPreference('place.office', { name: 'Office' })).toThrow()
    expect(() => service.setSyncedPreference('place.home', null)).toThrow()
    // A temporary id, a value of the wrong shape or with more fields is refused.
    expect(() => service.setSyncedPreference('location_reminder.-3', { place: 'home', trigger: 'arrive', radius_m: 200 })).toThrow()
    expect(() => service.setSyncedPreference('location_reminder.42', { place: 'home', trigger: 'nearby', radius_m: 200 })).toThrow()
    expect(() => service.setSyncedPreference('location_reminder.42', { place: 'home', trigger: 'arrive', radius_m: 50 })).toThrow()
    expect(() => service.setSyncedPreference('location_reminder.42', { place: 'home', trigger: 'arrive', radius_m: 200, lat: 52.3 })).toThrow()

    service.setSyncedPreference('location_reminder.42', null)
    await vi.waitFor(() => expect(documentOf(7).entries['location_reminder.42'].value).toBeNull())
  })

  it('writes project categories, several keys in one change (section 13)', async () => {
    writeConfig({ inbox_project_id: 0 })
    putCarrier(7, { version: 1, entries: { 'category.work': entry({ name: 'Work', order: 65536, color: 'teal' }) } })
    const service = await loadService()
    await service.syncSyncedPrefs()

    // A newer app's fields stay with the category.
    service.setSyncedPreferences({
      'category.home': { name: 'Home', order: 131072 },
      'category.project.3': 'home',
      'category.work': { name: 'Office', order: 65536, color: 'teal' },
    })
    await vi.waitFor(() => expect(documentOf(7).entries['category.project.3']?.value).toBe('home'))
    expect(documentOf(7).entries['category.work'].value).toEqual({ name: 'Office', order: 65536, color: 'teal' })
    expect(documentOf(7).entries['category.home'].value).toEqual({ name: 'Home', order: 131072 })

    // One bad value and nothing of the batch is written.
    expect(() => service.setSyncedPreferences({ 'category.project.3': null, 'category.project': { name: 'X', order: 1 } })).toThrow()
    expect(service.getSyncedPrefs().values['category.project.3']).toBe('home')
    expect(() => service.setSyncedPreference('category.home', { name: '  ', order: 1 })).toThrow()
    expect(() => service.setSyncedPreference('category.home', { name: 'Home' })).toThrow()
    expect(() => service.setSyncedPreference('category.project.3', 'a.b')).toThrow()
    expect(() => service.setSyncedPreference('category.project.-3', 'home')).toThrow()

    // A delete: the category and its projects' entries, together.
    service.setSyncedPreferences({ 'category.home': null, 'category.project.3': null })
    await vi.waitFor(() => expect(documentOf(7).entries['category.home'].value).toBeNull())
    expect(documentOf(7).entries['category.project.3'].value).toBeNull()
  })

  it("writes a shared routine's reminders and hiding for this account only (section 6.9)", async () => {
    writeConfig({ inbox_project_id: 0 })
    putCarrier(7, { version: 1, entries: {} })
    const service = await loadService()
    await service.syncSyncedPrefs()

    service.setSyncedPreference('routine_reminders.3f2a-routine', 'off')
    service.setSyncedPreference('routine_hidden.3f2a-routine', true)
    await vi.waitFor(() => expect(documentOf(7).entries['routine_hidden.3f2a-routine']?.value).toBe(true))
    expect(documentOf(7).entries['routine_reminders.3f2a-routine'].value).toBe('off')

    expect(() => service.setSyncedPreference('routine_reminders.3f2a-routine', 'on')).toThrow()
    expect(() => service.setSyncedPreference('routine_hidden.3f2a-routine', false)).toThrow()
    expect(() => service.setSyncedPreference('routine_hidden.bad id', true)).toThrow()

    service.setSyncedPreference('routine_reminders.3f2a-routine', null)
    await vi.waitFor(() => expect(documentOf(7).entries['routine_reminders.3f2a-routine'].value).toBeNull())
  })

  it('writes the day the last weekly review was finished (section 14.7)', async () => {
    writeConfig({ inbox_project_id: 0 })
    putCarrier(7, { version: 1, entries: {} })
    const service = await loadService()
    await service.syncSyncedPrefs()

    service.setSyncedPreference('weekly_review.last', '2026-10-27')
    await vi.waitFor(() => expect(documentOf(7).entries['weekly_review.last']?.value).toBe('2026-10-27'))

    expect(() => service.setSyncedPreference('weekly_review.last', '2026-02-30')).toThrow()
    expect(() => service.setSyncedPreference('weekly_review.last', 'last week')).toThrow()
  })

  it("never reads or writes another user's carrier", async () => {
    writeConfig({ inbox_project_id: 5 })
    putCarrier(7, { version: 1, entries: { inbox_project_id: entry(42) } }, 2)
    const before = state.tasks.get(7)!.description
    const service = await loadService()
    await service.syncSyncedPrefs()
    await vi.waitFor(() => expect(carriers()).toHaveLength(2))

    expect(savedConfig().inbox_project_id).toBe(5)
    expect(state.tasks.get(7)!.description).toBe(before)
  })

  it('stops with "update required" when a newer version wrote the carrier, and writes nothing', async () => {
    writeConfig({ inbox_project_id: 5 })
    putCarrier(7, '<!-- vicu-prefs:v2:e30 -->')
    const service = await loadService()
    expect((await service.syncSyncedPrefs()).state).toBe('update_required')
    expect(state.tasks.get(7)!.description).toBe('<!-- vicu-prefs:v2:e30 -->')
    expect(carriers()).toHaveLength(1)
  })

  it('discards settings changes that never reached the server: the synced Inbox and order come back', async () => {
    writeConfig({ inbox_project_id: 5 })
    putCarrier(7, { version: 1, entries: { inbox_project_id: entry(9), 'task_order.project.4': entry('manual') } })
    const service = await loadService()
    await service.syncSyncedPrefs()
    expect(savedConfig().inbox_project_id).toBe(9)
    const before = state.tasks.get(7)!.description

    state.offline = true
    service.setSyncedPreference('task_order', 'title')
    service.setSyncedPreference('inbox_project_id', 12)
    await vi.waitFor(() => expect(service.getSyncedPrefsStatus().state).toBe('offline'))
    expect(service.hasUnsyncedPreferenceChanges()).toBe(true)
    expect(service.getSyncedPrefs().inboxProjectId).toBe(12)
    state.sent.length = 0

    expect(service.discardUnsyncedPreferenceChanges()).toBe(true)
    expect(service.hasUnsyncedPreferenceChanges()).toBe(false)
    expect(service.getSyncedPrefs()).toEqual({ values: { inbox_project_id: 9, 'task_order.project.4': 'manual' }, inboxProjectId: 9 })
    expect(state.sent.some((entry) => entry.channel === 'synced-prefs-changed')).toBe(true)

    state.offline = false
    expect((await service.syncSyncedPrefs()).state).toBe('idle')
    expect(state.tasks.get(7)!.description).toBe(before)
    expect(savedConfig().synced_prefs_sync?.dirty).toBe(false)
    expect(service.discardUnsyncedPreferenceChanges()).toBe(false)
  })

  describe('setup', () => {
    it("reads the account's synced Inbox and Vikunja's default project before asking", async () => {
      writeConfig({ vikunja_url: '', inbox_project_id: 0 })
      putCarrier(7, { version: 1, entries: { inbox_project_id: entry(9) } })
      putCarrier(8, { version: 1, entries: { inbox_project_id: entry(77, 1_792_000_500_000) } }, 2)
      const service = await loadService()
      expect(await service.readSetupPreferences('https://tasks.example.com/', 'tk')).toEqual({ inboxProjectId: 9, defaultProjectId: 3 })
    })

    it('writes nothing when the chosen Inbox is the synced one, and the answer when it is not', async () => {
      writeConfig({ vikunja_url: '', inbox_project_id: 0 })
      putCarrier(7, { version: 1, entries: { inbox_project_id: entry(9) } })
      const before = state.tasks.get(7)!.description
      const service = await loadService()
      await service.readSetupPreferences('https://tasks.example.com', 'tk')

      writeConfig({ inbox_project_id: 9 })
      service.inboxChosenAtSetup('https://tasks.example.com', 9)
      await vi.waitFor(() => expect(savedConfig().synced_prefs_sync?.moved).toBe(true))
      expect(state.tasks.get(7)!.description).toBe(before)

      writeConfig({ inbox_project_id: 12 })
      const again = await loadService()
      await again.readSetupPreferences('https://tasks.example.com', 'tk')
      again.inboxChosenAtSetup('https://tasks.example.com', 12)
      await vi.waitFor(() => expect(documentOf(7).entries.inbox_project_id.value).toBe(12))
      expect(savedConfig().inbox_project_id).toBe(12)
    })
  })
})

describe('project icons (section 11.3)', () => {
  it('takes "none" or null for a project_icon key and nothing else', async () => {
    const { isWritablePref } = await loadService()
    expect(isWritablePref('project_icon.5', 'none')).toBe(true)
    expect(isWritablePref('project_icon.5', null)).toBe(true)
    expect(isWritablePref('project_icon.5', 'rocket')).toBe(false)
    expect(isWritablePref('project_icon.0', 'none')).toBe(false)
    expect(isWritablePref('project_icon.x', 'none')).toBe(false)
  })
})
