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
 *
 * Every write of an existing carrier or archive part is a JSON Patch that first tests the
 * description it read (cross-app semantics 6.8): when another device or person wrote it in between,
 * Vikunja applies nothing and answers 422, and the write reads, merges and sends again. Vikunja
 * checks the test and stores the result in two steps, so two writes that arrive at the same moment
 * can both pass it and the later one then removes what the earlier one wrote (on an SQLite server
 * one of them fails with a 500 instead). So a write that went through waits, reads the carrier back
 * and writes the merge again when something it sent is missing, and a 5xx is tried again like a
 * 422; at most `ROUTINE_WRITE_ATTEMPTS` writes. Two people ticking a shared routine at once both
 * count.
 */
import { taskPatch } from './merge-patches'
import { parseTaskDuration, withTaskDuration } from './task-duration'
import { isBrokenSearch } from '../../shared/error-classify'
import { isOwnTask } from '../../shared/hidden-tasks'
import {
  ROUTINE_ARCHIVE_SEARCH,
  ROUTINE_ARCHIVE_TITLE,
  ROUTINE_BUDGET_BYTES,
  ROUTINE_REASSERT_DAYS,
  ROUTINE_SERVER_ERROR_DELAY_MS,
  ROUTINE_VERIFY_DELAY_MS,
  ROUTINE_WRITE_ATTEMPTS,
  archivePartReadable,
  archiveWriteOperations,
  carrierWriteOperations,
  encodeRoutineArchiveEnvelope,
  isSharedRoutine,
  keepServerRecordsOfSameState,
  lostOwnRoutineChanges,
  localDateString,
  mergeOccurrenceMaps,
  mergeRoutinePayload,
  occurrencesHeld,
  parseRoutineArchiveEnvelope,
  parseRoutineEnvelope,
  planArchiveWrites,
  pruneRoutinePayload,
  readRoutineHistory,
  routineWriteHeld,
  upsertRoutineEnvelope,
  utf8Bytes,
  type ArchiveOp,
  type ArchivePartRef,
  type JsonPatchOperation,
  type RoutineArchivePart,
  type RoutineCarrier,
  type RoutineCsvEntry,
  type RoutineOccurrenceRecord,
  type RoutinePayload,
} from './routines'
import type { ApiResult, CreateTaskPayload, Task, TaskQueryParams, UpdateTaskPayload } from './vikunja-types'

/** The slice of the task API the routine store needs. */
export interface RoutineStoreApi {
  /** The signed-in user's id; archive parts are read, written and deleted only when they are this user's. */
  ownUserId(): Promise<number | null>
  /** A failure the server answered carries its `statusCode` (`isBrokenSearch`). */
  fetchTasks(params: TaskQueryParams): Promise<ApiResult<Task[]> & { statusCode?: number }>
  fetchTaskById(id: number): Promise<ApiResult<Task>>
  createTask(projectId: number, task: CreateTaskPayload): Promise<ApiResult<Task>>
  updateTask(id: number, patch: UpdateTaskPayload): Promise<ApiResult<Task>>
  /** A JSON Patch; a failed `test` answers `statusCode` 422 (cross-app semantics 6.8). */
  patchTaskJson(id: number, operations: ReadonlyArray<JsonPatchOperation>): Promise<ApiResult<Task> & { statusCode?: number }>
  deleteTask(id: number): Promise<ApiResult<void>>
  /** Waits; the read-back of a write (section 6.8) waits a moment first. Tests pass one that does not. */
  sleep?(ms: number): Promise<void>
}

function pause(api: RoutineStoreApi, ms: number): Promise<void> {
  return api.sleep ? api.sleep(ms) : new Promise((resolve) => setTimeout(resolve, ms))
}

/** The routines whose archive parts a read may use, by id, with whether each is shared (section 6.9). */
export type RoutineReadSet = ReadonlyMap<string, { shared: boolean }>

