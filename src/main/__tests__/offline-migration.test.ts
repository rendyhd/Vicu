import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { migrateLegacyCache } from '../offline/legacy-migration'
import { backupPathFor } from '../atomic-file'
import { OfflineQueue } from '../offline/queue'

const NULL_DATE = '0001-01-01T00:00:00Z'

describe('migrateLegacyCache (one-time split of offline-cache.json)', () => {
  let dir: string
  let warn: ReturnType<typeof vi.spyOn>
  const cachePath = () => join(dir, 'offline-cache.json')
  const queuePath = () => join(dir, 'offline-queue.json')
  const standalonePath = () => join(dir, 'standalone-tasks.json')
  const read = (path: string) => JSON.parse(readFileSync(path, 'utf-8'))

  const legacy = {
    pendingActions: [
      { id: 'c1', type: 'create', createdAt: '2026-10-01T10:00:00Z', title: 'Buy milk', description: 'two litres', dueDate: '2026-10-02T23:59:59Z', projectId: 7 },
      { id: 'c2', type: 'create', createdAt: '2026-10-01T10:01:00Z', title: 'No project', projectId: null },
      { id: 'u1', type: 'complete', createdAt: '2026-10-01T10:02:00Z', taskId: 5, taskData: { id: 5, title: 'Pay rent', description: 'stale snapshot', priority: 4, created: 'x' } },
      { id: 'u2', type: 'uncomplete', createdAt: '2026-10-01T10:03:00Z', taskId: 6, taskData: { id: 6, title: 'T' } },
      { id: 'u3', type: 'schedule-today', createdAt: '2026-10-01T10:04:00Z', taskId: 8, taskData: { id: 8, title: 'Sched', priority: 9 }, dueDate: '2026-10-01T23:59:59Z' },
      { id: 'u4', type: 'remove-due-date', createdAt: '2026-10-01T10:05:00Z', taskId: 9, taskData: { id: 9, title: 'Clear' }, dueDate: NULL_DATE },
      { id: 'u5', type: 'update-task', createdAt: '2026-10-01T10:06:00Z', taskId: 10, taskData: { id: 10, title: 'Renamed', created: 'x', labels: [{ id: 1 }] } },
      { id: 'u6', type: 'complete', createdAt: '2026-10-01T10:07:00Z', taskId: 5 },
      { id: 'x1', type: 'mystery', createdAt: '2026-10-01T10:08:00Z', taskId: 11 },
      { id: 'x2', type: 'complete', createdAt: '2026-10-01T10:09:00Z' },
    ],
    cachedTasks: [{ id: 1, title: 'cached' }],
    cachedTasksTimestamp: '2026-10-01T09:00:00Z',
    standaloneTasks: [{ id: 'local_1', title: 'Local only', description: '', due_date: NULL_DATE, priority: 0, done: false, created: 'c', updated: 'u' }],
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vicu-offline-migrate-'))
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warn.mockRestore()
    rmSync(dir, { recursive: true, force: true })
  })

  it('does nothing when there is no cache file', () => {
    expect(migrateLegacyCache(dir)).toEqual({ migrated: false })
    expect(existsSync(queuePath())).toBe(false)
  })

  it('splits the combined file into queue, standalone tasks and a task cache', () => {
    writeFileSync(cachePath(), JSON.stringify(legacy, null, 2))

    const result = migrateLegacyCache(dir)

    expect(result).toMatchObject({ migrated: true, actions: 6, standaloneTasks: 1 })
    expect(read(cachePath())).toEqual({ cachedTasks: legacy.cachedTasks, cachedTasksTimestamp: legacy.cachedTasksTimestamp })
    expect(read(standalonePath())).toEqual({ standaloneTasks: legacy.standaloneTasks })
    expect(readFileSync(queuePath(), 'utf-8')).not.toContain('\n')
  })

  it('keeps the original combined file as a backup', () => {
    writeFileSync(cachePath(), JSON.stringify(legacy, null, 2))
    migrateLegacyCache(dir)
    expect(read(backupPathFor(cachePath())).pendingActions).toHaveLength(legacy.pendingActions.length)
  })

  it('converts old actions to patches, dropping the stale snapshots (D-SYNC-2)', () => {
    writeFileSync(cachePath(), JSON.stringify(legacy))
    migrateLegacyCache(dir)

    const queue = new OfflineQueue({ queuePath: queuePath(), attachmentsDir: join(dir, 'att') })
    queue.load()
    const pending = queue.getPending()

    expect(pending.find((a) => a.id === 'c1')).toMatchObject({
      type: 'create', projectId: 7, tempId: -1,
      fields: { title: 'Buy milk', description: 'two litres', due_date: '2026-10-02T23:59:59Z' },
    })
    // complete + the later complete of the same task merge; only { done } remains, no snapshot fields
    expect(pending.find((a) => a.id === 'u1')).toMatchObject({ type: 'update', taskId: 5, patch: { done: true }, title: 'Pay rent' })
    expect(pending.find((a) => a.id === 'u2')).toMatchObject({ taskId: 6, patch: { done: false } })
    expect(pending.find((a) => a.id === 'u3')).toMatchObject({ taskId: 8, patch: { due_date: '2026-10-01T23:59:59Z' } })
    expect(pending.find((a) => a.id === 'u4')).toMatchObject({ taskId: 9, patch: { due_date: null } })
    // a legacy update-task snapshot is reduced to its writable fields
    expect(pending.find((a) => a.id === 'u5')).toMatchObject({ taskId: 10, patch: { title: 'Renamed' } })
    expect(Object.keys((pending.find((a) => a.id === 'u5') as { patch: object }).patch)).toEqual(['title'])
    // unusable entries (no project, unknown type, no task id) are dropped, as the old replay did
    expect(pending.map((a) => a.id)).toEqual(['c1', 'u1', 'u2', 'u3', 'u4', 'u5'])
    expect(queue.getPending().filter((a) => a.type === 'create')).toHaveLength(1)
  })

  // F4: the snapshot a legacy update-task carries is the whole row as it was when the edit was
  // made. Only the title and the description were ever edited; the rest would overwrite what
  // other devices changed since.
  it('keeps only the title and the description of a legacy update-task snapshot', () => {
    const snapshot = {
      id: 12, title: 'Renamed', description: '<p>new notes</p>', priority: 4, due_date: '2026-10-03T23:59:59Z', done: false,
      repeat_after: 86400, repeat_mode: 0, project_id: 3, percent_done: 0.5, hex_color: 'ff0000', is_favorite: true,
      reminders: [{ reminder: '2026-10-03T08:00:00Z' }], labels: [{ id: 1 }], created: 'x', updated: 'y',
    }
    writeFileSync(cachePath(), JSON.stringify({ pendingActions: [{ id: 'u9', type: 'update-task', createdAt: '2026-10-01T10:00:00Z', taskId: 12, taskData: snapshot }] }))

    migrateLegacyCache(dir)

    const queue = new OfflineQueue({ queuePath: queuePath(), attachmentsDir: join(dir, 'att') })
    queue.load()
    const [action] = queue.getPending()
    expect(action).toMatchObject({ type: 'update', taskId: 12, title: 'Renamed', patch: { title: 'Renamed', description: '<p>new notes</p>' } })
    expect(Object.keys((action as { patch: object }).patch).sort()).toEqual(['description', 'title'])
  })

  it('drops a legacy update-task that carries neither a title nor a description', () => {
    writeFileSync(cachePath(), JSON.stringify({ pendingActions: [
      { id: 'u9', type: 'update-task', createdAt: '2026-10-01T10:00:00Z', taskId: 12, taskData: { id: 12, priority: 4, due_date: '2026-10-03T23:59:59Z' } },
      { id: 'u10', type: 'complete', createdAt: '2026-10-01T10:01:00Z', taskId: 13 },
    ] }))

    migrateLegacyCache(dir)

    const queue = new OfflineQueue({ queuePath: queuePath(), attachmentsDir: join(dir, 'att') })
    queue.load()
    expect(queue.getPending().map((a) => a.id)).toEqual(['u10'])
  })

  it('a legacy title edit and a later complete of the same task end up as one patch without snapshot fields', () => {
    writeFileSync(cachePath(), JSON.stringify({ pendingActions: [
      { id: 'u1', type: 'update-task', createdAt: '2026-10-01T10:00:00Z', taskId: 12, taskData: { id: 12, title: 'New', priority: 3 } },
      { id: 'u2', type: 'complete', createdAt: '2026-10-01T10:01:00Z', taskId: 12 },
    ] }))

    migrateLegacyCache(dir)

    const queue = new OfflineQueue({ queuePath: queuePath(), attachmentsDir: join(dir, 'att') })
    queue.load()
    expect(queue.getPending()).toHaveLength(1)
    expect((queue.getPending()[0] as { patch: object }).patch).toEqual({ title: 'New', done: true })
  })

  it('splits a legacy cache file that was saved with a UTF-8 byte order mark (F9)', () => {
    writeFileSync(cachePath(), '﻿' + JSON.stringify(legacy))

    expect(migrateLegacyCache(dir)).toMatchObject({ migrated: true, actions: 6, standaloneTasks: 1 })
  })

  it('temp ids continue counting down after migrated creates', async () => {
    writeFileSync(cachePath(), JSON.stringify(legacy))
    migrateLegacyCache(dir)
    const queue = new OfflineQueue({ queuePath: queuePath(), attachmentsDir: join(dir, 'att') })
    queue.load()
    const next = await queue.enqueueCreate({ projectId: 7, fields: { title: 'new' } })
    expect(next.tempId).toBe(-2)
  })

  it('is idempotent: a second run changes nothing', () => {
    writeFileSync(cachePath(), JSON.stringify(legacy))
    migrateLegacyCache(dir)
    const queueBefore = readFileSync(queuePath(), 'utf-8')
    const cacheBefore = readFileSync(cachePath(), 'utf-8')

    expect(migrateLegacyCache(dir)).toEqual({ migrated: false })

    expect(readFileSync(queuePath(), 'utf-8')).toBe(queueBefore)
    expect(readFileSync(cachePath(), 'utf-8')).toBe(cacheBefore)
  })

  it('finishes an interrupted migration without overwriting a queue that was already written', () => {
    writeFileSync(cachePath(), JSON.stringify(legacy))
    // The previous run got as far as the queue file, then crashed before stripping the cache file.
    writeFileSync(queuePath(), JSON.stringify({ version: 1, actions: [], failed: [], resolved: {}, lastTempId: 0, marker: 'kept' }))

    const result = migrateLegacyCache(dir)

    expect(result.migrated).toBe(true)
    expect(read(queuePath()).marker).toBe('kept')
    expect(read(standalonePath()).standaloneTasks).toHaveLength(1)
    expect(read(cachePath())).not.toHaveProperty('pendingActions')
  })

  it('leaves a cache file that is already in the new format alone', () => {
    const modern = { cachedTasks: [{ id: 1 }], cachedTasksTimestamp: 't' }
    writeFileSync(cachePath(), JSON.stringify(modern))
    expect(migrateLegacyCache(dir)).toEqual({ migrated: false })
    expect(read(cachePath())).toEqual(modern)
    expect(existsSync(queuePath())).toBe(false)
  })

  it('does not touch a legacy file it cannot parse, and does not invent an empty queue', () => {
    writeFileSync(cachePath(), '{"pendingActions": [ {')
    const result = migrateLegacyCache(dir)
    expect(result.migrated).toBe(false)
    expect(readFileSync(cachePath(), 'utf-8')).toBe('{"pendingActions": [ {')
    expect(existsSync(queuePath())).toBe(false)
  })

  it('handles a file with only an empty queue and no standalone tasks', () => {
    writeFileSync(cachePath(), JSON.stringify({ pendingActions: [], cachedTasks: null, cachedTasksTimestamp: null, standaloneTasks: [] }))
    expect(migrateLegacyCache(dir)).toMatchObject({ migrated: true, actions: 0, standaloneTasks: 0 })
    expect(existsSync(queuePath())).toBe(false)
    expect(existsSync(standalonePath())).toBe(false)
    expect(read(cachePath())).toEqual({ cachedTasks: null, cachedTasksTimestamp: null })
  })
})
