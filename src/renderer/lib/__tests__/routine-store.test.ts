import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createRoutineCarrier,
  deleteRoutine,
  loadArchiveParts,
  loadRoutineArchive,
  loadRoutineCsvEntries,
  writeRoutineCarrier,
  type RoutineStoreApi,
} from '../routine-store'
import {
  ROUTINE_ARCHIVE_TITLE,
  encodeRoutineArchiveEnvelope,
  encodeRoutineEnvelope,
  parseRoutineArchiveEnvelope,
  parseRoutineEnvelope,
  type RoutineArchivePart,
  type RoutineCarrier,
  type RoutineOccurrenceRecord,
  type RoutinePayload,
} from '../routines'
import type { ApiResult, CreateTaskPayload, Task, TaskQueryParams, UpdateTaskPayload } from '../vikunja-types'

const TODAY = '2026-10-06'

function record(date: string, over: Partial<RoutineOccurrenceRecord> = {}): RoutineOccurrenceRecord {
  return {
    key: `r1:${date}:s1`,
    routineId: 'r1',
    slotId: 's1',
    scheduledDate: date,
    scheduledMinutes: 480,
    timeZoneId: 'UTC',
    status: 'COMPLETED',
    loggedAt: `${date}T07:00:00.000Z`,
    modifiedAt: `${date}T07:00:00.000Z`,
    modifiedBy: 'a',
    note: '',
    ...over,
  }
}

function payloadOf(dates: string[], over: Partial<RoutinePayload> = {}): RoutinePayload {
  return {
    version: 1,
    definition: {
      id: 'r1',
      name: 'Vitamin D',
      kind: 'HEALTH',
      healthSubtype: 'SUPPLEMENT',
      amount: '1',
      unit: 'pill',
      iconName: 'pill',
      color: '#FF9900',
      schedule: { type: 'calendar', weekdays: [], weekInterval: 1, anchorDate: '2024-01-01' },
      slots: [{ id: 's1', label: 'Morning', period: 'MORNING', reminderMinutes: 480, reminderEnabled: true, followUpMinutes: 0 }],
      activeFrom: '2024-01-01',
      archived: false,
      createdAt: '2024-01-01T08:00:00.000Z',
      updatedAt: '2024-01-01T08:00:00.000Z',
      updatedBy: 'desktop-a',
    },
    occurrences: Object.fromEntries(dates.map((date) => [`r1:${date}:s1`, record(date)])),
    prunedBefore: '',
    ...over,
  }
}

/** A tiny in-memory Vikunja that records every call, with switches to make parts of it fail. */
class FakeServer implements RoutineStoreApi {
  tasks = new Map<number, Task>()
  log: string[] = []
  nextId = 100
  ignoreDoneOnCreate = false
  failCreateTitle: string | null = null
  failUpdateOfId: number | null = null
  failDeleteOfId: number | null = null
  dropKeysOnStore = false

  add(task: Partial<Task> & { id?: number }): Task {
    const id = task.id ?? this.nextId++
    const full = {
      id,
      title: '',
      description: '',
      done: true,
      project_id: 1,
      due_date: '0001-01-01T00:00:00Z',
      repeat_after: 0,
      repeat_mode: 0,
      reminders: [],
      ...task,
    } as Task
    this.tasks.set(id, full)
    return full
  }

  addCarrier(payload: RoutinePayload, id = 1): Task {
    return this.add({ id, title: payload.definition.name, description: encodeRoutineEnvelope(payload) })
  }

  addPart(part: RoutineArchivePart, id: number): Task {
    return this.add({ id, title: ROUTINE_ARCHIVE_TITLE, description: encodeRoutineArchiveEnvelope(part) })
  }

  parts(): Array<{ id: number; part: RoutineArchivePart }> {
    return [...this.tasks.values()].flatMap((task) => {
      const part = parseRoutineArchiveEnvelope(task.description).part
      return part ? [{ id: task.id, part }] : []
    })
  }

  carrier(id = 1): RoutinePayload {
    return parseRoutineEnvelope(this.tasks.get(id)!.description).payload!
  }