/** The read set of some carriers. */
export function routineReadSet(carriers: ReadonlyArray<{ payload: RoutinePayload }>): RoutineReadSet {
  return new Map(carriers.map(({ payload }) => [payload.definition.id, { shared: isSharedRoutine(payload) }]))
}

export interface RoutineWriteOptions {
  /** The occurrence records this write is about; one older than `prunedBefore` goes to the archive. */
  changed?: RoutineOccurrenceRecord[]
  /** Set or clear duration on the carrier description; omitted preserves the fresh server value. */
  durationMinutes?: number | null
  /** Move the carrier to this project in the same write (sharing, stopping, section 6.9). */
  moveToProject?: number
  /**
   * Applied to every merged payload before it is sent (sharing sets the flag here, on the server's
   * definition, so an edit another member made since this app loaded the routine is not undone).
   */
  change?: (merged: RoutinePayload) => RoutinePayload
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

/** Said when every attempt of a carrier write met a newer copy (section 6.8). */
export const ROUTINE_KEPT_CHANGING_ERROR = 'This routine kept changing on the server while it was being saved. Try again.'

/** A JSON Patch whose test failed: the task changed since it was read. */
function isConflict(result: { success: boolean; statusCode?: number }): boolean {
  return !result.success && result.statusCode === 422
}

/** A carrier write to send again after reading again: refused by the test (422), or a busy server (5xx). */
function isRetryable(result: { success: boolean; statusCode?: number }): boolean {
  return isConflict(result) || (!result.success && (result.statusCode ?? 0) >= 500)
}

/** Waits before the next try: a moment before the read-back, a little longer after a 5xx. */
async function afterWrite(api: RoutineStoreApi, result: { success: boolean; statusCode?: number }, writes: number): Promise<void> {
  if (result.success) await pause(api, ROUTINE_VERIFY_DELAY_MS)
  else if ((result.statusCode ?? 0) >= 500) await pause(api, ROUTINE_SERVER_ERROR_DELAY_MS * writes)
}

// --- Carrier creation --------------------------------------------------------------------

/** Creates a routine carrier already completed, in one request. */
export async function createRoutineCarrier(
  api: RoutineStoreApi,
  projectId: number,
  payload: RoutinePayload,
  durationMinutes: number | null = null,
): Promise<RoutineCarrier<Task>> {
  const created = unwrap(await api.createTask(projectId, {
    title: payload.definition.name,
    description: withTaskDuration(upsertRoutineEnvelope('', payload), durationMinutes),
    done: true,
  }))
  // A server that ignored `done` on create would leave an open, visible carrier: finish it.
  const task = created.done ? created : unwrap(await api.updateTask(created.id, taskPatch(created, { done: true })))
  return { task, payload }
}

// --- Archive parts -----------------------------------------------------------------------

/** The archive parts of a listing, and whether that listing was every done task. */
async function fetchParts(
  api: RoutineStoreApi,
  fullScan: boolean,
  routines?: RoutineReadSet,
): Promise<{ parts: ArchivePartRef[]; scanned: boolean }> {
  const me = await api.ownUserId()
  // Until the app knows who is signed in it cannot tell its own parts from someone else's in a
  // shared project (cross-app semantics 10.3), and a write must not guess.
  if (!me) throw new Error('Vicu could not confirm the signed-in account; try again when connected')
  const scan = { filter: 'done = true', per_page: PAGE_SIZE }
  // The search has no done filter: a part someone reopened in the web UI is still a part (10.4).
  const listing = await api.fetchTasks(fullScan ? scan : { q: ROUTINE_ARCHIVE_SEARCH, per_page: PAGE_SIZE })
  // The server answered the search with an error: the scan finds the parts without it.
  const brokenSearch = !fullScan && !listing.success && isBrokenSearch(listing)
  const tasks = unwrap(brokenSearch ? await api.fetchTasks(scan) : listing)
  const parts = tasks.flatMap((task) => {
    const parsed = parseRoutineArchiveEnvelope(task.description)
    if (!parsed.part) return []
    // Without a read set: the user's own parts. With one (section 6.9): every part of those
    // routines, whoever wrote it.
    const counts = routines
      ? archivePartReadable(parsed.part.routineId, me, routines)
      : isOwnTask(task, me)
    return counts ? [{ taskId: task.id, part: parsed.part }] : []
  })
  return { parts, scanned: fullScan || brokenSearch }
}

/**
 * Every archive part on the server. The marker search is used first; when a routine that has
 * pruned history (`expectedRoutineIds`) shows no part in it, one full scan of the done tasks
 * double-checks before the caller concludes the archive is empty. A search the server answers
 * with an error is replaced by that scan.
 */
export async function loadArchiveParts(
  api: RoutineStoreApi,
  expectedRoutineIds: string[] = [],
  routines?: RoutineReadSet,
): Promise<ArchivePartRef[]> {
  const { parts, scanned } = await fetchParts(api, false, routines)
  const missing = !scanned && expectedRoutineIds.some((id) => !parts.some((ref) => ref.part.routineId === id))
  return missing ? (await fetchParts(api, true, routines)).parts : parts
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
    let writes = 0
    let sent = false
    for (;;) {
      // Re-read the part right before writing so a concurrent append from another device is kept;
      // the write tests that it is still what was read (section 6.8). After a write the part is
      // read back once more: when it holds the records the write is done.
      const fresh = unwrap(await api.fetchTaskById(op.taskId))
      const current = parseRoutineArchiveEnvelope(fresh.description).part
      part = op.part
      if (current && current.routineId === routineId) {
        // The server's copy keeps its unknown fields (contract 10.8).
        part = { ...op.part, ...current, occurrences: mergeOccurrenceMaps(current.occurrences, op.part.occurrences) }
      } else if (!current) {
        throw new Error(parseRoutineArchiveEnvelope(fresh.description).updateRequired
          ? 'A newer version of Vicu wrote this routine history; update Vicu to change it'
          : 'Routine archive part cannot be read')
      }
      if (current && sent && occurrencesHeld(current.occurrences, op.part.occurrences)) {
        task = fresh
        break
      }
      if (writes >= ROUTINE_WRITE_ATTEMPTS) throw new Error(ROUTINE_KEPT_CHANGING_ERROR)
      writes += 1
      if (utf8Bytes(JSON.stringify(part)) > ROUTINE_BUDGET_BYTES) throw new Error('Routine archive part is full')
      const result = await api.patchTaskJson(op.taskId, archiveWriteOperations(fresh.description ?? '', encodeRoutineArchiveEnvelope(part)))
      if (!result.success && !isRetryable(result)) unwrap(result)
      if (result.success) sent = true
      await afterWrite(api, result, writes)
    }
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
  shared = false,
): Promise<void> {
  const existing = await loadArchiveParts(api, expectParts ? [routineId] : [], new Map([[routineId, { shared }]]))
  for (const op of planArchiveWrites(routineId, existing, moved)) {
    await applyArchiveOp(api, projectId, routineId, op)
  }
}

// --- Carrier writes ----------------------------------------------------------------------

/** The carrier changed into something this app must not write over; nothing was sent. */
class UnreadableCarrierError extends Error {}

/** Why a carrier cannot be written: "update required" for a newer version, else damaged. */
export function unreadableCarrierMessage(parsed: { updateRequired?: boolean; error?: string }): string {
  return parsed.updateRequired
    ? 'A newer version of Vicu changed this routine. Update Vicu to change it here.'
    : `This routine's record cannot be read${parsed.error ? ` (${parsed.error})` : ''}, so it was not changed.`
}

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
    const parsed = parseRoutineEnvelope(fresh.description)
    // Never write over a carrier this app cannot read: a newer version wrote it, or it was damaged
    // since it was loaded (cross-app semantics 10.7). The local change stays unsent.
    if (!parsed.payload) throw new UnreadableCarrierError(unreadableCarrierMessage(parsed))
    return { fresh, parsed, remote: parsed.payload }
  }
  /** The merge a write sends: section 6.3, then "same state, first record kept" (section 6.8). */
  const change = options.change ?? ((payload: RoutinePayload) => payload)
  const mergeForWrite = (local: RoutinePayload, remote: RoutinePayload) =>
    change(keepServerRecordsOfSameState(mergeRoutinePayload(local, remote), remote))

  let { fresh, parsed, remote } = await readFresh()
  const merged = mergeForWrite(localPayload, remote)

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
      await writeArchive(api, fresh.project_id, routineId, toArchive, merged.prunedBefore !== '', isSharedRoutine(merged))
      // The archive write took a while; pick up whatever another device wrote meanwhile.
      ;({ fresh, parsed, remote } = await readFresh())
      finalPayload = mergeForWrite(pruned, remote)
    } catch (error) {
      if (error instanceof UnreadableCarrierError) throw error
      archiveError = messageOf(error)
      console.warn('[Routines] Could not write the routine archive; keeping history in the carrier:', archiveError)
      options.onArchiveError?.(archiveError)
      // The user's change itself must not be lost; it cannot live in the carrier.
      if (late.length > 0) throw error
      finalPayload = current
    }
  }

  // Carriers are always completed, undated, non-repeating and reminder-free (section 10.2). The
  // write tests that the description is still the one read (section 6.8); when another device or
  // person wrote the carrier in between, read it again, merge and send again. A write that went
  // through is read back: when the carrier no longer holds what was sent, a write made at the same
  // moment removed it, and the merge is sent again.
  let sent: RoutinePayload | null = null
  for (let writes = 1; ; writes += 1) {
    const result = await api.patchTaskJson(fresh.id, carrierWriteOperations(
      fresh.description ?? '',
      finalPayload.definition.name,
      options.durationMinutes === undefined
        ? upsertRoutineEnvelope(parsed.body, finalPayload)
        : withTaskDuration(upsertRoutineEnvelope(parsed.body, finalPayload), options.durationMinutes),
      { projectId: options.moveToProject },
    ))
    if (!result.success && !isRetryable(result)) unwrap(result)
    if (result.success) sent = finalPayload
    await afterWrite(api, result, writes)
    ;({ fresh, parsed, remote } = await readFresh())
    const durationHeld = options.durationMinutes === undefined || parseTaskDuration(fresh.description) === options.durationMinutes
    if (sent && routineWriteHeld(remote, sent) && durationHeld) return { task: fresh, payload: remote, archiveError }
    if (sent) console.warn('[Routines] A write made at the same moment removed part of this one; writing again')
    if (writes >= ROUTINE_WRITE_ATTEMPTS) throw new Error(ROUTINE_KEPT_CHANGING_ERROR)
    finalPayload = sent ? keepServerRecordsOfSameState(mergeRoutinePayload(sent, remote), remote) : mergeForWrite(finalPayload, remote)
  }
}

