import { contextBridge, ipcRenderer } from 'electron'
import type { CalDavApi } from '../shared/caldav-types'
import type { ProjectPatch, TaskPatch } from '../shared/merge-patches'
import type {
  OfflineCreateInput,
  OfflineLabelRef,
  OfflineReplayEvent,
  TaskWriteOptions,
} from '../shared/offline-queue-types'
import type { VoiceEventEnvelope } from '../shared/voice-types'
import type { AiSettingsPatch, AskTurnEnvelope, AskTurnRequest, KeptTranscript, SpeechDownloadProgress, SpeechEventEnvelope, SpeechStartOptions } from '../shared/ai/types'

const api = {
  platform: process.platform as 'darwin' | 'win32' | 'linux',
  /** 'mica' when the main window has Mica behind it (Windows 11 22H2+; set by main, window-chrome.ts). */
  windowMaterial: (process.argv.includes('--vicu-window-material=mica') ? 'mica' : 'none') as 'mica' | 'none',

  caldav: {
    connections: () => ipcRenderer.invoke('caldav:connections'),
    discover: (input) => ipcRenderer.invoke('caldav:discover', input),
    select: (id, calendars) => ipcRenderer.invoke('caldav:select', id, calendars),
    remove: (id) => ipcRenderer.invoke('caldav:remove', id),
    events: (start, end) => ipcRenderer.invoke('caldav:events', start, end),
    update: (input) => ipcRenderer.invoke('caldav:update', input),
  } satisfies CalDavApi,

  // Tasks
  fetchTasks: (params: Record<string, unknown>) =>
    ipcRenderer.invoke('fetch-tasks', params),
  fetchRoutineCarriers: () =>
    ipcRenderer.invoke('fetch-routine-carriers'),
  getOwnUserId: () =>
    ipcRenderer.invoke('account:own-user-id'),
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
  // A routine carrier or archive part write (cross-app semantics 6.8): never queued.
  patchTaskJson: (id: number, operations: ReadonlyArray<Record<string, unknown>>) =>
    ipcRenderer.invoke('patch-task-json', id, operations),
  createTaskRelation: (taskId: number, otherTaskId: number, relationKind: string) =>
    ipcRenderer.invoke('create-task-relation', taskId, otherTaskId, relationKind),
  deleteTaskRelation: (taskId: number, relationKind: string, otherTaskId: number) =>
    ipcRenderer.invoke('delete-task-relation', taskId, relationKind, otherTaskId),

  // Collaboration (docs/cross-app-semantics-v1.md section 9). Assignee and comment changes go
  // through the write gate like the task writes above.
  searchProjectUsers: (projectId: number) =>
    ipcRenderer.invoke('search-project-users', projectId),
  fetchProjectShares: (projectId: number) =>
    ipcRenderer.invoke('fetch-project-shares', projectId),
  searchUsers: (query: string) =>
    ipcRenderer.invoke('search-users', query),
  shareProject: (projectId: number, username: string, permission: number) =>
    ipcRenderer.invoke('share-project', projectId, username, permission),
  updateProjectShare: (projectId: number, username: string, permission: number) =>
    ipcRenderer.invoke('update-project-share', projectId, username, permission),
  removeProjectShare: (projectId: number, username: string) =>
    ipcRenderer.invoke('remove-project-share', projectId, username),
  fetchAvatar: (username: string, size: number) =>
    ipcRenderer.invoke('fetch-avatar', username, size),
  addTaskAssignee: (taskId: number, userId: number, options?: TaskWriteOptions) =>
    ipcRenderer.invoke('add-task-assignee', taskId, userId, options),
  removeTaskAssignee: (taskId: number, userId: number, options?: TaskWriteOptions) =>
    ipcRenderer.invoke('remove-task-assignee', taskId, userId, options),
  fetchTaskComments: (taskId: number, page: number) =>
    ipcRenderer.invoke('fetch-task-comments', taskId, page),
  createTaskComment: (taskId: number, html: string, options?: TaskWriteOptions) =>
    ipcRenderer.invoke('create-task-comment', taskId, html, options),
  updateTaskComment: (taskId: number, commentId: number, html: string, options?: TaskWriteOptions) =>
    ipcRenderer.invoke('update-task-comment', taskId, commentId, html, options),
  deleteTaskComment: (taskId: number, commentId: number, options?: TaskWriteOptions) =>
    ipcRenderer.invoke('delete-task-comment', taskId, commentId, options),
  markTaskRead: (taskId: number) =>
    ipcRenderer.invoke('mark-task-read', taskId),
  setTaskSubscription: (taskId: number, subscribed: boolean) =>
    ipcRenderer.invoke('set-task-subscription', taskId, subscribed),

  // Projects
  countProjectTasks: (projectId: number, done: boolean) =>
    ipcRenderer.invoke('count-project-tasks', projectId, done),
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
  getSyncedPrefs: () => ipcRenderer.invoke('synced-prefs:get'),
  setSyncedPreference: (key: string, value: unknown) => ipcRenderer.invoke('synced-prefs:set', key, value),
  setSyncedPreferences: (values: Record<string, unknown>) => ipcRenderer.invoke('synced-prefs:set-many', values),
  syncSyncedPrefs: () => ipcRenderer.invoke('synced-prefs:sync'),
  getSyncedPrefsStatus: () => ipcRenderer.invoke('synced-prefs:status'),
  readSetupPreferences: (url: string, token?: string) => ipcRenderer.invoke('synced-prefs:read-for-setup', url, token),
  onSyncedPrefsChanged: (cb: (snapshot: unknown) => void) => {
    const handler = (_: unknown, snapshot: unknown) => cb(snapshot)
    ipcRenderer.on('synced-prefs-changed', handler)
    return () => { ipcRenderer.removeListener('synced-prefs-changed', handler) }
  },
  onSyncedPrefsStatus: (cb: (status: unknown) => void) => {
    const handler = (_: unknown, status: unknown) => cb(status)
    ipcRenderer.on('synced-prefs-sync-status', handler)
    return () => { ipcRenderer.removeListener('synced-prefs-sync-status', handler) }
  },
  getCustomListSyncStatus: () => ipcRenderer.invoke('custom-lists:status'),
  getUnsyncedDocuments: () => ipcRenderer.invoke('synced-documents:unsynced'),
  discardUnsyncedDocuments: () => ipcRenderer.invoke('synced-documents:discard'),
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
  oidcBrowserLogin: (url: string, providerKey: string, totpPasscode?: string) =>
    ipcRenderer.invoke('auth:login-oidc-browser', url, providerKey, totpPasscode),
  cancelOidcBrowserLogin: () =>
    ipcRenderer.invoke('auth:cancel-oidc-browser'),
  getOidcSignIn: () =>
    ipcRenderer.invoke('auth:oidc-sign-in'),
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
  saveTaskAttachment: (taskId: number, attachmentId: number, fileName: string) =>
    ipcRenderer.invoke('save-task-attachment', taskId, attachmentId, fileName),
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

  // Voice input (docs/voice-input.md): one listening session at a time, run in main.
  voice: {
    availability: (force?: boolean) => ipcRenderer.invoke('voice:availability', force),
    start: (options?: { locale?: string }) => ipcRenderer.invoke('voice:start', options),
    stop: (sessionId?: number) => ipcRenderer.invoke('voice:stop', sessionId),
    cancel: (sessionId?: number) => ipcRenderer.invoke('voice:cancel', sessionId),
    onEvent: (cb: (envelope: VoiceEventEnvelope) => void) => {
      const handler = (_: unknown, envelope: VoiceEventEnvelope) => cb(envelope)
      ipcRenderer.on('voice:event', handler)
      return () => { ipcRenderer.removeListener('voice:event', handler) }
    },
  },

  // The AI assistant (docs/ai-assistant-v1.md). Provider requests run in main, where the key is;
  // a window can save or remove the key, never read it.
  ai: {
    getSettings: () => ipcRenderer.invoke('ai:get-settings'),
    saveSettings: (patch: AiSettingsPatch) => ipcRenderer.invoke('ai:save-settings', patch),
    setKey: (key: string | null) => ipcRenderer.invoke('ai:set-key', key),
    listModels: () => ipcRenderer.invoke('ai:list-models'),
    testConnection: (model: string) => ipcRenderer.invoke('ai:test-connection', model),
    dictate: (input: { requestId: string; edit: boolean; user: string; brainDump?: boolean }) => ipcRenderer.invoke('ai:dictate', input),
    cancelDictation: (requestId: string) => ipcRenderer.invoke('ai:cancel-dictation', requestId),
    organize: (input: { requestId: string; user: string }) => ipcRenderer.invoke('ai:organize', input),
    askStart: (request: AskTurnRequest) => ipcRenderer.invoke('ai:ask-start', request),
    askCancel: (turnId: string) => ipcRenderer.invoke('ai:ask-cancel', turnId),
    onAskEvent: (cb: (envelope: AskTurnEnvelope) => void) => {
      const handler = (_: unknown, envelope: AskTurnEnvelope) => cb(envelope)
      ipcRenderer.on('ai:ask-event', handler)
      return () => { ipcRenderer.removeListener('ai:ask-event', handler) }
    },
    getConversations: () => ipcRenderer.invoke('ai:get-conversations'),
    saveConversations: (list: unknown) => ipcRenderer.invoke('ai:save-conversations', list),
    getKeptTranscripts: () => ipcRenderer.invoke('ai:get-kept-transcripts'),
    keepTranscript: (entry: KeptTranscript) => ipcRenderer.invoke('ai:keep-transcript', entry),
    dropKeptTranscript: (id: string) => ipcRenderer.invoke('ai:drop-kept-transcript', id),
  },

  // Local speech (docs/ai-assistant-v1.md section 3): one recording at a time, run in main.
  speech: {
    status: () => ipcRenderer.invoke('speech:status'),
    download: (id: string) => ipcRenderer.invoke('speech:download', id),
    cancelDownload: (id: string) => ipcRenderer.invoke('speech:cancel-download', id),
    deleteModel: (id: string) => ipcRenderer.invoke('speech:delete-model', id),
    start: (options: SpeechStartOptions) => ipcRenderer.invoke('speech:start', options),
    audio: (sessionId: number, samples: Float32Array) => ipcRenderer.invoke('speech:audio', sessionId, samples),
    stop: (sessionId: number) => ipcRenderer.invoke('speech:stop', sessionId),
    cancel: (sessionId: number) => ipcRenderer.invoke('speech:cancel', sessionId),
    onEvent: (cb: (envelope: SpeechEventEnvelope) => void) => {
      const handler = (_: unknown, envelope: SpeechEventEnvelope) => cb(envelope)
      ipcRenderer.on('speech:event', handler)
      return () => { ipcRenderer.removeListener('speech:event', handler) }
    },
    onDownloadProgress: (cb: (progress: SpeechDownloadProgress) => void) => {
      const handler = (_: unknown, progress: SpeechDownloadProgress) => cb(progress)
      ipcRenderer.on('speech:download-progress', handler)
      return () => { ipcRenderer.removeListener('speech:download-progress', handler) }
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
  // View > Refresh (Mod+R): read the page again from the server.
  onRefreshView: (cb: () => void) => {
    const handler = () => cb()
    ipcRenderer.on('refresh-view', handler)
    return () => { ipcRenderer.removeListener('refresh-view', handler) }
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
