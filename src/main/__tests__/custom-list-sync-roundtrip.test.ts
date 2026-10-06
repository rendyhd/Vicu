import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const state = vi.hoisted(() => ({
  dir: '',
  // The carrier task on the "server": another device (Android) wrote it.
  remote: null as null | { id: number; title: string; description: string; done: boolean },
  writes: 0,
}))

vi.mock('electron', () => ({
  app: { getPath: () => state.dir },
  safeStorage: { isEncryptionAvailable: () => false },
  BrowserWindow: { getAllWindows: () => [] },
}))

vi.mock('../api-client', () => ({
  fetchTasks: async () => ({ success: true, data: state.remote ? [state.remote] : [] }),
  fetchTaskById: async () => ({ success: true, data: state.remote }),
  updateTask: async (_id: number, patch: { description?: string }) => {
    state.writes += 1
    if (state.remote && patch.description !== undefined) state.remote.description = patch.description
    return { success: true, data: state.remote }
  },
  createTask: async () => ({ success: false, error: 'not expected' }),
}))

import {
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

const androidList = (): CustomListWire => ({
  id: 'a',
  name: 'From Android',
  icon: 'star',
  color: '#ff8800',
  filter: {
    project_ids: [3],
    project_filter_mode: 'include',
    add_to_project_id: 0,
    sort_by: 'due_date',
    order_by: 'asc',
    due_date_filter: 'this_week',
    priority_filter: [],
    label_ids: [],
    include_done: false,
    include_today_all_projects: false,
    include_overdue: false,
    snooze_hidden_until: '2026-10-10',
  },
})

function remoteLists() {
  return activeLists(parseCustomListEnvelope(state.remote!.description).document!)
}

describe('custom lists keep fields another app added (cross-app semantics v1, section 3)', () => {
  beforeEach(() => {
    state.dir = mkdtempSync(join(tmpdir(), 'vicu-lists-'))
    state.writes = 0
    writeFileSync(join(state.dir, 'config.json'), JSON.stringify({
      vikunja_url: 'https://tasks.example.com',
      api_token: 'unused',
      inbox_project_id: 5,
      theme: 'dark',
    }), 'utf-8')
    state.remote = {
      id: 77,
      title: 'Vicu custom lists (sync metadata — do not delete)',
      description: encodeCustomListEnvelope(documentFromLists([androidList()], 'android-a', 1_000)),
      done: true,
    }
  })

  afterEach(() => {
    rmSync(state.dir, { recursive: true, force: true })
  })

  it('shows the list with its include_overdue flag and writes it back unchanged after a sync', async () => {
    const service = await loadService()
    expect((await service.syncCustomLists()).state).toBe('idle')

    const [list] = service.getCustomLists()
    expect(list.filter.include_overdue).toBe(false)
    expect(list.filter.snooze_hidden_until).toBe('2026-10-10')
    expect(list.color).toBe('#ff8800')

    const [onServer] = remoteLists()
    expect(onServer.filter.include_overdue).toBe(false)
    expect(onServer.filter.snooze_hidden_until).toBe('2026-10-10')
    expect(onServer.color).toBe('#ff8800')
  })

  it('keeps them on the server when the desktop adds another list', async () => {
    const service = await loadService()
    await service.syncCustomLists()

    service.upsertCustomList({
      id: 'b',
      name: 'From desktop',
      icon: '',
      filter: {
        project_ids: [],
        project_filter_mode: 'include',
        add_to_project_id: 0,
        sort_by: 'due_date',
        order_by: 'asc',
        due_date_filter: 'today',
        priority_filter: [],
        label_ids: [],
        include_done: false,
        include_today_all_projects: false,
      },
    })
    expect((await service.syncCustomLists()).state).toBe('idle')

    const onServer = remoteLists()
    expect(onServer.map((entry) => entry.id).sort()).toEqual(['a', 'b'])
    const a = onServer.find((entry) => entry.id === 'a')!
    expect(a.filter.snooze_hidden_until).toBe('2026-10-10')
    expect(a.filter.include_overdue).toBe(false)
    // The desktop's own list never gets a flag it was not given.
    expect('include_overdue' in onServer.find((entry) => entry.id === 'b')!.filter).toBe(false)
  })

  it('keeps them when the desktop edits the list the way the editor sends it', async () => {
    const service = await loadService()
    await service.syncCustomLists()

    // The editor starts from the list it was given and changes one field.
    const [shown] = service.getCustomLists()
    service.upsertCustomList({ ...shown, name: 'Renamed', filter: { ...shown.filter, due_date_filter: 'today' } } as CustomListWire)
    expect((await service.syncCustomLists()).state).toBe('idle')

    const [onServer] = remoteLists()
    expect(onServer.name).toBe('Renamed')
    expect(onServer.filter.due_date_filter).toBe('today')
    expect(onServer.filter.snooze_hidden_until).toBe('2026-10-10')
    expect(onServer.filter.include_overdue).toBe(false)
    expect(onServer.color).toBe('#ff8800')
  })
})
