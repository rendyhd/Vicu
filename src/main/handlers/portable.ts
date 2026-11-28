import {
  discardUnsyncedProLedgerChanges,
  getProLedger,
  getProLedgerStatus,
  hasUnsyncedProLedgerChanges,
  mutateProLedger,
  readProArchive,
  syncProLedger,
} from '../pro-ledger-service'
import { isProEnabled } from '../../shared/pro/settings'
import { ensurePerson } from '../pro-people'
import {
  fetchTasks,
  fetchTaskTotal,
  createTask,
  updateTask,
  patchTaskJson,
  deleteTask,
  fetchTaskById,
  createTaskRelation,
  deleteTaskRelation,
  fetchProjectsAndSavedFilters,
  fetchProjectById,
  createProject,
  updateProject,
  deleteProject,
  fetchLabels,
  addLabelToTask,
  removeLabelFromTask,
  createLabel,
  updateLabel,
  deleteLabel,
  fetchProjectViews,
  fetchViewTasks,
  updateTaskPosition,
  fetchTaskAttachments,
  uploadTaskAttachment,
  deleteTaskAttachment,
  downloadTaskAttachment,
} from '../api-client'
import { loadConfig } from '../config'
import {
  deleteCustomList,
  getCustomLists,
  discardUnsyncedCustomListChanges,
  getCustomListSyncStatus,
  hasUnsyncedCustomListChanges,
  reorderCustomLists,
  syncCustomLists,
  upsertCustomList,
} from '../custom-list-service'
import {
  discardUnsyncedPreferenceChanges,
  getSyncedPrefs,
  getSyncedPrefsStatus,
  hasUnsyncedPreferenceChanges,
  setSyncedPreference,
  setSyncedPreferences,
  syncSyncedPrefs,
} from '../synced-preferences'
import type { CustomListWire } from '../custom-list-protocol'
import {
  applySavedFilterImport,
  closeImportNotice,
  dismissSavedFilters,
  getSavedFilterState,
  previewProjectViews,
  previewSavedFilters,
  recordKnownSavedFilters,
  undoSavedFilterImport,
} from '../saved-filter-service'
import type { ImportAnswer } from '../../shared/saved-filter-import'
import type { UnsyncedDocuments } from '../../shared/config-types'
import { ensureKnownUserId } from '../known-user'
import { forgetDeletedTask, loadRoutineCarriers, rememberCreatedTask } from '../carrier-service'
import { countProjectTasks, invalidateProjectCounts } from '../project-counts-service'
import { invalidateViewerCaches } from '../quick-entry/viewer-caches'
import { parseTaskWriteOptions, sendSerially, taskWriteReply, taskWrites, writeTask, type TaskWriteDeps } from '../offline/task-writes'
import { sendTestNotification, rescheduleNotifications, refreshTaskRemindersSoon, refreshRoutineReminders } from '../notifications'
import { notificationPermission, requestNotificationPermission } from '@host/notify'
import type { Handle } from './types'

// The IPC handlers that need nothing from Electron or Node: the desktop registers them through
// `handleTrusted`, the web host through its own registry (src/web). Everything the handlers need
// from the window system comes in through `PortableDeps`.

export interface PortableDeps {
  /** The write gate's queue and how to ask for a replay (offline/task-writes.ts). */
  taskWriteDeps(): TaskWriteDeps
  /** A task changed: Quick View and its caches follow. */
  notifyViewerSync(): void
  /** A task changed: tell the main window, unless it made the change itself. */
  notifyMainWindow(excludeSenderId?: number): void
}

/** A list of saved-filter ids from the renderer: at most 500 whole numbers of 0 or more. */
function isIdList(value: unknown): value is number[] {
  return Array.isArray(value) && value.length <= 500 && value.every((id) => typeof id === 'number' && Number.isInteger(id) && id >= 0)
}

/** A row key of the import sheet: `filter:<id>` or `view:<id>`. */
function isSourceKey(value: unknown): value is string {
  return typeof value === 'string' && /^(filter|view):\d{1,12}$/.test(value)
}