  async fetchTasks(params: TaskQueryParams): Promise<ApiResult<Task[]>> {
    this.log.push(`fetchTasks${params.q ? `:q=${params.q}` : ':all'}`)
    const wantDone = params.filter === 'done = true'
    const data = [...this.tasks.values()].filter((task) =>
      (!wantDone || task.done) && (!params.q || task.title.includes(params.q) || task.description.includes(params.q)))
    return { success: true, data: structuredClone(data) }
  }

  async fetchTaskById(id: number): Promise<ApiResult<Task>> {
    this.log.push(`fetchTaskById:${id}`)
    const task = this.tasks.get(id)
    return task ? { success: true, data: structuredClone(task) } : { success: false, error: 'not found' }
  }

  async createTask(projectId: number, input: CreateTaskPayload): Promise<ApiResult<Task>> {
    this.log.push(`createTask:${input.title}`)
    if (this.failCreateTitle && input.title === this.failCreateTitle) return { success: false, error: 'create failed' }
    const task = this.add({
      title: input.title,
      description: input.description ?? '',
      done: this.ignoreDoneOnCreate ? false : (input.done ?? false),
      project_id: projectId,
    })
    return { success: true, data: structuredClone(this.stored(task)) }
  }

  async updateTask(id: number, patch: UpdateTaskPayload): Promise<ApiResult<Task>> {
    this.log.push(`updateTask:${id}:${Object.keys(patch).join(',')}`)
    if (this.failUpdateOfId === id) return { success: false, error: 'update failed' }
    const task = this.tasks.get(id)
    if (!task) return { success: false, error: 'not found' }
    Object.assign(task, patch)
    return { success: true, data: structuredClone(this.stored(task)) }
  }

  async deleteTask(id: number): Promise<ApiResult<void>> {
    this.log.push(`deleteTask:${id}`)
    if (this.failDeleteOfId === id) return { success: false, error: 'delete failed' }
    this.tasks.delete(id)
    return { success: true, data: undefined }
  }

  /** What a server that silently truncates part descriptions would answer. */
  private stored(task: Task): Task {
    if (!this.dropKeysOnStore) return task
    const part = parseRoutineArchiveEnvelope(task.description).part
    if (!part) return task
    return { ...task, description: encodeRoutineArchiveEnvelope({ ...part, occurrences: {} }) }
  }
}

