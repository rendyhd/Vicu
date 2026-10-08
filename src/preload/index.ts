import { contextBridge, ipcRenderer } from 'electron'
import type { ProjectPatch, TaskPatch } from '../shared/merge-patches'
import type {
  OfflineCreateInput,
  OfflineLabelRef,
  OfflineReplayEvent,
  TaskWriteOptions,
} from '../shared/offline-queue-types'

const api = {
  platform: process.platform as 'darwin' | 'win32' | 'linux',

  // Tasks
  fetchTasks: (params: Record<string, unknown>) =>
    ipcRenderer.invoke('fetch-tasks', params),
  fetchRoutineCarriers: () =>
    ipcRenderer.invoke('fetch-routine-carriers'),
  createTask: (projectId: number, task: Record<string, unknown>) =>
    ipcRenderer.invoke('create-task', projectId, task),
  // The task writes go through the main process's write gate; `options.queue` says the caller can
  // live with the change being queued (see src/main/offline/task-writes.ts).
  updateTask: (id: number, patch: TaskPatch, options?: TaskWriteOptions) =>
    ipcRenderer.invoke('update-task', id, patch, options),
  deleteTask: (id: number, options?: TaskWriteOptions) =>
    ipcRenderer.invoke('delete-task', id, options),
  fetchTaskById: (id: number) =>
    ipcRenderer.invoke('fetch-task-by-id', id),
  createTaskRelation: (taskId: number, otherTaskId: number, relationKind: string) =>
    ipcRenderer.invoke('create-task-relation', taskId, otherTaskId, relationKind),
  deleteTaskRelation: (taskId: number, relationKind: string, otherTaskId: number) =>
    ipcRenderer.invoke('delete-task-relation', taskId, relationKind, otherTaskId),

  // Projects
  fetchProjects: (includeArchived = false) =>
    ipcRenderer.invoke('fetch-projects', includeArchived),
  fetchProject: (id: number) =>
    ipcRenderer.invoke('fetch-project', id),
  createProject: (project: Record<string, unknown>) =>
    ipcRenderer.invoke('create-project', project),
  updateProject: (id: number, patch: ProjectPatch) =>
    ipcRenderer.invoke('update-project', id, patch),
  deleteProject: (id: number) =>
    ipcRenderer.invoke('delete-project', id),

  // Labels
  fetchLabels: () =>
    ipcRenderer.invoke('fetch-labels'),
  addLabelToTask: (taskId: number, labelId: number, options?: TaskWriteOptions) =>
    ipcRenderer.invoke('add-label-to-task', taskId, labelId, options),
  removeLabelFromTask: (taskId: number, labelId: number, options?: TaskWriteOptions) =>
    ipcRenderer.invoke('remove-label-from-task', taskId, labelId, options),
  createLabel: (label: Record<string, unknown>) =>
    ipcRenderer.invoke('create-label', label),
  updateLabel: (id: number, label: Record<string, unknown>) =>
    ipcRenderer.invoke('update-label', id, label),
  deleteLabel: (id: number) =>
    ipcRenderer.invoke('delete-label', id),

  // Project Views
  fetchProjectViews: (projectId: number) =>
    ipcRenderer.invoke('fetch-project-views', projectId),
  fetchViewTasks: (projectId: number, viewId: number, params: Record<string, unknown>) =>
    ipcRenderer.invoke('fetch-view-tasks', projectId, viewId, params),
  updateTaskPosition: (taskId: number, viewId: number, position: number) =>
    ipcRenderer.invoke('update-task-position', taskId, viewId, position),

  // Config
  getConfig: () =>
    ipcRenderer.invoke('get-config'),
  saveConfigPatch: (patch: Record<string, unknown>) =>
    ipcRenderer.invoke('save-config-patch', patch),
  saveConnectionConfig: (connection: Record<string, unknown>) =>
    ipcRenderer.invoke('save-connection-config', connection),
  getCustomLists: () => ipcRenderer.invoke('custom-lists:get'),
  upsertCustomList: (list: Record<string, unknown>) => ipcRenderer.invoke('custom-lists:upsert', list),
  deleteCustomList: (id: string) => ipcRenderer.invoke('custom-lists:delete', id),
  reorderCustomLists: (ids: string[]) => ipcRenderer.invoke('custom-lists:reorder', ids),
  syncCustomLists: () => ipcRenderer.invoke('custom-lists:sync'),
  getCustomListSyncStatus: () => ipcRenderer.invoke('custom-lists:status'),
  onCustomListsChanged: (cb: (lists: unknown[]) => void) => {
    const handler = (_: unknown, lists: unknown[]) => cb(lists)
    ipcRenderer.on('custom-lists-changed', handler)
    return () => { ipcRenderer.removeListener('custom-lists-changed', handler) }
  },
  onCustomListSyncStatus: (cb: (status: unknown) => void) => {
    const handler = (_: unknown, status: unknown) => cb(status)
    ipcRenderer.on('custom-list-sync-status', handler)
    return () => { ipcRenderer.removeListener('custom-list-sync-status', handler) }
  },

  // Badge
  setTaskBadge: (count: number, dataUrl: string | null) =>
    ipcRenderer.invoke('set-task-badge', count, dataUrl),

  // Connection test
  testConnection: (url: string, token: string) =>
    ipcRenderer.invoke('test-connection', url, token),

  // Auth
  discoverOidc: (url: string) =>
    ipcRenderer.invoke('auth:discover-oidc', url),
  discoverAuthMethods: (url: string) =>
    ipcRenderer.invoke('auth:discover-methods', url),
  oidcLogin: (url: string, providerKey: string, totpPasscode?: string) =>
    ipcRenderer.invoke('auth:login-oidc', url, providerKey, totpPasscode),
  loginPassword: (url: string, username: string, password: string, totpPasscode?: string) =>
    ipcRenderer.invoke('auth:login-password', url, username, password, totpPasscode),
  getUser: () =>
    ipcRenderer.invoke('auth:get-user'),
  checkAuth: () =>
    ipcRenderer.invoke('auth:check'),
  logout: () =>
    ipcRenderer.invoke('auth:logout'),

  // Notifications
  testNotification: () =>
    ipcRenderer.invoke('notifications:test'),
  rescheduleNotifications: () =>
    ipcRenderer.invoke('notifications:reschedule'),
  refreshTaskReminders: () =>
    ipcRenderer.invoke('notifications:refresh-task-reminders'),
  refreshRoutineReminders: () =>
    ipcRenderer.invoke('notifications:refresh-routine-reminders'),

  // Attachments
  fetchTaskAttachments: (taskId: number) =>
    ipcRenderer.invoke('fetch-task-attachments', taskId),
  uploadTaskAttachment: (taskId: number, fileData: Uint8Array, fileName: string, mimeType: string) =>
    ipcRenderer.invoke('upload-task-attachment', taskId, fileData, fileName, mimeType),
  deleteTaskAttachment: (taskId: number, attachmentId: number) =>
    ipcRenderer.invoke('delete-task-attachment', taskId, attachmentId),
  fetchTaskAttachmentBytes: (taskId: number, attachmentId: number) =>
    ipcRenderer.invoke('fetch-task-attachment-bytes', taskId, attachmentId),
  openTaskAttachment: (taskId: number, attachmentId: number, fileName: string) =>
    ipcRenderer.invoke('open-task-attachment', taskId, attachmentId, fileName),
  pickAndUploadAttachment: (taskId: number) =>
    ipcRenderer.invoke('pick-and-upload-attachment', taskId),

  // Obsidian
  openDeepLink: (url: string) => ipcRenderer.invoke('open-deep-link', url),
  testObsidianConnection: () => ipcRenderer.invoke('test-obsidian-connection'),

  // Browser Link
  checkBrowserHostRegistration: () => ipcRenderer.invoke('check-browser-host-registration'),
  registerBrowserHosts: () => ipcRenderer.invoke('register-browser-hosts'),
  openBrowserExtensionFolder: () => ipcRenderer.invoke('open-browser-extension-folder'),

  // Quick Entry settings
  applyQuickEntrySettings: () =>
    ipcRenderer.invoke('apply-quick-entry-settings') as Promise<{ entry: boolean; viewer: boolean; waylandLimited: boolean }>,
  getGlobalShortcutStatus: () =>
    ipcRenderer.invoke('get-global-shortcut-status') as Promise<{ entry: boolean; viewer: boolean; waylandLimited: boolean }>,
  getSecretStorageStatus: () =>
    ipcRenderer.invoke('get-secret-storage-status') as Promise<'encrypted' | 'obfuscated' | 'plaintext'>,
  getLaunchOnStartupSupport: () =>
    ipcRenderer.invoke('get-launch-on-startup-support') as Promise<{ supported: boolean }>,
  getHotkeyLauncherCommand: () =>
    ipcRenderer.invoke('get-hotkey-launcher-command') as Promise<{ quickEntry: string; quickView: string; kind: 'appimage' | 'packaged' | 'dev' }>,

  // Locale and clock for dates (src/shared/date-display.ts); changes when the clock setting does.
  getDateFormat: () => ipcRenderer.invoke('get-date-format'),
  onDateFormatChanged: (callback: (format: { locale: string; hour12: boolean }) => void) => {
    const handler = (_: unknown, format: { locale: string; hour12: boolean }) => callback(format)
    ipcRenderer.on('date-format-changed', handler)
    return () => { ipcRenderer.removeListener('date-format-changed', handler) }
  },

  // The computer woke from sleep: timers and the clock may have jumped while it was asleep.
  onAppResumed: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('app-resumed', handler)
    return () => { ipcRenderer.removeListener('app-resumed', handler) }
  },

  // Offline queue: changes that could not reach the server wait here, in the main process, and are
  // replayed in order. Every call answers `{ success, data | error }`.
  offlineQueue: {
    snapshot: () => ipcRenderer.invoke('offline-queue:snapshot'),
    enqueueUpdate: (taskRef: number | string, patch: TaskPatch, meta?: { title?: string }) =>
      ipcRenderer.invoke('offline-queue:enqueue-update', taskRef, patch, meta),
    enqueueComplete: (taskRef: number | string, done: boolean, meta?: { title?: string }) =>
      ipcRenderer.invoke('offline-queue:enqueue-complete', taskRef, done, meta),
    enqueueDelete: (taskRef: number | string, meta?: { title?: string }) =>
      ipcRenderer.invoke('offline-queue:enqueue-delete', taskRef, meta),
    enqueueCreate: (input: OfflineCreateInput) =>
      ipcRenderer.invoke('offline-queue:enqueue-create', input),
    enqueueAddLabel: (taskRef: number | string, label: OfflineLabelRef, meta?: { title?: string }) =>
      ipcRenderer.invoke('offline-queue:enqueue-add-label', taskRef, label, meta),
    enqueueRemoveLabel: (taskRef: number | string, labelId: number, meta?: { title?: string }) =>
      ipcRenderer.invoke('offline-queue:enqueue-remove-label', taskRef, labelId, meta),
    cancelChange: (taskRef: number | string, keys: string[]) =>
      ipcRenderer.invoke('offline-queue:cancel-change', taskRef, keys),
    retryFailed: (ids?: string[]) => ipcRenderer.invoke('offline-queue:retry-failed', ids),
    discardFailed: (ids?: string[]) => ipcRenderer.invoke('offline-queue:discard-failed', ids),
    discardPending: (ids: string[]) => ipcRenderer.invoke('offline-queue:discard-pending', ids),
    replayNow: () => ipcRenderer.invoke('offline-queue:replay-now'),
    onChanged: (cb: (change: unknown) => void) => {
      const handler = (_: unknown, change: unknown) => cb(change)
      ipcRenderer.on('offline-queue:changed', handler)
      return () => { ipcRenderer.removeListener('offline-queue:changed', handler) }
    },
    onReplayed: (cb: (event: OfflineReplayEvent) => void) => {
      const handler = (_: unknown, event: OfflineReplayEvent) => cb(event)
      ipcRenderer.on('offline-queue:replayed', handler)
      return () => { ipcRenderer.removeListener('offline-queue:replayed', handler) }
    },
    onAuthProblem: (cb: (problem: { error: string }) => void) => {
      const handler = (_: unknown, problem: { error: string }) => cb(problem)
      ipcRenderer.on('offline-queue:auth-problem', handler)
      return () => { ipcRenderer.removeListener('offline-queue:auth-problem', handler) }
    },
  },

  // Standalone mode
  getStandaloneTaskCount: () =>
    ipcRenderer.invoke('qe:get-standalone-task-count') as Promise<number>,
  uploadStandaloneTasks: (projectId: number) =>
    ipcRenderer.invoke('qe:upload-standalone-tasks', projectId) as Promise<
      { success: boolean; uploaded: number; error?: string; totalErrors?: number }
    >,

  // Task completion sound
  pickCompletionSound: () =>
    ipcRenderer.invoke('sound:pick') as Promise<
      { success: true; path: string; fileName: string } | { success: false; error: string }
    >,
  resetCompletionSound: () =>
    ipcRenderer.invoke('sound:reset') as Promise<void>,
  readCompletionSound: () =>
    ipcRenderer.invoke('sound:read') as Promise<
      { success: true; data: Uint8Array<ArrayBuffer>; mimeType: string } | { success: false; error: string }
    >,
  getCompletionSoundInfo: () =>
    ipcRenderer.invoke('sound:get-info') as Promise<{ path: string; fileName: string; isDefault: boolean }>,

  // Update checker
  checkForUpdate: () => ipcRenderer.invoke('update:check'),
  getUpdateStatus: () => ipcRenderer.invoke('update:get-status'),
  dismissUpdate: (version: string) => ipcRenderer.invoke('update:dismiss', version),
  onUpdateAvailable: (cb: (status: unknown) => void) => {
    const handler = (_: unknown, status: unknown) => cb(status)
    ipcRenderer.on('update-available', handler)
    return () => { ipcRenderer.removeListener('update-available', handler) }
  },

  // Window controls
  windowMinimize: () => ipcRenderer.invoke('window-minimize'),
  windowMaximize: () => ipcRenderer.invoke('window-maximize'),
  windowClose: () => ipcRenderer.invoke('window-close'),
  windowIsMaximized: () => ipcRenderer.invoke('window-is-maximized') as Promise<boolean>,
  onWindowMaximizedChange: (cb: (maximized: boolean) => void) => {
    const handler = (_: unknown, maximized: boolean) => cb(maximized)
    ipcRenderer.on('window-maximized-change', handler)
    return () => { ipcRenderer.removeListener('window-maximized-change', handler) }
  },
  onTasksChanged: (cb: () => void) => {
    const handler = () => cb()
    ipcRenderer.on('tasks-changed', handler)
    return () => { ipcRenderer.removeListener('tasks-changed', handler) }
  },
  onNavigate: (cb: (path: string) => void) => {
    const handler = (_: unknown, path: string) => cb(path)
    ipcRenderer.on('navigate', handler)
    return () => { ipcRenderer.removeListener('navigate', handler) }
  },
  // File > New Task (Ctrl+N). The menu accelerator takes the key before the page sees it.
  onNewTask: (cb: () => void) => {
    const handler = () => cb()
    ipcRenderer.on('new-task', handler)
    return () => { ipcRenderer.removeListener('new-task', handler) }
  },
  // Main asks the window to show one task (a clicked reminder, Quick View's "open in app").
  onNavigateToTask: (cb: (taskId: number) => void) => {
    const handler = (_: unknown, taskId: number) => cb(taskId)
    ipcRenderer.on('navigate-to-task', handler)
    return () => { ipcRenderer.removeListener('navigate-to-task', handler) }
  },
  // Print
  printHtml: (html: string) =>
    ipcRenderer.invoke('print-html', html),
  onPrintView: (cb: () => void) => {
    const handler = () => cb()
    ipcRenderer.on('print-view', handler)
    return () => { ipcRenderer.removeListener('print-view', handler) }
  },
  onAuthRequired: (cb: () => void) => {
    const handler = () => cb()
    ipcRenderer.on('auth-required', handler)
    return () => { ipcRenderer.removeListener('auth-required', handler) }
  },
}

contextBridge.exposeInMainWorld('api', api)