/**
 * A carrier the server sends back without this device's recent changes, which `known` (the copy it
 * last wrote or read) still has, lost them to a write made at the same moment (section 6.8). They are
 * written again, merged with the server's copy; returns the carrier as written, or as read when
 * nothing was lost. A write that fails leaves the carrier as read and throws.
 */
export async function writeLostRoutineChanges(
  api: RoutineStoreApi,
  carrier: RoutineCarrier<Task>,
  known: RoutinePayload | undefined,
  deviceId: string,
  now = new Date(),
): Promise<RoutineCarrier<Task>> {
  if (!known) return carrier
  const since = new Date(now.getTime() - ROUTINE_REASSERT_DAYS * 24 * 60 * 60 * 1000)
  const lost = lostOwnRoutineChanges(known, carrier.payload, deviceId, since)
  if (!lost) return carrier
  console.warn('[Routines] The server lost changes of this device; writing them again')
  const { task, payload } = await writeRoutineCarrier(api, carrier, lost)
  return { task, payload }
}

// --- Sharing (section 6.9) -----------------------------------------------------------------

/** Moves the archive parts of a routine to a project (a merge patch with `project_id` each). */
async function moveArchiveParts(
  api: RoutineStoreApi,
  carrier: RoutineCarrier<Task>,
  projectId: number,
): Promise<void> {
  if (carrier.payload.prunedBefore === '') return
  const routineId = carrier.payload.definition.id
  // Anybody's parts of this routine: a member may have archived history while it was shared.
  const parts = await loadArchiveParts(api, [routineId], new Map([[routineId, { shared: true }]]))
  for (const ref of parts.filter((entry) => entry.part.routineId === routineId)) {
    unwrap(await api.updateTask(ref.taskId, { project_id: projectId }))
  }
}