/** The sheet's Import from the renderer: at most 500 keys to add and 500 answers. */
function isImportRequest(value: unknown): value is { add: string[]; answers: Array<{ key: string; answer: ImportAnswer }> } {
  if (!value || typeof value !== 'object') return false
  const { add, answers } = value as { add?: unknown; answers?: unknown }
  return Array.isArray(add) && add.length <= 500 && add.every(isSourceKey)
    && Array.isArray(answers) && answers.length <= 500
    && answers.every((entry) => !!entry && typeof entry === 'object'
      && isSourceKey((entry as { key?: unknown }).key)
      && ((entry as { answer?: unknown }).answer === 'overwrite' || (entry as { answer?: unknown }).answer === 'skip'))
}

const JSON_PATCH_OPS: ReadonlySet<string> = new Set(['test', 'replace', 'add', 'remove'])

/** A JSON Patch the renderer may send: a short list of `test`/`replace`/`add`/`remove` on top-level fields. */
function isJsonPatch(value: unknown): value is Array<{ op: string; path: string; value?: unknown }> {
  return Array.isArray(value) && value.length > 0 && value.length <= 32 && value.every((op) =>
    !!op && typeof op === 'object' && !Array.isArray(op) &&
    JSON_PATCH_OPS.has((op as { op?: unknown }).op as string) &&
    typeof (op as { path?: unknown }).path === 'string' && /^\/[a-z_]+$/.test((op as { path: string }).path))
}

/** The project of a task as the server returned it, or undefined (then every project is asked again). */
function projectIdOf(task: unknown): number | undefined {
  const id = (task as { project_id?: unknown } | null)?.project_id
  return typeof id === 'number' && Number.isInteger(id) && id > 0 ? id : undefined
}

