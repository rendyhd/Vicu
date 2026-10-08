import { shell, dialog, app, nativeTheme } from 'electron'
import { handleTrusted } from './secure-ipc'
import { tokenForConnectionTest } from './connection-test-token'
import { isExternalAllowed } from './web-security-policy'
import { isRiskyAttachment, sanitizeAttachmentFileName } from './attachment-safety'
import { ensureAttachmentTempDir } from './attachment-temp'
import * as fs from 'fs'
import * as path from 'path'
import {
  fetchTasks,
  createTask,
  updateTask,
  deleteTask,
  fetchTaskById,
  createTaskRelation,
  deleteTaskRelation,
  fetchProjects,
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
  testConnection,
  fetchProjectViews,
  fetchViewTasks,
  updateTaskPosition,
  fetchTaskAttachments,
  uploadTaskAttachment,
  checkUploadSize as checkSize,
  deleteTaskAttachment,
  downloadTaskAttachment,
} from './api-client'
import { loadFileForUpload } from './upload-file'
import { getLaunchOnStartupSupport } from './launch-on-startup'
import { startupEnv } from './startup-env'
import { announceDateFormatIfChanged, dateFormatForWindow } from './date-format'
import {
  applyConfigPatch,
  applyConnectionFields,
  connectionKeysIn,
  isConnectionFields,
  loadConfig,
  saveConfig,
  type AppConfig,
} from './config'
import { directoryFromSelectedFile, resolveDialogDefaultPath } from './dialog-path'
import {
  deleteCustomList,
  getCustomLists,
  getCustomListSyncStatus,
  reorderCustomLists,
  syncCustomLists,
  upsertCustomList,
} from './custom-list-service'
import type { CustomListWire } from './custom-list-protocol'
import { hasVicuMetadataMarker } from './custom-list-protocol'
import { discoverProviders, discoverAuthMethods } from './auth/oidc-discovery'
import { fetchCurrentUser } from './auth/user-info'
import { authManager } from './auth/auth-manager'
import { OidcTotpRequiredError } from './auth/oidc-login'
import { buildViewerFilterParams } from './quick-entry/filter-builder'
import { forgetDeletedTask, loadRoutineCarriers, rememberCreatedTask } from './carrier-service'
import { dueToday } from '../shared/due-dates'
import { KEEP_NESTED_SUBTASKS_PARAM } from './api-v2'
import { fetchPositionSortedTasks } from './quick-entry/position-sort'
import { activeProjects, invalidateViewerCaches, projectListViewIds } from './quick-entry/viewer-caches'
import { cachedFallback } from './quick-entry/fetch-fallback'
import { resolveViewerFilter, selectQuickViewTasks } from './quick-entry/viewer-filter'
import {
  hideQuickEntry,
  hideQuickView,
  setQuickEntryHeight,
  setViewerHeight,
  getMainWindow,
  getQuickEntryWindow,
  getQuickViewWindow,
  applyQuickEntrySettings,
  getLastShortcutStatus,
} from './quick-entry-state'
import { getAPIToken, getSecretStorageStatus, storeAPIToken, API_TOKEN_NO_EXPIRY } from './auth/token-store'
import { sendTestNotification, rescheduleNotifications, refreshTaskRemindersSoon, refreshRoutineReminders } from './notifications'
import { setTaskBadge, clearTaskBadge } from './badge'
import { resolveShownObsidianLink, testObsidianConnection } from './obsidian-client'
import { isRegistered, registerHosts } from './browser-host-registration'
import { checkForUpdates, getCachedUpdateStatus } from './update-checker'
import {
  pickAndCopySoundFile,
  resetSoundToDefault,
  readSoundBytes,
  getSoundInfo,
} from './sound'

import { printHtml } from './print'
import { uploadStandaloneTasks } from './standalone-upload'
import { getOfflineQueue, rememberKnownUser } from './offline/service'
import { registerOfflineQueueIpc } from './offline/ipc'
import { accountChanged, replayPendingActions } from './sync'
import {
  createFromQuickEntry,
  queueQuickEntryFollowUps,
  quickViewComplete,
  quickViewPatch,
  quickViewReopen,
  type QuickActionDeps,
} from './offline/quick-actions'
import { parseTaskWriteOptions, taskWriteReply, taskWrites, writeTask } from './offline/task-writes'
import {
  setCachedTasks,
  getCachedTasks,
  isAuthError,
  addStandaloneTask,
  getStandaloneTasks,
  getAllStandaloneTasks,
  markStandaloneTaskDone,
  markStandaloneTaskUndone,
  scheduleStandaloneTaskToday,
  removeStandaloneTaskDueDate,
  updateStandaloneTask,
  clearStandaloneTasks,
  removeStandaloneTask,
} from './cache'

/** A write that got through, or joined a waiting queue, asks for a replay; bursts of them ask once. */
const REPLAY_REQUEST_MIN_INTERVAL_MS = 5_000
let lastReplayRequestAt = 0
function requestReplay(): void {
  const now = Date.now()
  if (now - lastReplayRequestAt < REPLAY_REQUEST_MIN_INTERVAL_MS) return
  lastReplayRequestAt = now
  void replayPendingActions()
}