function carrierFor(server: FakeServer, id = 1): RoutineCarrier<Task> {
  return { task: server.tasks.get(id)!, payload: server.carrier(id) }
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('creating a routine carrier', () => {
  it('creates it done in a single request', async () => {
    const server = new FakeServer()
    const payload = payloadOf([])
    const created = await createRoutineCarrier(server, 7, payload)
    expect(server.log).toEqual(['createTask:Vitamin D'])
    expect(created.task.done).toBe(true)
    expect(created.task.project_id).toBe(7)
    expect(parseRoutineEnvelope(created.task.description).payload).toEqual(payload)
  })

  it('finishes the carrier with a patch only when the server ignored done', async () => {
    const server = new FakeServer()
    server.ignoreDoneOnCreate = true
    const created = await createRoutineCarrier(server, 7, payloadOf([]))
    expect(server.log).toEqual(['createTask:Vitamin D', 'updateTask:100:done'])
    expect(created.task.done).toBe(true)
  })
})

describe('writing a carrier', () => {
  it('writes a status change without touching the archive when nothing is old', async () => {
    const server = new FakeServer()
    const base = payloadOf(['2026-10-01'])
    server.addCarrier(base)
    const change = record('2026-10-06', { status: 'SKIPPED', modifiedAt: '2026-10-06T08:00:00.000Z' })
    const result = await writeRoutineCarrier(
      server,
      carrierFor(server),
      { ...base, occurrences: { ...base.occurrences, [change.key]: change } },
      { changed: [change], today: TODAY },
    )
    expect(server.log).toEqual(['fetchTaskById:1', 'updateTask:1:description'])
    expect(result.archiveError).toBeUndefined()
    expect(server.carrier().occurrences[change.key].status).toBe('SKIPPED')
    expect(server.parts()).toEqual([])
  })

  it('writes old history to the archive first and prunes the carrier only afterwards', async () => {
    const server = new FakeServer()
    const base = payloadOf(['2025-01-15', '2025-08-31', '2025-09-01', '2026-10-01'])
    server.addCarrier(base)
    const change = record('2026-10-06', { modifiedAt: '2026-10-06T08:00:00.000Z' })
    const result = await writeRoutineCarrier(
      server,
      carrierFor(server),
      { ...base, occurrences: { ...base.occurrences, [change.key]: change } },
      { changed: [change], today: TODAY },
    )
    expect(server.log).toEqual([
      'fetchTaskById:1',
      `fetchTasks:q=vicu-routine:archive`,
      `createTask:${ROUTINE_ARCHIVE_TITLE}`,
      'fetchTaskById:1',
      'updateTask:1:description',
    ])
    expect(result.archiveError).toBeUndefined()

    const [part] = server.parts()
    expect(part.part).toMatchObject({ routineId: 'r1', part: 1 })
    expect(Object.values(part.part.occurrences).map((entry) => entry.scheduledDate).sort()).toEqual(['2025-01-15', '2025-08-31'])
    const partTask = server.tasks.get(part.id)!
    expect(partTask).toMatchObject({ title: ROUTINE_ARCHIVE_TITLE, done: true, project_id: 1 })
    expect(partTask.description).toMatch(/^<!-- vicu-routine:archive:v1:[A-Za-z0-9_-]+ -->$/)

    const main = server.carrier()
    expect(main.prunedBefore).toBe('2025-09-01')
    expect(Object.values(main.occurrences).map((entry) => entry.scheduledDate).sort()).toEqual(['2025-09-01', '2026-10-01', '2026-10-06'])
  })

  it('leaves the carrier unpruned when the archive cannot be written', async () => {
    const server = new FakeServer()
    const base = payloadOf(['2025-01-15', '2026-10-01'])
    server.addCarrier(base)
    server.failCreateTitle = ROUTINE_ARCHIVE_TITLE
    const change = record('2026-10-06', { modifiedAt: '2026-10-06T08:00:00.000Z' })
    const onArchiveError = vi.fn()
    const result = await writeRoutineCarrier(
      server,
      carrierFor(server),
      { ...base, occurrences: { ...base.occurrences, [change.key]: change } },
      { changed: [change], today: TODAY, onArchiveError },
    )
    expect(result.archiveError).toBe('create failed')
    expect(onArchiveError).toHaveBeenCalledWith('create failed')
    expect(console.warn).toHaveBeenCalled()
    expect(server.parts()).toEqual([])
    const main = server.carrier()
    expect(main.prunedBefore).toBe('')
    expect(Object.values(main.occurrences).map((entry) => entry.scheduledDate).sort()).toEqual(['2025-01-15', '2026-10-01', '2026-10-06'])
    expect(result.payload.prunedBefore).toBe('')
  })

  it('does not prune when the server stored the archive part incompletely', async () => {
    const server = new FakeServer()
    const base = payloadOf(['2025-01-15', '2026-10-01'])
    server.addCarrier(base)
    server.dropKeysOnStore = true
    const result = await writeRoutineCarrier(server, carrierFor(server), base, { today: TODAY })
    expect(result.archiveError).toBe('Routine archive was not stored completely')
    expect(server.carrier().prunedBefore).toBe('')
    expect(Object.keys(server.carrier().occurrences)).toHaveLength(2)
  })

  it('does not prune when an existing part cannot be updated', async () => {
    const server = new FakeServer()
    const base = payloadOf(['2025-01-15', '2026-10-01'])
    server.addCarrier(base)
    server.addPart({ version: 1, routineId: 'r1', part: 1, occurrences: { 'r1:2024-05-01:s1': record('2024-05-01') } }, 50)
    server.failUpdateOfId = 50
    const result = await writeRoutineCarrier(server, carrierFor(server), base, { today: TODAY })
    expect(result.archiveError).toBe('update failed')
    expect(server.carrier().prunedBefore).toBe('')
    expect(Object.keys(server.carrier().occurrences)).toHaveLength(2)
    expect(Object.keys(server.parts()[0].part.occurrences)).toEqual(['r1:2024-05-01:s1'])
  })

  it('appends to the highest existing part instead of creating a new one', async () => {
    const server = new FakeServer()
    const base = payloadOf(['2025-01-15', '2026-10-01'], { prunedBefore: '2024-12-01' })
    server.addCarrier(base)
    server.addPart({ version: 1, routineId: 'r1', part: 1, occurrences: { 'r1:2024-05-01:s1': record('2024-05-01') } }, 50)
    await writeRoutineCarrier(server, carrierFor(server), base, { today: TODAY })
    expect(server.log).not.toContain(`createTask:${ROUTINE_ARCHIVE_TITLE}`)
    const parts = server.parts()
    expect(parts).toHaveLength(1)
    expect(Object.values(parts[0].part.occurrences).map((entry) => entry.scheduledDate).sort()).toEqual(['2024-05-01', '2025-01-15'])
    expect(server.carrier().prunedBefore).toBe('2025-09-01')
  })

  it('keeps what another device appended to the part in the meantime', async () => {
    const server = new FakeServer()
    const base = payloadOf(['2025-01-15', '2026-10-01'], { prunedBefore: '2024-12-01' })
    server.addCarrier(base)
    server.addPart({ version: 1, routineId: 'r1', part: 1, occurrences: { 'r1:2024-05-01:s1': record('2024-05-01') } }, 50)
    // Another device appends between our listing and our write.
    const original = server.fetchTasks.bind(server)
    server.fetchTasks = async (params) => {
      const result = await original(params)
      server.addPart({ version: 1, routineId: 'r1', part: 1, occurrences: { 'r1:2024-05-01:s1': record('2024-05-01'), 'r1:2024-06-01:s1': record('2024-06-01') } }, 50)
      return result
    }
    await writeRoutineCarrier(server, carrierFor(server), base, { today: TODAY })
    expect(Object.keys(server.parts()[0].part.occurrences).sort()).toEqual(['r1:2024-05-01:s1', 'r1:2024-06-01:s1', 'r1:2025-01-15:s1'])
  })

  it('writes a change to an archived occurrence to the part that holds it', async () => {
    const server = new FakeServer()
    const base = payloadOf(['2026-10-01'], { prunedBefore: '2025-09-01' })
    server.addCarrier(base)
    server.addPart({ version: 1, routineId: 'r1', part: 1, occurrences: { 'r1:2025-01-15:s1': record('2025-01-15') } }, 50)
    server.addPart({ version: 1, routineId: 'r1', part: 2, occurrences: { 'r1:2025-06-01:s1': record('2025-06-01') } }, 51)
    const edited = record('2025-01-15', { status: 'SKIPPED', loggedAt: '', modifiedAt: '2026-10-06T08:00:00.000Z' })
    await writeRoutineCarrier(
      server,
      carrierFor(server),
      { ...base, occurrences: { ...base.occurrences, [edited.key]: edited } },
      { changed: [edited], today: TODAY },
    )
    const byId = Object.fromEntries(server.parts().map((entry) => [entry.id, entry.part]))
    expect(byId[50].occurrences['r1:2025-01-15:s1'].status).toBe('SKIPPED')
    expect(Object.keys(byId[51].occurrences)).toEqual(['r1:2025-06-01:s1'])
    // The carrier does not take the archived occurrence back.
    expect(Object.keys(server.carrier().occurrences)).toEqual(['r1:2026-10-01:s1'])
  })

  it('fails the write, and leaves the carrier alone, when a change to archived history cannot be archived', async () => {
    const server = new FakeServer()
    const base = payloadOf(['2026-10-01'], { prunedBefore: '2025-09-01' })
    server.addCarrier(base)
    server.failCreateTitle = ROUTINE_ARCHIVE_TITLE
    const edited = record('2025-01-15', { status: 'SKIPPED', modifiedAt: '2026-10-06T08:00:00.000Z' })
    await expect(writeRoutineCarrier(
      server,
      carrierFor(server),
      { ...base, occurrences: { ...base.occurrences, [edited.key]: edited } },
      { changed: [edited], today: TODAY },
    )).rejects.toThrow('create failed')
    expect(server.log.some((entry) => entry.startsWith('updateTask:1'))).toBe(false)
  })
})

describe('reading the archive', () => {
  it('reads nothing when nothing was pruned', async () => {
    const server = new FakeServer()
    server.addCarrier(payloadOf(['2026-10-01']))
    expect(await loadRoutineArchive(server, carrierFor(server))).toEqual([])
    expect(server.log).toEqual([])
  })

  it('finds the parts of the routine with one marker search', async () => {
    const server = new FakeServer()
    server.addCarrier(payloadOf(['2026-10-01'], { prunedBefore: '2025-09-01' }))
    server.addPart({ version: 1, routineId: 'r1', part: 1, occurrences: { 'r1:2025-01-15:s1': record('2025-01-15') } }, 50)
    server.addPart({ version: 1, routineId: 'other', part: 1, occurrences: {} }, 51)
    const parts = await loadRoutineArchive(server, carrierFor(server))
    expect(parts.map((part) => part.routineId)).toEqual(['r1'])
    expect(server.log).toEqual(['fetchTasks:q=vicu-routine:archive'])
  })

  it('double-checks with a full scan when a pruned routine shows no part in the search', async () => {
    const server = new FakeServer()
    server.addCarrier(payloadOf(['2026-10-01'], { prunedBefore: '2025-09-01' }))
    // A part whose marker the search does not index (e.g. a server without description search).
    const hidden = server.addPart({ version: 1, routineId: 'r1', part: 1, occurrences: { 'r1:2025-01-15:s1': record('2025-01-15') } }, 50)
    const original = server.fetchTasks.bind(server)
    server.fetchTasks = async (params) => params.q ? (server.log.push('fetchTasks:q'), { success: true, data: [] }) : original(params)
    const parts = await loadArchiveParts(server, ['r1'])
    expect(parts.map((ref) => ref.taskId)).toEqual([hidden.id])
    expect(server.log).toEqual(['fetchTasks:q', 'fetchTasks:all'])
  })

  it('exports archived history in the CSV rows from a single search', async () => {
    const server = new FakeServer()
    server.addCarrier(payloadOf(['2026-10-01'], { prunedBefore: '2025-09-01' }))
    server.addPart({ version: 1, routineId: 'r1', part: 1, occurrences: { 'r1:2025-01-15:s1': record('2025-01-15') } }, 50)
    const entries = await loadRoutineCsvEntries(server, [carrierFor(server)])
    expect(entries).toHaveLength(1)
    expect([...entries[0].occurrences].map((entry) => entry.scheduledDate).sort()).toEqual(['2025-01-15', '2026-10-01'])
    expect(server.log).toEqual(['fetchTasks:q=vicu-routine:archive'])
  })
})

describe('deleting a routine', () => {
  it('deletes the archive parts and then the carrier', async () => {
    const server = new FakeServer()
    server.addCarrier(payloadOf(['2026-10-01'], { prunedBefore: '2025-09-01' }))
    server.addPart({ version: 1, routineId: 'r1', part: 1, occurrences: {} }, 50)
    server.addPart({ version: 1, routineId: 'r1', part: 1, occurrences: {} }, 51)
    server.addPart({ version: 1, routineId: 'other', part: 1, occurrences: {} }, 52)
    await deleteRoutine(server, carrierFor(server))
    expect(server.log.filter((entry) => entry.startsWith('deleteTask'))).toEqual(['deleteTask:50', 'deleteTask:51', 'deleteTask:1'])
    expect([...server.tasks.keys()]).toEqual([52])
  })

  it('keeps the routine when a part cannot be deleted so the delete can be retried', async () => {
    const server = new FakeServer()
    server.addCarrier(payloadOf(['2026-10-01'], { prunedBefore: '2025-09-01' }))
    server.addPart({ version: 1, routineId: 'r1', part: 1, occurrences: {} }, 50)
    server.failDeleteOfId = 50
    await expect(deleteRoutine(server, carrierFor(server))).rejects.toThrow('delete failed')
    expect(server.tasks.has(1)).toBe(true)
  })
})
