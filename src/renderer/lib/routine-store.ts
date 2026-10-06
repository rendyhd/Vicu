/**
 * Reads and writes routine carriers and archive parts through the task API
 * (docs/cross-app-semantics-v1.md, section 6). The API is injected so the write order can be tested
 * with a fake server; the hooks pass the real `api`.
 *
 * Write order for a carrier, the part that matters for data safety:
 *   1. read the carrier fresh and merge it with the local change;
 *   2. work out which history is older than the rolling window (`pruneRoutinePayload`);
 *   3. write that history to the archive parts first;
 *   4. only when that succeeded, write the carrier without it and with the new `prunedBefore`.
 * If step 3 fails the carrier is still written, unpruned, so no history is ever lost.
 */
import { taskPatch } from './merge-patches'
import {
  NULL_DATE,
  ROUTINE_ARCHIVE_SEARCH,
  ROUTINE_ARCHIVE_TITLE,
  ROUTINE_BUDGET_BYTES,
  encodeRoutineArchiveEnvelope,
  localDateString,
  mergeOccurrenceMaps,
  mergeRoutinePayload,
  parseRoutineArchiveEnvelope,
  parseRoutineEnvelope,
  planArchiveWrites,
  pruneRoutinePayload,
  readRoutineHistory,
  upsertRoutineEnvelope,
  utf8Bytes,
  type ArchiveOp,
  type ArchivePartRef,
  type RoutineArchivePart,
  type RoutineCarrier,
  type RoutineCsvEntry,
  type RoutineOccurrenceRecord,
  type RoutinePayload,
} from './routines'
import type { ApiResult, CreateTaskPayload, Task, TaskQueryParams, UpdateTaskPayload } from './vikunja-types'

/** The slice of the task API the routine store needs. */
export interface RoutineStoreApi {
  fetchTasks(params: TaskQueryParams): Promise<ApiResult<Task[]>>
  fetchTaskById(id: number): Promise<ApiResult<Task>>
  createTask(projectId: number, task: CreateTaskPayload): Promise<ApiResult<Task>>
  updateTask(id: number, patch: UpdateTaskPayload): Promise<ApiResult<Task>>
  deleteTask(id: number): Promise<ApiResult<void>>
}

export interface RoutineWriteOptions {
  /** The occurrence records this write is about; one older than `prunedBefore` goes to the archive. */
  changed?: RoutineOccurrenceRecord[]
  /** Local calendar date used for the rolling window; defaults to today. */
  today?: string
  /** Called with archive problems that did not stop the carrier write. */
  onArchiveError?: (message: string) => void
}

export interface RoutineWriteResult {
  task: Task
  payload: RoutinePayload
  /** Set when pruning was skipped because the archive could not be written. */
  archiveError?: string
}

/** The server maximum: a full listing takes as few requests as possible. */
const PAGE_SIZE = 1000