export function registerPortableHandlers(handle: Handle, deps: PortableDeps): void {
  const { notifyViewerSync, notifyMainWindow } = deps
  const taskWriteDeps = (): TaskWriteDeps => deps.taskWriteDeps()

  // Tell Quick View to refresh after a change that went through, and pass the result on.
  function refreshViewerOnSuccess<T extends { success: boolean }>(result: T): T {
    if (result.success) notifyViewerSync()
    return result
  }

  // Tasks
  handle('fetch-tasks', (_event, params: Record<string, unknown>) => {
    return fetchTasks(params)
  })

  // The routine carriers (hidden done tasks): fetched by their remembered ids, new ones found with
  // a marker search, never by listing every done task (D-NOTIF-3, D-RT-2).
  handle('fetch-routine-carriers', () => {
    return loadRoutineCarriers()
  })

  // Hidden tasks are read and written only when the signed-in user created them (cross-app
  // semantics 10.3); the renderer's routine archive asks who that is.
  handle('account:own-user-id', async () => (await ensureKnownUserId()) ?? null)

  handle('create-task', async (_event, projectId: number, task: Record<string, unknown>) => {
    const result = await sendSerially(() => createTask(projectId, task))
    if (result.success) {
      notifyViewerSync()
      // A new routine or custom-list carrier changes what the counts subtract: everything is asked again.
      invalidateProjectCounts(rememberCreatedTask(result.data) ? undefined : projectId)
    }
    return result
  })

  // `patch` holds only the writable fields that changed (see src/shared/merge-patches.ts);
  // the API client reduces it to the PATCH schema once more before sending. Like the other task
  // writes below, it goes through the write gate: while changes for the task wait in the offline
  // queue a newer one joins the queue instead of overtaking them, and with `options.queue` a change
  // the server cannot take is queued here (see offline/task-writes.ts).
  handle('update-task', async (event, id: number, patch: Record<string, unknown>, options?: unknown) => {
    const { queue, title, completedDue, baseDescription } = parseTaskWriteOptions(options)
    const deps = taskWriteDeps()
    // A completion of a repeating task (cross-app semantics 7.5) and a notes edit with its base
    // (description format, "Notes changed in two places") read the task first.
    const spec = taskWrites.update(deps.queue, { updateTask, fetchTaskById }, id, patch, title, {
      ...(completedDue !== undefined ? { completedDue } : {}),
      ...(baseDescription !== undefined ? { baseDescription } : {}),
    })
    const outcome = await writeTask(deps, spec, { queue })
    if (outcome.kind === 'sent') {
      notifyViewerSync()
      notifyMainWindow(event.sender.id)
      // A completion, a reopening or a move changes the progress of the task's project (both
      // projects after a move, which the response does not tell: everything is asked again).
      if ('project_id' in patch) invalidateProjectCounts()
      else if ('done' in patch) invalidateProjectCounts(projectIdOf(outcome.result.data))
    }
    return taskWriteReply(outcome)
  })

  // A JSON Patch of a routine carrier or archive part (cross-app semantics 6.8): a test of the
  // description the renderer read, then the new values. It needs the server's answer (a 422 means
  // another device wrote the task since, and the renderer reads, merges and sends again), so it is
  // never queued and is refused while changes for the task wait in the queue.
  handle('patch-task-json', async (event, id: unknown, operations: unknown) => {
    if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0 || !isJsonPatch(operations)) {
      return { success: false as const, error: 'Invalid task patch' }
    }
    const deps = taskWriteDeps()
    const outcome = await writeTask(deps, {
      taskId: id,
      send: () => patchTaskJson(id, operations),
      enqueue: () => Promise.reject(new Error('A routine write is never queued')),
    })
    if (outcome.kind === 'sent') {
      notifyViewerSync()
      notifyMainWindow(event.sender.id)
      // A routine that moved between projects changes what both projects' counts subtract.
      invalidateProjectCounts(operations.some((op) => op.path === '/project_id') ? undefined : projectIdOf(outcome.result.data))
    }
    return taskWriteReply(outcome)
  })

  handle('delete-task', async (_event, id: number, options?: unknown) => {
    const { queue, title } = parseTaskWriteOptions(options)
    const deps = taskWriteDeps()
    const outcome = await writeTask(deps, taskWrites.delete(deps.queue, { deleteTask }, id, title), { queue })
    if (outcome.kind === 'sent') {
      notifyViewerSync()
      forgetDeletedTask(id)
      invalidateProjectCounts()
    }
    return taskWriteReply(outcome)
  })

  handle('fetch-task-by-id', (_event, id: number) => {
    return fetchTaskById(id)
  })

  // Relations, labels, attachments and projects all change what Quick View shows (subtasks that
  // block completing, label filters, hidden projects), so each successful change refreshes it the
  // same way a task change does (D-IPC-4).
  handle('create-task-relation', async (_event, taskId: number, otherTaskId: number, relationKind: string) => {
    return refreshViewerOnSuccess(await sendSerially(() => createTaskRelation(taskId, otherTaskId, relationKind)))
  })

  handle('delete-task-relation', async (_event, taskId: number, relationKind: string, otherTaskId: number) => {
    return refreshViewerOnSuccess(await sendSerially(() => deleteTaskRelation(taskId, relationKind, otherTaskId)))
  })

  // Sidebar progress rings: how many tasks of a project are (not) done, from one one-task page
  // (the envelope's `total`), minus the known hidden carrier tasks; cached for ten minutes.
  handle('count-project-tasks', (_event, projectId: unknown, done: unknown) => {
    if (typeof projectId !== 'number' || !Number.isInteger(projectId) || projectId <= 0 || typeof done !== 'boolean') {
      return { success: false as const, error: 'Invalid project count request' }
    }
    return countProjectTasks(projectId, done)
  })

  // How many tasks a filter matches, from one one-task page (a project's Completed row in a Work or
  // Personal mode, cross-app semantics 12.6). Not cached here: the renderer's query is.
  handle('count-tasks', (_event, filter: unknown) => {
    if (typeof filter !== 'string' || filter.trim() === '' || filter.length > 2000) {
      return { success: false as const, error: 'Invalid task count request' }
    }
    return fetchTaskTotal(filter)
  })

  // Projects
  handle('fetch-projects', async (_event, includeArchived = false) => {
    // The read also lists the saved filters (negative ids), which are kept apart and never shown
    // as projects (cross-app semantics 3.7).
    const result = await fetchProjectsAndSavedFilters(includeArchived === true)
    if (!result.success) return result
    recordKnownSavedFilters(result.data.pseudo)
    return { success: true as const, data: result.data.projects }
  })

  handle('fetch-project', (_event, id: number) => {
    return fetchProjectById(id)
  })

  // Quick View remembers the active projects and their list views for a moment; a project change
  // makes that out of date.
  handle('create-project', async (_event, project: Record<string, unknown>) => {
    const result = await createProject(project)
    if (result.success) invalidateViewerCaches()
    return refreshViewerOnSuccess(result)
  })

  handle('update-project', async (_event, id: number, project: Record<string, unknown>) => {
    const result = await updateProject(id, project)
    if (result.success) invalidateViewerCaches()
    return refreshViewerOnSuccess(result)
  })

  handle('delete-project', async (_event, id: number) => {
    const result = await deleteProject(id)
    if (result.success) invalidateViewerCaches()
    return refreshViewerOnSuccess(result)
  })

  // Labels
  handle('fetch-labels', () => {
    return fetchLabels()
  })

  handle('add-label-to-task', async (_event, taskId: number, labelId: number, options?: unknown) => {
    const { queue, title, labelTitle } = parseTaskWriteOptions(options)
    const deps = taskWriteDeps()
    const label = labelTitle ? { id: labelId, title: labelTitle } : { id: labelId }
    const outcome = await writeTask(deps, taskWrites.addLabel(deps.queue, { addLabelToTask }, taskId, label, title), { queue })
    if (outcome.kind === 'sent') notifyViewerSync()
    return taskWriteReply(outcome)
  })

  handle('remove-label-from-task', async (_event, taskId: number, labelId: number, options?: unknown) => {
    const { queue, title } = parseTaskWriteOptions(options)
    const deps = taskWriteDeps()
    const outcome = await writeTask(deps, taskWrites.removeLabel(deps.queue, { removeLabelFromTask }, taskId, labelId, title), { queue })
    if (outcome.kind === 'sent') notifyViewerSync()
    return taskWriteReply(outcome)
  })

  handle('create-label', async (_event, label: Record<string, unknown>) => {
    return refreshViewerOnSuccess(await createLabel(label))
  })

  handle('update-label', async (_event, id: number, label: Record<string, unknown>) => {
    return refreshViewerOnSuccess(await updateLabel(id, label))
  })

  handle('delete-label', async (_event, id: number) => {
    return refreshViewerOnSuccess(await deleteLabel(id))
  })

  // Project Views
  handle('fetch-project-views', (_event, projectId: number) => {
    return fetchProjectViews(projectId)
  })

  handle('fetch-view-tasks', (_event, projectId: number, viewId: number, params: Record<string, unknown>) => {
    return fetchViewTasks(projectId, viewId, params)
  })

  handle('update-task-position', (_event, taskId: number, viewId: number, position: number) => {
    return sendSerially(() => updateTaskPosition(taskId, viewId, position))
  })

  handle('custom-lists:get', () => getCustomLists())
  handle('custom-lists:upsert', (_event, list: CustomListWire) => upsertCustomList(list))
  handle('custom-lists:delete', (_event, id: string) => deleteCustomList(id))
  handle('custom-lists:reorder', (_event, ids: string[]) => reorderCustomLists(ids))
  handle('custom-lists:sync', () => {
    // The synced preferences and the Pro ledger (while Pro is on) sync whenever custom lists do.
    void syncSyncedPrefs()
    void syncProLedger()
    return syncCustomLists()
  })
  handle('custom-lists:status', () => getCustomListSyncStatus())

  // Vikunja saved filters as custom lists (cross-app semantics 3.7).
  handle('saved-filters:state', () => getSavedFilterState())
  handle('saved-filters:preview', (_event, ids: unknown) => {
    if (ids !== undefined && !isIdList(ids)) return null
    return previewSavedFilters(ids as number[] | undefined)
  })
  handle('saved-filters:preview-views', () => previewProjectViews())
  handle('saved-filters:apply', (_event, request: unknown) =>
    (isImportRequest(request) ? applySavedFilterImport(request.add, request.answers) : null))
  handle('saved-filters:undo', (_event, undoId: unknown) =>
    (typeof undoId === 'string' && undoId !== '' ? undoSavedFilterImport(undoId) : false))
  handle('saved-filters:dismiss', (_event, ids: unknown, changed: unknown) =>
    (isIdList(ids) && (changed === undefined || isIdList(changed)) ? dismissSavedFilters(ids, changed ?? []) : getSavedFilterState()))
  handle('saved-filters:close-notice', (_event, listId: unknown) =>
    (typeof listId === 'string' && listId !== '' ? closeImportNotice(listId) : getSavedFilterState()))

  // Synced preferences (cross-app semantics section 11): the Inbox and the task order.
  handle('synced-prefs:get', () => getSyncedPrefs())
  handle('synced-prefs:set', (_event, key: unknown, value: unknown) => {
    if (typeof key !== 'string') throw new Error('Invalid synced preference')
    return setSyncedPreference(key, value)
  })
  handle('synced-prefs:set-many', (_event, values: unknown) => {
    if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('Invalid synced preferences')
    return setSyncedPreferences(values as Record<string, unknown>)
  })
  handle('synced-prefs:sync', () => syncSyncedPrefs())
  handle('synced-prefs:status', () => getSyncedPrefsStatus())

  // Custom-list and settings changes that have not reached the server (they are not in the offline
  // queue). The sync panel shows them and can discard them: each goes back to the server's copy.
  handle('synced-documents:unsynced', (): UnsyncedDocuments => ({
    customLists: hasUnsyncedCustomListChanges() ? getCustomListSyncStatus() : null,
    preferences: hasUnsyncedPreferenceChanges() ? getSyncedPrefsStatus() : null,
    proLedger: hasUnsyncedProLedgerChanges() ? getProLedgerStatus() : null,
  }))
  handle('synced-documents:discard', () => ({
    customLists: discardUnsyncedCustomListChanges(),
    preferences: discardUnsyncedPreferenceChanges(),
    proLedger: discardUnsyncedProLedgerChanges(),
  }))

  // The Pro ledger (cross-app semantics 21.7): read, change (main applies the operations to its
  // current copy), sync, and the archive parts on demand.
  handle('pro-ledger:get', () => getProLedger())
  handle('pro-ledger:mutate', (_event, operations: unknown) => mutateProLedger(operations))
  handle('pro-ledger:sync', () => syncProLedger())
  handle('pro-ledger:status', () => getProLedgerStatus())
  handle('pro-ledger:archive', () => readProArchive())
  // `$Lalith` in quick add (21.5): the label with that name becomes a person, or one is made.
  handle('pro:ensure-person', async (_event, name: unknown) => {
    const config = loadConfig()
    if (!isProEnabled(config, 'promises') || config?.standalone_mode) return { success: false, error: 'Pro promises are off' }
    return refreshViewerOnSuccess(await ensurePerson(name, { fetchLabels, createLabel, setPrefs: setSyncedPreferences }))
  })

  // --- Attachments IPC ---
  handle('fetch-task-attachments', (_event, taskId: number) => {
    return fetchTaskAttachments(taskId)
  })

  handle('upload-task-attachment', async (_event, taskId: number, fileData: Uint8Array, fileName: string, mimeType: string, options?: unknown) => {
    const { queue, title } = parseTaskWriteOptions(options)
    if (!queue) return refreshViewerOnSuccess(await uploadTaskAttachment(taskId, fileData, fileName, mimeType))
    // The editor's drop and paste: offline, the file waits in the queue (issue 104).
    const inline = !!options && typeof options === 'object' && (options as { inline?: unknown }).inline === true
    const deps = taskWriteDeps()
    const outcome = await writeTask(
      deps,
      taskWrites.upload(deps.queue, { uploadTaskAttachment }, taskId, { bytes: fileData, name: fileName, mime: mimeType }, { inline, title }),
      { queue: true }
    )
    return outcome.kind === 'sent' ? refreshViewerOnSuccess(outcome.result) : taskWriteReply(outcome)
  })

  handle('delete-task-attachment', async (_event, taskId: number, attachmentId: number) => {
    return refreshViewerOnSuccess(await deleteTaskAttachment(taskId, attachmentId))
  })

  handle('fetch-task-attachment-bytes', async (_event, taskId: number, attachmentId: number, size?: unknown) => {
    // Inline task-note images only need a bounded preview. Fetching full-size
    // phone photos here can exhaust the renderer/IPC budget before <img> decodes.
    // The image viewer asks for the original of the one image it shows.
    const original = size === 'original'
    const result = await downloadTaskAttachment(taskId, attachmentId, original ? undefined : 'lg')
    if (!result.success) return result
    if (result.data.length === 0) {
      return { success: false, error: original ? 'Attachment was empty' : 'Attachment preview was empty' }
    }
    return { success: true, data: new Uint8Array(result.data) }
  })

  // --- Notifications ---
  handle('notifications:test', () => {
    sendTestNotification()
  })

  handle('notifications:reschedule', () => {
    rescheduleNotifications()
  })

  // Every completed, deleted or edited task asks for this; a bulk change asks many times in a row,
  // so main waits for a quiet second and refreshes once.
  handle('notifications:refresh-task-reminders', () => {
    refreshTaskRemindersSoon()
  })

  handle('notifications:refresh-routine-reminders', () => {
    refreshRoutineReminders()
  })

  // Whether the host may show notifications (the desktop always may) and asking the user.
  handle('notifications:permission', () => notificationPermission())
  handle('notifications:request-permission', () => requestNotificationPermission())
}