/** What the Quick Entry / Quick View handlers need: the queue, the API client and a way to refresh the main window. */
function quickActionDeps(): QuickActionDeps {
  return {
    queue: getOfflineQueue(),
    api: { createTask, updateTask },
    notifyMainWindow: () => notifyMainWindow(),
    requestReplay,
  }
}

/** Every change to an existing task goes through the write gate (see offline/task-writes.ts). */
function taskWriteDeps() {
  return { queue: getOfflineQueue(), requestReplay }
}

// Config keys that only record UI state. Changing just these needs no badge refresh,
// Quick View refresh or custom list sync.
const QUIET_PATCH_KEYS: ReadonlySet<string> = new Set([
  'sidebar_width',
  'window_bounds',
  'last_used_project_id',
  'last_used_label_id',
  'last_file_dialog_directory',
  'update_check_dismissed_version',
  'quick_entry_position',
  'quick_view_position',
])

// Shared tail of every renderer-driven config write: keep the API token out of
// config.json, save, then (unless `announce` is false) tell the rest of the app.
function persistConfig(config: AppConfig, announce = true): void {
  // The API token goes to the token store (encrypted when the OS allows it), not config.json
  if (config.auth_method === 'api_token' && config.api_token) {
    storeAPIToken(config.api_token, API_TOKEN_NO_EXPIRY)
    config.api_token = ''
  }
  saveConfig(config)
  // The clock choice changes how every window phrases dates.
  announceDateFormatIfChanged(config)
  // Sync native theme when config changes
  if (config.theme) {
    nativeTheme.themeSource = config.theme === 'system' ? 'system' : config.theme
  }
  if (!announce) return
  // If the task badge was just turned off, clear it right away so the
  // dock/taskbar icon updates without waiting for the renderer to push.
  if (config.show_today_overdue_badge !== true) {
    clearTaskBadge()
  }
  // Tell the Quick View renderer to drop its 30s task cache so the next
  // show reflects the updated viewer_filter instead of stale data.
  const viewerWindow = getQuickViewWindow()
  if (viewerWindow && !viewerWindow.isDestroyed()) {
    viewerWindow.webContents.send('viewer-config-changed')
  }
  if (config.custom_lists?.length || config.custom_lists_sync?.dirty) void syncCustomLists()
}