/** The definition with `shared` set, stamped as this device's edit. */
function withShared(payload: RoutinePayload, shared: boolean, deviceId: string, now = new Date().toISOString()): RoutinePayload {
  const definition = { ...payload.definition, updatedAt: now, updatedBy: deviceId }
  if (shared) definition.shared = true
  else delete definition.shared
  return { ...payload, definition }
}

/**
 * Shares a routine through `projectId` (section 6.9; the owner, online): the archive parts move
 * first, then one carrier write sets the flag and moves the carrier. Moving a shared routine to
 * another project is the same call.
 */
export async function shareRoutine(
  api: RoutineStoreApi,
  carrier: RoutineCarrier<Task>,
  projectId: number,
  deviceId: string,
): Promise<RoutineWriteResult> {
  await moveArchiveParts(api, carrier, projectId)
  return writeRoutineCarrier(api, carrier, carrier.payload, {
    moveToProject: projectId,
    change: (merged) => withShared(merged, true, deviceId),
  })
}

/**
 * Stops sharing (section 6.9): one carrier write clears the flag and moves the carrier to the
 * owner's Inbox, then the archive parts follow.
 */
export async function stopSharingRoutine(
  api: RoutineStoreApi,
  carrier: RoutineCarrier<Task>,
  inboxProjectId: number,
  deviceId: string,
): Promise<RoutineWriteResult> {
  const result = await writeRoutineCarrier(api, carrier, carrier.payload, {
    moveToProject: inboxProjectId,
    change: (merged) => withShared(merged, false, deviceId),
  })
  await moveArchiveParts(api, { task: result.task, payload: result.payload }, inboxProjectId)
  return result
}