function unwrap<T>(result: ApiResult<T>): T {
  if (!result.success) throw new Error(result.error)
  return result.data
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// --- Carrier creation --------------------------------------------------------------------

/** Creates a routine carrier already completed, in one request. */
export async function createRoutineCarrier(
  api: RoutineStoreApi,
  projectId: number,
  payload: RoutinePayload,
): Promise<RoutineCarrier<Task>> {
  const created = unwrap(await api.createTask(projectId, {
    title: payload.definition.name,
    description: upsertRoutineEnvelope('', payload),
    done: true,
  }))
  // A server that ignored `done` on create would leave an open, visible carrier: finish it.
  const task = created.done ? created : unwrap(await api.updateTask(created.id, taskPatch(created, { done: true })))
  return { task, payload }
}

// --- Archive parts -----------------------------------------------------------------------

async function fetchParts(api: RoutineStoreApi, fullScan: boolean): Promise<ArchivePartRef[]> {
  const tasks = unwrap(await api.fetchTasks(
    fullScan ? { filter: 'done = true', per_page: PAGE_SIZE } : { filter: 'done = true', q: ROUTINE_ARCHIVE_SEARCH, per_page: PAGE_SIZE },
  ))
  return tasks.flatMap((task) => {
    const parsed = parseRoutineArchiveEnvelope(task.description)
    return parsed.part ? [{ taskId: task.id, part: parsed.part }] : []
  })
}

/**
 * Every archive part on the server. The marker search is used first; when a routine that has
 * pruned history (`expectedRoutineIds`) shows no part in it, one full scan of the done tasks
 * double-checks before the caller concludes the archive is empty.
 */
export async function loadArchiveParts(
  api: RoutineStoreApi,
  expectedRoutineIds: string[] = [],
): Promise<ArchivePartRef[]> {
  const parts = await fetchParts(api, false)
  const missing = expectedRoutineIds.some((id) => !parts.some((ref) => ref.part.routineId === id))
  return missing ? fetchParts(api, true) : parts
}

async function applyArchiveOp(
  api: RoutineStoreApi,
  projectId: number,
  routineId: string,
  op: ArchiveOp,
): Promise<void> {
  let part = op.part
  let task: Task
  if (op.kind === 'update') {
    // Re-read the part right before writing so a concurrent append from another device is kept.
    const fresh = unwrap(await api.fetchTaskById(op.taskId))
    const current = parseRoutineArchiveEnvelope(fresh.description).part
    if (current && current.routineId === routineId) {
      part = { ...op.part, occurrences: mergeOccurrenceMaps(current.occurrences, op.part.occurrences) }
    }
    if (utf8Bytes(JSON.stringify(part)) > ROUTINE_BUDGET_BYTES) throw new Error('Routine archive part is full')
    task = unwrap(await api.updateTask(op.taskId, taskPatch(fresh, { description: encodeRoutineArchiveEnvelope(part) })))
  } else {
    const created = unwrap(await api.createTask(projectId, {
      title: ROUTINE_ARCHIVE_TITLE,
      description: encodeRoutineArchiveEnvelope(part),
      done: true,
    }))
    task = created.done ? created : unwrap(await api.updateTask(created.id, taskPatch(created, { done: true })))
  }
  // Verify what the server stored before the carrier is allowed to drop this history.
  const stored = parseRoutineArchiveEnvelope(task.description).part
  const missing = Object.keys(op.part.occurrences).filter((key) => !stored || !(key in stored.occurrences))
  if (missing.length > 0) throw new Error('Routine archive was not stored completely')
}

/** Writes `moved` occurrences to the archive: existing parts first-class, new parts as needed. */
async function writeArchive(
  api: RoutineStoreApi,
  projectId: number,
  routineId: string,
  moved: RoutineOccurrenceRecord[],
  expectParts: boolean,
): Promise<void> {
  const existing = await loadArchiveParts(api, expectParts ? [routineId] : [])
  for (const op of planArchiveWrites(routineId, existing, moved)) {
    await applyArchiveOp(api, projectId, routineId, op)
  }
}

// --- Carrier writes ----------------------------------------------------------------------

export async function writeRoutineCarrier(
  api: RoutineStoreApi,
  carrier: RoutineCarrier<Task>,
  localPayload: RoutinePayload,
  options: RoutineWriteOptions = {},
): Promise<RoutineWriteResult> {
  const today = options.today ?? localDateString()
  const routineId = localPayload.definition.id

  const readFresh = async () => {
    const fresh = unwrap(await api.fetchTaskById(carrier.task.id))
    return { fresh, parsed: parseRoutineEnvelope(fresh.description) }
  }

  let { fresh, parsed } = await readFresh()
  const merged = parsed.payload ? mergeRoutinePayload(localPayload, parsed.payload) : localPayload

  // A change to an occurrence that is already archived belongs to the archive, not the carrier.
  const late = (options.changed ?? []).filter((record) => record.scheduledDate < merged.prunedBefore)
  const current = late.length > 0
    ? { ...merged, occurrences: Object.fromEntries(Object.entries(merged.occurrences).filter(([key]) => !late.some((record) => record.key === key))) }
    : merged
  const { payload: pruned, archived } = pruneRoutinePayload(current, today)
  const toArchive = [...archived, ...late]

  let finalPayload = pruned
  let archiveError: string | undefined
  if (toArchive.length > 0) {
    try {
      await writeArchive(api, fresh.project_id, routineId, toArchive, merged.prunedBefore !== '')
      // The archive write took a while; pick up whatever another device wrote meanwhile.
      ;({ fresh, parsed } = await readFresh())
      if (parsed.payload) finalPayload = mergeRoutinePayload(pruned, parsed.payload)
    } catch (error) {
      archiveError = messageOf(error)
      console.warn('[Routines] Could not write the routine archive; keeping history in the carrier:', archiveError)
      options.onArchiveError?.(archiveError)
      // The user's change itself must not be lost; it cannot live in the carrier.
      if (late.length > 0) throw error
      finalPayload = current
    }
  }

  // Carriers are always completed, undated, non-repeating and reminder-free; only
  // what differs from the fresh server copy is sent.
  const result = await api.updateTask(fresh.id, taskPatch(fresh, {
    title: finalPayload.definition.name,
    description: upsertRoutineEnvelope(parsed.body, finalPayload),
    done: true,
    due_date: NULL_DATE,
    repeat_after: 0,
    repeat_mode: 0,
    reminders: [],
  }))
  return { task: unwrap(result), payload: finalPayload, archiveError }
}

// --- Reading history ---------------------------------------------------------------------

/** The archive parts of one routine, read on demand (History view); none when nothing was pruned. */
export async function loadRoutineArchive(
  api: RoutineStoreApi,
  carrier: RoutineCarrier<Task>,
): Promise<RoutineArchivePart[]> {
  const { definition, prunedBefore } = carrier.payload
  if (prunedBefore === '') return []
  const parts = await loadArchiveParts(api, [definition.id])
  return parts.filter((ref) => ref.part.routineId === definition.id).map((ref) => ref.part)
}

/** CSV rows for every routine, with archived history, from one archive search. */
export async function loadRoutineCsvEntries(
  api: RoutineStoreApi,
  carriers: Array<RoutineCarrier<Task>>,
): Promise<RoutineCsvEntry[]> {
  const pruned = carriers.filter((carrier) => carrier.payload.prunedBefore !== '')
  const parts = pruned.length > 0 ? await loadArchiveParts(api, pruned.map((carrier) => carrier.payload.definition.id)) : []
  return carriers.map(({ payload }) => ({
    name: payload.definition.name,
    occurrences: Object.values(readRoutineHistory(payload.definition.id, payload.occurrences, parts.map((ref) => ref.part))),
  }))
}

// --- Deleting ----------------------------------------------------------------------------

/**
 * Deletes a routine and its archive parts. The parts go first: if one cannot be deleted the
 * routine stays and the delete can be retried, instead of leaving parts nobody can reach.
 */
export async function deleteRoutine(api: RoutineStoreApi, carrier: RoutineCarrier<Task>): Promise<void> {
  const routineId = carrier.payload.definition.id
  const parts = await loadArchiveParts(api, carrier.payload.prunedBefore !== '' ? [routineId] : [])
  for (const ref of parts.filter((entry) => entry.part.routineId === routineId)) {
    unwrap(await api.deleteTask(ref.taskId))
  }
  unwrap(await api.deleteTask(carrier.task.id))
}