export function registerIpcHandlers(): void {
  registerOfflineQueueIpc()

  // Tasks
  handleTrusted('fetch-tasks', (_event, params: Record<string, unknown>) => {
    return fetchTasks(params)
  })

  // The routine carriers (hidden done tasks): fetched by their remembered ids, new ones found with
  // a marker search, never by listing every done task (D-NOTIF-3, D-RT-2).
  handleTrusted('fetch-routine-carriers', () => {
    return loadRoutineCarriers()
  })

  handleTrusted('create-task', async (_event, projectId: number, task: Record<string, unknown>) => {
    const result = await createTask(projectId, task)
    if (result.success) {
      notifyViewerSync()
      rememberCreatedTask(result.data)
    }
    return result
  })

  // `patch` holds only the writable fields that changed (see src/shared/merge-patches.ts);
  // the API client reduces it to the PATCH schema once more before sending. Like the other task
  // writes below, it goes through the write gate: while changes for the task wait in the offline
  // queue a newer one joins the queue instead of overtaking them, and with `options.queue` a change
  // the server cannot take is queued here (see offline/task-writes.ts).
  handleTrusted('update-task', async (event, id: number, patch: Record<string, unknown>, options?: unknown) => {
    const { queue, title } = parseTaskWriteOptions(options)
    const deps = taskWriteDeps()
    const outcome = await writeTask(deps, taskWrites.update(deps.queue, { updateTask }, id, patch, title), { queue })
    if (outcome.kind === 'sent') {
      notifyViewerSync()
      notifyMainWindow(event.sender.id)
    }
    return taskWriteReply(outcome)
  })

  handleTrusted('delete-task', async (_event, id: number, options?: unknown) => {
    const { queue, title } = parseTaskWriteOptions(options)
    const deps = taskWriteDeps()
    const outcome = await writeTask(deps, taskWrites.delete(deps.queue, { deleteTask }, id, title), { queue })
    if (outcome.kind === 'sent') {
      notifyViewerSync()
      forgetDeletedTask(id)
    }
    return taskWriteReply(outcome)
  })

  handleTrusted('fetch-task-by-id', (_event, id: number) => {
    return fetchTaskById(id)
  })

  // Print
  handleTrusted('print-html', (_event, html: string) => printHtml(html))

  // Relations, labels, attachments and projects all change what Quick View shows (subtasks that
  // block completing, label filters, hidden projects), so each successful change refreshes it the
  // same way a task change does (D-IPC-4).
  handleTrusted('create-task-relation', async (_event, taskId: number, otherTaskId: number, relationKind: string) => {
    return refreshViewerOnSuccess(await createTaskRelation(taskId, otherTaskId, relationKind))
  })

  handleTrusted('delete-task-relation', async (_event, taskId: number, relationKind: string, otherTaskId: number) => {
    return refreshViewerOnSuccess(await deleteTaskRelation(taskId, relationKind, otherTaskId))
  })

  // Projects
  handleTrusted('fetch-projects', (_event, includeArchived = false) => {
    return fetchProjects(includeArchived)
  })

  handleTrusted('fetch-project', (_event, id: number) => {
    return fetchProjectById(id)
  })

  // Quick View remembers the active projects and their list views for a moment; a project change
  // makes that out of date.
  handleTrusted('create-project', async (_event, project: Record<string, unknown>) => {
    const result = await createProject(project)
    if (result.success) invalidateViewerCaches()
    return refreshViewerOnSuccess(result)
  })

  handleTrusted('update-project', async (_event, id: number, project: Record<string, unknown>) => {
    const result = await updateProject(id, project)
    if (result.success) invalidateViewerCaches()
    return refreshViewerOnSuccess(result)
  })

  handleTrusted('delete-project', async (_event, id: number) => {
    const result = await deleteProject(id)
    if (result.success) invalidateViewerCaches()
    return refreshViewerOnSuccess(result)
  })

  // Labels
  handleTrusted('fetch-labels', () => {
    return fetchLabels()
  })

  handleTrusted('add-label-to-task', async (_event, taskId: number, labelId: number, options?: unknown) => {
    const { queue, title, labelTitle } = parseTaskWriteOptions(options)
    const deps = taskWriteDeps()
    const label = labelTitle ? { id: labelId, title: labelTitle } : { id: labelId }
    const outcome = await writeTask(deps, taskWrites.addLabel(deps.queue, { addLabelToTask }, taskId, label, title), { queue })
    if (outcome.kind === 'sent') notifyViewerSync()
    return taskWriteReply(outcome)
  })

  handleTrusted('remove-label-from-task', async (_event, taskId: number, labelId: number, options?: unknown) => {
    const { queue, title } = parseTaskWriteOptions(options)
    const deps = taskWriteDeps()
    const outcome = await writeTask(deps, taskWrites.removeLabel(deps.queue, { removeLabelFromTask }, taskId, labelId, title), { queue })
    if (outcome.kind === 'sent') notifyViewerSync()
    return taskWriteReply(outcome)
  })

  handleTrusted('create-label', async (_event, label: Record<string, unknown>) => {
    return refreshViewerOnSuccess(await createLabel(label))
  })

  handleTrusted('update-label', async (_event, id: number, label: Record<string, unknown>) => {
    return refreshViewerOnSuccess(await updateLabel(id, label))
  })

  handleTrusted('delete-label', async (_event, id: number) => {
    return refreshViewerOnSuccess(await deleteLabel(id))
  })

  // Project Views
  handleTrusted('fetch-project-views', (_event, projectId: number) => {
    return fetchProjectViews(projectId)
  })

  handleTrusted('fetch-view-tasks', (_event, projectId: number, viewId: number, params: Record<string, unknown>) => {
    return fetchViewTasks(projectId, viewId, params)
  })

  handleTrusted('update-task-position', (_event, taskId: number, viewId: number, position: number) => {
    return updateTaskPosition(taskId, viewId, position)
  })

  // Config
  handleTrusted('get-config', () => {
    return loadConfig()
  })

  // The locale and clock for dates; all three windows ask when they load and listen for changes.
  handleTrusted('get-date-format', () => dateFormatForWindow())

  // The renderer never saves a whole config: its copy can be stale (main changes window bounds,
  // sidebar width, popup positions... on its own). Preferences go through save-config-patch and
  // setup/login/disconnect through save-connection-config.

  // Preference changes: only the keys in the patch change, merged into the config as it
  // is now, so fields main changes on its own (window bounds, popup positions, last
  // dialog directory...) are never reverted by a stale renderer snapshot.
  handleTrusted('save-config-patch', (_event, patch: unknown) => {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Invalid config patch')
    // Which account the app is signed in to changes only through save-connection-config: it drops
    // the previous account's cached data and queued changes. A patch that slipped a connection key
    // in would switch accounts without that, so the whole patch is refused.
    const connectionKeys = connectionKeysIn(patch)
    if (connectionKeys.length > 0) {
      throw new Error(`Connection settings (${connectionKeys.join(', ')}) are saved with save-connection-config, not a config patch`)
    }
    const latest = loadConfig()
    if (!latest) return
    const keys = Object.keys(patch)
    persistConfig(applyConfigPatch(latest, patch as Record<string, unknown>), !keys.every((k) => QUIET_PATCH_KEYS.has(k)))
  })

  // Setup, OIDC/password login and disconnect: only the connection fields change, every
  // preference is kept (see applyConnectionFields).
  handleTrusted('save-connection-config', (_event, connection: unknown) => {
    if (!isConnectionFields(connection)) throw new Error('Invalid connection settings')
    persistConfig(applyConnectionFields(loadConfig(), connection))
    // A different server or user: changes queued for the previous account must not follow.
    accountChanged()
    void replayPendingActions()
  })

  handleTrusted('custom-lists:get', () => getCustomLists())
  handleTrusted('custom-lists:upsert', (_event, list: CustomListWire) => upsertCustomList(list))
  handleTrusted('custom-lists:delete', (_event, id: string) => deleteCustomList(id))
  handleTrusted('custom-lists:reorder', (_event, ids: string[]) => reorderCustomLists(ids))
  handleTrusted('custom-lists:sync', () => syncCustomLists())
  handleTrusted('custom-lists:status', () => getCustomListSyncStatus())

  handleTrusted('set-task-badge', (_event, count: number, dataUrl: string | null) => {
    const cfg = loadConfig()
    if (cfg?.show_today_overdue_badge === true) {
      setTaskBadge(typeof count === 'number' ? count : 0, dataUrl ?? null)
    } else {
      clearTaskBadge()
    }
  })

  // Connection test
  handleTrusted('test-connection', (_event, url: string, token: string) => {
    const config = loadConfig()
    const saved = config?.auth_method === 'api_token' ? (getAPIToken() || config.api_token) : null
    return testConnection(url, tokenForConnectionTest(url, token, config?.vikunja_url ?? '', saved))
  })

  // Auth
  handleTrusted('auth:discover-oidc', (_event, url: string) => {
    return discoverProviders(url)
  })

  handleTrusted('auth:login-oidc', async (_event, url: string, providerKey: string, totpPasscode?: string) => {
    try {
      await authManager.login(url, providerKey, totpPasscode)
      accountChanged()
      // Signing in again is what a replay that paused on an expired session was waiting for.
      void replayPendingActions()
      return { success: true }
    } catch (err: unknown) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Login failed',
        ...(err instanceof OidcTotpRequiredError ? { totpRequired: true } : {}),
      }
    }
  })

  handleTrusted('auth:discover-methods', (_event, url: string) => {
    return discoverAuthMethods(url)
  })

  handleTrusted('auth:login-password', async (_event, url: string, username: string, password: string, totpPasscode?: string) => {
    const result = await authManager.loginPassword(url, username, password, totpPasscode)
    if (result.success) {
      accountChanged()
      void replayPendingActions()
    }
    return result
  })

  handleTrusted('auth:get-user', async () => {
    const config = loadConfig()
    if (!config?.vikunja_url) return null
    const token = config.auth_method === 'api_token'
      ? (getAPIToken() || config.api_token)
      : authManager.getTokenSync()
    if (!token) return null
    const user = await fetchCurrentUser(config.vikunja_url, token)
    if (user) rememberKnownUser(config.vikunja_url, user.id)
    return user
  })

  handleTrusted('auth:check', async () => {
    const config = loadConfig()
    if (!config || !config.vikunja_url) {
      return { status: 'unconfigured' as const }
    }

    if (config.auth_method === 'api_token') {
      const hasToken = !!(getAPIToken() || config.api_token)
      return { status: hasToken ? 'authenticated' as const : 'unconfigured' as const }
    }

    // OIDC / password: try sync first, then async recovery
    const syncToken = authManager.getTokenSync()
    if (syncToken) {
      return { status: 'authenticated' as const }
    }

    // Sync check failed — try async recovery
    try {
      await authManager.getToken()
      return { status: 'authenticated' as const }
    } catch {
      return {
        status: 'reauth-needed' as const,
        authMethod: config.auth_method,
        vikunjaUrl: config.vikunja_url,
        lastUsername: config.last_username,
      }
    }
  })

  handleTrusted('auth:logout', async () => {
    await authManager.logout()
    accountChanged()
  })

  // --- Quick Entry IPC ---
  handleTrusted('qe:save-task', async (_event, title: string, description: string | null, dueDate: string | null, projectId: number | null, priority?: number, repeatAfter?: number, repeatMode?: number, extras?: { labels?: unknown; images?: unknown }) => {
    const config = loadConfig()
    if (!config) return { success: false, error: 'Configuration not loaded' }

    // Standalone mode: store locally
    if (config.standalone_mode) {
      const task = addStandaloneTask(title, description, dueDate)
      notifyViewerSync()
      return { success: true, task, data: task }
    }

    const targetProjectId = projectId || config.quick_entry_default_project_id || config.inbox_project_id
    const taskPayload: Record<string, unknown> = { title }
    if (description) taskPayload.description = description
    if (dueDate) taskPayload.due_date = dueDate
    if (priority && priority > 0) taskPayload.priority = priority
    if (repeatAfter !== undefined) taskPayload.repeat_after = repeatAfter
    if (repeatMode !== undefined) taskPayload.repeat_mode = repeatMode

    // The create is queued with everything the user set when the server cannot be reached; see
    // createFromQuickEntry for what may be queued and why.
    const result = await createFromQuickEntry(quickActionDeps(), targetProjectId, taskPayload, extras)
    if (result.success && !('cached' in result)) notifyViewerSync()
    return result
  })

  handleTrusted('qe:close-window', () => {
    hideQuickEntry()
  })

  handleTrusted('qe:get-config', () => {
    const config = loadConfig()
    if (!config) return null
    return {
      vikunja_url: config.vikunja_url,
      quick_entry_default_project_id: config.quick_entry_default_project_id || config.inbox_project_id,
      inbox_project_id: config.inbox_project_id,
      exclamation_today: config.exclamation_today,
      secondary_projects: config.secondary_projects || [],
      project_cycle_modifier: config.project_cycle_modifier || 'ctrl',
      standalone_mode: config.standalone_mode === true,
      nlp_enabled: config.nlp_enabled,
      nlp_syntax_mode: config.nlp_syntax_mode,
    }
  })

  handleTrusted('qe:get-pending-count', () => {
    return getOfflineQueue().counts().pending
  })

  // Pending and failed changes, for the indicator under the input.
  handleTrusted('qe:get-queue-counts', () => getOfflineQueue().counts())

  // The create reached the server but a label or upload call after it hit a network or server
  // problem: the window sends what failed and it is queued for replay.
  handleTrusted('qe:queue-follow-ups', async (_event, taskId: unknown, extras: unknown, title?: unknown) => {
    const result = await queueQuickEntryFollowUps(
      getOfflineQueue(),
      typeof taskId === 'number' ? taskId : 0,
      extras && typeof extras === 'object' ? (extras as { labels?: unknown; images?: unknown }) : {},
      typeof title === 'string' ? title : undefined,
    )
    if (result.success && result.labels + result.images > 0) void replayPendingActions()
    return result
  })

  // --- Quick View IPC ---
  handleTrusted('qv:fetch-tasks', async () => {
    const config = loadConfig()
    if (!config) return { success: false, error: 'Configuration not loaded' }

    // Standalone mode: read from local store
    if (config.standalone_mode) {
      const tasks = getStandaloneTasks(
        config.viewer_filter?.sort_by || 'due_date',
        config.viewer_filter?.order_by || 'asc',
      )
      return { success: true, tasks, standalone: true }
    }

    if (!config.viewer_filter) return { success: false, error: 'No filter configuration' }

    // Remembered for 30 s: a refresh no longer reads every page of the project list (D-IPC-6).
    const activeProjectIds = await activeProjects.get(config.vikunja_url)

    // A viewer that points at a custom list takes that list's conditions. The server query is a
    // superset; the exact rule is applied below with the same evaluator as the main window.
    const resolved = resolveViewerFilter(config.viewer_filter, config.custom_lists)
    const { filter: effectiveFilter, fromCustomList } = resolved
    const now = new Date()
    const filterParams = {
      ...buildViewerFilterParams(effectiveFilter, now),
      // A custom list filters before hiding nested subtasks, so a matching subtask whose
      // parent does not match is still shown (cross-app semantics v1, section 3.2).
      ...(fromCustomList ? { [KEEP_NESTED_SUBTASKS_PARAM]: true } : {}),
    } as unknown as Record<string, unknown>

    // Position sort needs special handling via project views
    let result: Awaited<ReturnType<typeof fetchTasks>>
    if (effectiveFilter.sort_by === 'position') {
      // Only an include list names the projects to read; an exclude list is not a project list.
      const listedProjectIds = effectiveFilter.project_filter_mode === 'exclude' ? [] : effectiveFilter.project_ids
      const projectIds = activeProjectIds
        ? listedProjectIds.filter(projectId => activeProjectIds.has(projectId))
        : listedProjectIds
      if (projectIds && projectIds.length > 0) {
        result = await fetchPositionSortedTasks(projectIds, filterParams, {
          fetchViews: fetchProjectViews,
          fetchViewTasks,
        }, { viewCache: projectListViewIds })
      } else if (fromCustomList) {
        // A custom list may sort by position without naming projects (all of them, or all but
        // some). The tasks endpoint refuses that sort, so the tasks come in their default order
        // and selectQuickViewTasks sorts them, like the main window does.
        result = await fetchTasks({ ...filterParams, sort_by: 'updated', order_by: 'desc' })
      } else {
        return { success: false, error: 'Position sort requires specific projects' }
      }
    } else {
      result = await fetchTasks(filterParams)
    }

    if (result.success) {
      const tasks = selectQuickViewTasks(
        (result.data ?? []) as Array<{ project_id: number; done?: boolean; due_date?: string | null; priority?: number; labels?: Array<{ id: number }> | null; description?: string; position?: number; created?: string; updated?: string; done_at?: string; title?: string }>,
        resolved,
        {
          now,
          inboxProjectId: config.inbox_project_id,
          keep: (task) => !hasVicuMetadataMarker(task.description)
            && (!activeProjectIds || activeProjectIds.has(task.project_id)),
        },
      )
      setCachedTasks(tasks ?? [])
      return { success: true, tasks }
    }

    // API failed — serve the cached list when there is one; a non-retriable failure
    // is passed along so the popup shows the error as well.
    return cachedFallback(result.error, getCachedTasks()) ?? result
  })

  handleTrusted('qv:mark-task-done', async (_event, rawTaskId: number | string, taskData: Record<string, unknown>) => {
    const config = loadConfig()
    if (config?.standalone_mode) {
      const task = markStandaloneTaskDone(String(rawTaskId))
      return task ? { success: true, task } : { success: false, error: 'Task not found' }
    }
    return quickViewComplete(quickActionDeps(), rawTaskId, taskData)
  })

  handleTrusted('qv:mark-task-undone', async (_event, rawTaskId: number | string, taskData: Record<string, unknown>) => {
    const config = loadConfig()
    if (config?.standalone_mode) {
      const task = markStandaloneTaskUndone(String(rawTaskId))
      return task ? { success: true, task } : { success: false, error: 'Task not found' }
    }
    return quickViewReopen(quickActionDeps(), rawTaskId, taskData)
  })

  handleTrusted('qv:schedule-task-today', async (_event, rawTaskId: number | string, taskData: Record<string, unknown>) => {
    // Same date-only rule as every other "today" setter: local 23:59:59 (D-IPC-3).
    const dueDate = dueToday()

    const config = loadConfig()
    if (config?.standalone_mode) {
      const task = scheduleStandaloneTaskToday(String(rawTaskId))
      return task ? { success: true, task } : { success: false, error: 'Task not found' }
    }
    return quickViewPatch(quickActionDeps(), rawTaskId, { due_date: dueDate }, taskData)
  })

  handleTrusted('qv:remove-due-date', async (_event, rawTaskId: number | string, taskData: Record<string, unknown>) => {
    const config = loadConfig()
    if (config?.standalone_mode) {
      const task = removeStandaloneTaskDueDate(String(rawTaskId))
      return task ? { success: true, task } : { success: false, error: 'Task not found' }
    }
    return quickViewPatch(quickActionDeps(), rawTaskId, { due_date: null }, taskData)
  })

  handleTrusted('qv:update-task', async (_event, rawTaskId: number | string, patch: Record<string, unknown>) => {
    const config = loadConfig()
    if (config?.standalone_mode) {
      const task = updateStandaloneTask(String(rawTaskId), patch)
      return task ? { success: true, task } : { success: false, error: 'Task not found' }
    }
    return quickViewPatch(quickActionDeps(), rawTaskId, patch)
  })

  handleTrusted('qv:open-task-in-browser', (_event, taskId: number) => {
    const config = loadConfig()
    if (!config || config.standalone_mode) return
    const url = `${config.vikunja_url}/tasks/${taskId}`
    if (url.startsWith('https://') || url.startsWith('http://')) {
      shell.openExternal(url)
    }
  })

  handleTrusted('qv:open-task-in-app', (_event, taskId: number) => {
    // Only a task that exists on the server has a row to open (a queued one has a temp id).
    if (!Number.isInteger(taskId) || taskId <= 0) return
    const win = getMainWindow()
    if (!win || win.isDestroyed()) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    win.webContents.send('navigate-to-task', taskId)
    hideQuickView()
  })

  handleTrusted('qv:close-window', () => {
    hideQuickView()
  })

  handleTrusted('qe:set-height', (_event, height: number) => {
    setQuickEntryHeight(height)
  })

  handleTrusted('qv:set-height', (_event, height: number) => {
    setViewerHeight(height)
  })

  handleTrusted('qv:get-pending-count', () => {
    return getOfflineQueue().counts().pending
  })

  handleTrusted('qv:get-queue-counts', () => getOfflineQueue().counts())

  handleTrusted('qv:get-config', () => {
    const config = loadConfig()
    if (!config) return null
    return {
      standalone_mode: config.standalone_mode === true,
      theme: config.theme,
    }
  })

  // --- Notifications IPC ---
  handleTrusted('notifications:test', () => {
    sendTestNotification()
  })

  handleTrusted('notifications:reschedule', () => {
    rescheduleNotifications()
  })

  // Every completed, deleted or edited task asks for this; a bulk change asks many times in a row,
  // so main waits for a quiet second and refreshes once.
  handleTrusted('notifications:refresh-task-reminders', () => {
    refreshTaskRemindersSoon()
  })

  handleTrusted('notifications:refresh-routine-reminders', () => {
    refreshRoutineReminders()
  })

  // --- Apply Quick Entry Settings (called from renderer settings page) ---
  handleTrusted('apply-quick-entry-settings', () => {
    return applyQuickEntrySettings()
  })

  // --- Global shortcut registration status ---
  // Returns the latest success/failure state of the Quick Entry / Quick View
  // globalShortcut.register() calls. The Settings view uses this to surface a
  // warning banner on platforms where registration can silently fail (notably
  // Wayland).
  handleTrusted('get-global-shortcut-status', () => {
    return getLastShortcutStatus()
  })

  // How the sign-in secrets are protected on this machine ('encrypted', 'obfuscated' or
  // 'plaintext'), so Settings can warn instead of implying they are always encrypted (D-AUTH-4).
  handleTrusted('get-secret-storage-status', () => getSecretStorageStatus())

  // Whether "Launch on startup" can be offered: always on Windows and macOS, on Linux only when the
  // executable (the AppImage file or the installed binary) is known (D-LNX-1).
  handleTrusted('get-launch-on-startup-support', () => getLaunchOnStartupSupport(startupEnv()))

  // --- Hotkey launcher command (Linux/Wayland escape hatch) ---
  // Returns the exact shell command a user should bind in their desktop
  // environment's keyboard settings to trigger Quick Entry / Quick View on
  // Wayland. All paths returned are absolute so the command works regardless
  // of the spawning process's working directory (GNOME/KDE custom-shortcut
  // spawners run with cwd = $HOME or /, not the project root).
  handleTrusted('get-hotkey-launcher-command', () => {
    const quote = (s: string) => (/[\s"']/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s)

    let base: string
    let kind: 'appimage' | 'packaged' | 'dev'
    const appImage = process.env.APPIMAGE
    if (appImage && appImage.length > 0) {
      // AppImage: a single self-contained executable, no app path arg needed.
      base = quote(appImage)
      kind = 'appimage'
    } else if (app.isPackaged) {
      // Other packaged Linux formats (snap, .deb, tarball, etc.).
      base = quote(process.execPath)
      kind = 'packaged'
    } else {
      // Dev mode: electron binary + absolute app path.
      const appPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
      base = appPath ? `${quote(process.execPath)} ${quote(appPath)}` : quote(process.execPath)
      kind = 'dev'
    }

    return {
      quickEntry: `${base} --quick-entry`,
      quickView: `${base} --quick-view`,
      kind,
    }
  })

  // --- Standalone mode IPC ---
  handleTrusted('qe:get-standalone-task-count', () => {
    return getAllStandaloneTasks().length
  })

  // --- Attachments IPC ---
  handleTrusted('fetch-task-attachments', (_event, taskId: number) => {
    return fetchTaskAttachments(taskId)
  })

  handleTrusted('upload-task-attachment', async (_event, taskId: number, fileData: Uint8Array, fileName: string, mimeType: string) => {
    return refreshViewerOnSuccess(await uploadTaskAttachment(taskId, Buffer.from(fileData), fileName, mimeType))
  })

  handleTrusted('delete-task-attachment', async (_event, taskId: number, attachmentId: number) => {
    return refreshViewerOnSuccess(await deleteTaskAttachment(taskId, attachmentId))
  })

  handleTrusted('fetch-task-attachment-bytes', async (_event, taskId: number, attachmentId: number) => {
    // Inline task-note images only need a bounded preview. Fetching full-size
    // phone photos here can exhaust the renderer/IPC budget before <img> decodes.
    const result = await downloadTaskAttachment(taskId, attachmentId, 'lg')
    if (!result.success) return result
    if (result.data.length === 0) {
      return { success: false, error: 'Attachment preview was empty' }
    }
    return { success: true, data: new Uint8Array(result.data) }
  })

  handleTrusted('open-task-attachment', async (_event, taskId: number, attachmentId: number, fileName: string) => {
    if (!Number.isSafeInteger(taskId) || !Number.isSafeInteger(attachmentId)) {
      return { success: false, error: 'Invalid attachment' }
    }
    const result = await downloadTaskAttachment(taskId, attachmentId)
    if (!result.success) return result

    try {
      const tempDir = ensureAttachmentTempDir(app.getPath('temp'))
      const safeName = sanitizeAttachmentFileName(fileName, `attachment-${attachmentId}`)
      const filePath = path.join(tempDir, `${attachmentId}-${safeName}`)
      // Defense-in-depth: verify resolved path is inside tempDir
      const resolved = path.resolve(filePath)
      if (!resolved.startsWith(path.resolve(tempDir) + path.sep)) {
        return { success: false, error: 'Invalid attachment filename' }
      }
      fs.writeFileSync(filePath, result.data, { mode: 0o600 })

      // The copy has no Mark-of-the-Web, so executables, scripts, shortcuts and
      // macro documents are shown in the file manager instead of being run.
      if (isRiskyAttachment(safeName)) {
        shell.showItemInFolder(filePath)
        return { success: true, data: undefined }
      }

      const openError = await shell.openPath(filePath)
      if (openError) return { success: false, error: openError }
      return { success: true, data: undefined }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to open file' }
    }
  })

  handleTrusted('pick-and-upload-attachment', async (_event, taskId: number) => {
    const win = getMainWindow()
    const config = loadConfig()
    const dialogResult = await dialog.showOpenDialog(win!, {
      properties: ['openFile', 'multiSelections'],
      defaultPath: resolveDialogDefaultPath(
        config?.last_file_dialog_directory,
        app.getPath('documents')
      ),
    })
    if (dialogResult.canceled || dialogResult.filePaths.length === 0) {
      return { success: true, data: { count: 0 } }
    }

    if (config) {
      config.last_file_dialog_directory = directoryFromSelectedFile(dialogResult.filePaths[0])
      saveConfig(config)
    }

    let count = 0
    let lastError = ''
    for (const filePath of dialogResult.filePaths) {
      // Size is checked against the server's limit from stat, before the file is read, and the read
      // is asynchronous: picking a huge file neither freezes the app nor fills memory (D-IPC-5).
      const loaded = await loadFileForUpload(filePath, { checkSize })
      if (!loaded.ok) {
        lastError = loaded.error
        continue
      }
      const fileName = path.basename(filePath)
      const mimeType = getMimeType(fileName)
      const result = await uploadTaskAttachment(taskId, loaded.buffer, fileName, mimeType)
      if (result.success) count++
      else lastError = result.error
    }
    if (count === 0 && dialogResult.filePaths.length > 0) {
      return { success: false, error: lastError || 'Upload failed' }
    }
    if (count > 0) notifyViewerSync()
    return { success: true, data: { count } }
  })

  // --- Obsidian IPC ---
  handleTrusted('open-deep-link', (_event, url: string) => {
    if (isExternalAllowed(url)) {
      shell.openExternal(url).catch(() => { /* no handler for the scheme */ })
    }
  })

  // Quick Entry is saving a task with the note linked: this is the one place the note gets its
  // uid (D-OBS-1). Returns the link to store, or null when no note is being shown.
  handleTrusted('qe:resolve-obsidian-link', async () => {
    const link = await resolveShownObsidianLink()
    if (!link) return null
    return { deepLink: link.deepLink, noteName: link.noteName, isUidBased: link.isUidBased }
  })

  handleTrusted('test-obsidian-connection', async () => {
    const config = loadConfig()
    if (!config?.obsidian_api_key) return { success: false, error: 'No API key configured' }
    try {
      const result = await testObsidianConnection(config.obsidian_api_key, config.obsidian_port || 27124)
      if (result.reachable) {
        return { success: true, data: result.noteName ? { noteName: result.noteName } : null }
      }
      return { success: false, error: 'Cannot reach Obsidian. Is the Local REST API plugin enabled?' }
    } catch {
      return { success: false, error: 'Cannot reach Obsidian. Is the Local REST API plugin enabled?' }
    }
  })

  handleTrusted('qe:upload-standalone-tasks', async (_event, projectId: number) => {
    const tasks = getAllStandaloneTasks()
    if (tasks.length === 0) return { success: true, uploaded: 0 }

    // Each task leaves the local store as soon as its upload succeeded, so a retry after
    // a partial failure only sends the ones that did not go through (D-IPC-1).
    const { uploaded, errors } = await uploadStandaloneTasks(tasks, {
      upload: (payload) => createTask(projectId, payload),
      remove: removeStandaloneTask,
      isAuthError,
    })

    if (errors.length === 0 && uploaded === tasks.length) {
      // Sweep what is left: completed tasks, which are never uploaded.
      clearStandaloneTasks()
    }

    if (errors.length > 0) {
      return { success: false, uploaded, error: errors[0], totalErrors: errors.length }
    }
    return { success: true, uploaded }
  })

  // --- Browser Link IPC ---
  handleTrusted('check-browser-host-registration', () => isRegistered())

  handleTrusted('register-browser-hosts', () => {
    const config = loadConfig()
    registerHosts({
      chromeExtensionId: config?.browser_extension_id || '',
      firefoxExtensionId: 'browser-link@vicu.app',
    })
    return isRegistered()
  })

  // --- Update Checker IPC ---
  handleTrusted('update:check', () => {
    return checkForUpdates(true)
  })

  handleTrusted('update:get-status', () => {
    return getCachedUpdateStatus()
  })

  handleTrusted('update:dismiss', (_event, version: string) => {
    const config = loadConfig()
    if (config) {
      config.update_check_dismissed_version = version
      saveConfig(config)
    }
  })

  handleTrusted('open-browser-extension-folder', () => {
    const base = app.isPackaged
      ? path.join(process.resourcesPath, 'extensions', 'browser')
      : path.join(app.getAppPath(), 'extensions', 'browser')
    if (!require('fs').existsSync(base)) return
    const manifest = path.join(base, 'manifest.json')
    shell.showItemInFolder(manifest)
  })

  // --- Task completion sound IPC ---
  handleTrusted('sound:pick', async () => {
    const win = getMainWindow()
    return pickAndCopySoundFile(win ?? null)
  })

  handleTrusted('sound:reset', () => {
    resetSoundToDefault()
  })

  handleTrusted('sound:read', () => {
    return readSoundBytes()
  })

  handleTrusted('sound:get-info', () => {
    return getSoundInfo()
  })
}

// Helper: notify main window to refresh its query cache. Pass the sender's
// webContents id to skip the echo when the main window initiated the change —
// its own mutation hooks already invalidate.
function notifyMainWindow(excludeWebContentsId?: number): void {
  try {
    const win = getMainWindow()
    if (win && !win.isDestroyed() && win.webContents.id !== excludeWebContentsId) {
      win.webContents.send('tasks-changed')
    }
  } catch { /* ignore */ }
}

// Helper: tell Quick View to refresh after a change that went through, and pass the result on.
function refreshViewerOnSuccess<T extends { success: boolean }>(result: T): T {
  if (result.success) notifyViewerSync()
  return result
}

// Helper: notify Quick View to refresh
function notifyViewerSync(): void {
  try {
    const viewerWindow = getQuickViewWindow()
    if (viewerWindow && !viewerWindow.isDestroyed()) {
      viewerWindow.webContents.send('sync-completed')
    }
  } catch { /* ignore */ }
}

// Helper: guess MIME type from file extension
function getMimeType(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase()
  const mimeMap: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.txt': 'text/plain',
    '.csv': 'text/csv',
    '.json': 'application/json',
    '.xml': 'application/xml',
    '.zip': 'application/zip',
    '.gz': 'application/gzip',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
  }
  return mimeMap[ext] || 'application/octet-stream'
}