// --- Reading history ---------------------------------------------------------------------

/** The archive parts of one routine, read on demand (History view); none when nothing was pruned. */
export async function loadRoutineArchive(
  api: RoutineStoreApi,
  carrier: RoutineCarrier<Task>,
): Promise<RoutineArchivePart[]> {
  const { definition, prunedBefore } = carrier.payload
  if (prunedBefore === '') return []
  const parts = await loadArchiveParts(api, [definition.id], routineReadSet([carrier]))
  return parts.filter((ref) => ref.part.routineId === definition.id).map((ref) => ref.part)
}

/** CSV rows for every routine, with archived history, from one archive search. */
export async function loadRoutineCsvEntries(
  api: RoutineStoreApi,
  carriers: Array<RoutineCarrier<Task>>,
): Promise<RoutineCsvEntry[]> {
  const pruned = carriers.filter((carrier) => carrier.payload.prunedBefore !== '')
  const parts = pruned.length > 0 ? await loadArchiveParts(api, pruned.map((carrier) => carrier.payload.definition.id), routineReadSet(carriers)) : []
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
  const parts = await loadArchiveParts(api, carrier.payload.prunedBefore !== '' ? [routineId] : [], routineReadSet([carrier]))
  for (const ref of parts.filter((entry) => entry.part.routineId === routineId)) {
    unwrap(await api.deleteTask(ref.taskId))
  }
  unwrap(await api.deleteTask(carrier.task.id))
}
