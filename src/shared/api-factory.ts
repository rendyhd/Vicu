import type { ProjectPatch, TaskPatch } from './merge-patches'
import type {
  OfflineCreateInput,
  OfflineLabelRef,
  OfflineReplayEvent,
  TaskWriteOptions,
} from './offline-queue-types'
import type { VoiceEventEnvelope } from './voice-types'
import type { AiSettingsPatch, AskTurnEnvelope, AskTurnRequest, KeptTranscript, SpeechDownloadProgress, SpeechEventEnvelope, SpeechStartOptions } from './ai/types'

// The whole `window.api` object, built over two functions: how to call a channel and how to listen
// to one. The Electron preload passes `ipcRenderer`; the web host (src/web) passes its own
// dispatcher. Both objects have the same shape by construction, so a channel is written once.

export type ApiListener = (...args: any[]) => void

export interface ApiBridge {
  /** Call a channel and wait for its answer. */
  invoke(channel: string, ...args: any[]): Promise<any>
  /** Listen to a channel; the listener gets the payload only. Returns the unsubscribe. */
  on(channel: string, listener: ApiListener): () => void
  /** The operating system, for shortcut labels and platform styling. */
  platform: 'darwin' | 'win32' | 'linux'
  /** 'mica' when the main window has Mica behind it (Windows 11 22H2+; set by main, window-chrome.ts). */
  windowMaterial: 'mica' | 'none'
}

export function createApi(bridge: ApiBridge) {
  const { invoke, on } = bridge
  return {
  platform: bridge.platform,
  /** 'mica' when the main window has Mica behind it (Windows 11 22H2+; set by main, window-chrome.ts). */
  windowMaterial: bridge.windowMaterial,

  // Tasks
  fetchTasks: (params: Record<string, unknown>) =>
    invoke('fetch-tasks', params),
  fetchRoutineCarriers: () =>
    invoke('fetch-routine-carriers'),
  getOwnUserId: () =>
    invoke('account:own-user-id'),
  createTask: (projectId: number, task: Record<string, unknown>) =>
    invoke('create-task', projectId, task),
  // The task writes go through the main process's write gate; `options.queue` says the caller can
  // live with the change being queued (see src/main/offline/task-writes.ts).
  updateTask: (id: number, patch: TaskPatch, options?: TaskWriteOptions) =>
    invoke('update-task', id, patch, options),
  deleteTask: (id: number, options?: TaskWriteOptions) =>
    invoke('delete-task', id, options),
  fetchTaskById: (id: number) =>
    invoke('fetch-task-by-id', id),
  // A routine carrier or archive part write (cross-app semantics 6.8): never queued.
  patchTaskJson: (id: number, operations: ReadonlyArray<Record<string, unknown>>) =>
    invoke('patch-task-json', id, operations),
  createTaskRelation: (taskId: number, otherTaskId: number, relationKind: string) =>
    invoke('create-task-relation', taskId, otherTaskId, relationKind),
  deleteTaskRelation: (taskId: number, relationKind: string, otherTaskId: number) =>
    invoke('delete-task-relation', taskId, relationKind, otherTaskId),

  // Collaboration (docs/cross-app-semantics-v1.md section 9). Assignee and comment changes go
  // through the write gate like the task writes above.
  searchProjectUsers: (projectId: number) =>
    invoke('search-project-users', projectId),
  fetchProjectShares: (projectId: number) =>
    invoke('fetch-project-shares', projectId),
  searchUsers: (query: string) =>
    invoke('search-users', query),
  shareProject: (projectId: number, username: string, permission: number) =>
    invoke('share-project', projectId, username, permission),
  updateProjectShare: (projectId: number, username: string, permission: number) =>
    invoke('update-project-share', projectId, username, permission),
  removeProjectShare: (projectId: number, username: string) =>
    invoke('remove-project-share', projectId, username),
  fetchAvatar: (username: string, size: number) =>
    invoke('fetch-avatar', username, size),
  // Pro's "after" (blocked by), through the write gate and the offline queue.
  addAfter: (taskId: number, otherTaskId: number, options?: TaskWriteOptions) => invoke('pro:add-after', taskId, otherTaskId, options),
  removeAfter: (taskId: number, otherTaskId: number, options?: TaskWriteOptions) => invoke('pro:remove-after', taskId, otherTaskId, options),
  addTaskAssignee: (taskId: number, userId: number, options?: TaskWriteOptions) =>
    invoke('add-task-assignee', taskId, userId, options),
  removeTaskAssignee: (taskId: number, userId: number, options?: TaskWriteOptions) =>
    invoke('remove-task-assignee', taskId, userId, options),
  fetchTaskComments: (taskId: number, page: number) =>
    invoke('fetch-task-comments', taskId, page),
  createTaskComment: (taskId: number, html: string, options?: TaskWriteOptions) =>
    invoke('create-task-comment', taskId, html, options),
  updateTaskComment: (taskId: number, commentId: number, html: string, options?: TaskWriteOptions) =>
    invoke('update-task-comment', taskId, commentId, html, options),
  deleteTaskComment: (taskId: number, commentId: number, options?: TaskWriteOptions) =>
    invoke('delete-task-comment', taskId, commentId, options),
  markTaskRead: (taskId: number) =>
    invoke('mark-task-read', taskId),
  setTaskSubscription: (taskId: number, subscribed: boolean) =>
    invoke('set-task-subscription', taskId, subscribed),

  // Projects
  countProjectTasks: (projectId: number, done: boolean) =>
    invoke('count-project-tasks', projectId, done),
  fetchProjects: (includeArchived = false) =>
    invoke('fetch-projects', includeArchived),
  fetchProject: (id: number) =>
    invoke('fetch-project', id),
  createProject: (project: Record<string, unknown>) =>
    invoke('create-project', project),
  updateProject: (id: number, patch: ProjectPatch) =>
    invoke('update-project', id, patch),
  deleteProject: (id: number) =>
    invoke('delete-project', id),

  // Labels
  fetchLabels: () =>
    invoke('fetch-labels'),
  addLabelToTask: (taskId: number, labelId: number, options?: TaskWriteOptions) =>
    invoke('add-label-to-task', taskId, labelId, options),
  removeLabelFromTask: (taskId: number, labelId: number, options?: TaskWriteOptions) =>
    invoke('remove-label-from-task', taskId, labelId, options),
  createLabel: (label: Record<string, unknown>) =>
    invoke('create-label', label),
  updateLabel: (id: number, label: Record<string, unknown>) =>
    invoke('update-label', id, label),
  deleteLabel: (id: number) =>
    invoke('delete-label', id),

  // Project Views
  fetchProjectViews: (projectId: number) =>
    invoke('fetch-project-views', projectId),
  fetchViewTasks: (projectId: number, viewId: number, params: Record<string, unknown>) =>
    invoke('fetch-view-tasks', projectId, viewId, params),
  updateTaskPosition: (taskId: number, viewId: number, position: number) =>
    invoke('update-task-position', taskId, viewId, position),

  // Config
  getConfig: () =>
    invoke('get-config'),
  saveConfigPatch: (patch: Record<string, unknown>) =>
    invoke('save-config-patch', patch),
  saveConnectionConfig: (connection: Record<string, unknown>) =>
    invoke('save-connection-config', connection),
  getCustomLists: () => invoke('custom-lists:get'),
  upsertCustomList: (list: Record<string, unknown>) => invoke('custom-lists:upsert', list),
  deleteCustomList: (id: string) => invoke('custom-lists:delete', id),
  reorderCustomLists: (ids: string[]) => invoke('custom-lists:reorder', ids),
  syncCustomLists: () => invoke('custom-lists:sync'),
  getSyncedPrefs: () => invoke('synced-prefs:get'),
  setSyncedPreference: (key: string, value: unknown) => invoke('synced-prefs:set', key, value),
  setSyncedPreferences: (values: Record<string, unknown>) => invoke('synced-prefs:set-many', values),
  syncSyncedPrefs: () => invoke('synced-prefs:sync'),
  getSyncedPrefsStatus: () => invoke('synced-prefs:status'),
  readSetupPreferences: (url: string, token?: string) => invoke('synced-prefs:read-for-setup', url, token),
  onSyncedPrefsChanged: (cb: (snapshot: unknown) => void) => {
    return on('synced-prefs-changed', cb as ApiListener)
  },
  onSyncedPrefsStatus: (cb: (status: unknown) => void) => {
    return on('synced-prefs-sync-status', cb as ApiListener)
  },
  getCustomListSyncStatus: () => invoke('custom-lists:status'),
  // Pro (cross-app semantics section 21)
  getProLedger: () => invoke('pro-ledger:get'),
  mutateProLedger: (operations: unknown[]) => invoke('pro-ledger:mutate', operations),
  ensurePerson: (name: string) => invoke('pro:ensure-person', name),
  syncProLedger: () => invoke('pro-ledger:sync'),
  getProLedgerStatus: () => invoke('pro-ledger:status'),
  readProArchive: () => invoke('pro-ledger:archive'),
  onProLedgerChanged: (cb: (snapshot: unknown) => void) => {
    return on('pro-ledger-changed', cb as ApiListener)
  },
  onProLedgerStatus: (cb: (status: unknown) => void) => {
    return on('pro-ledger-sync-status', cb as ApiListener)
  },
  writeClipboardRich: (text: string, html?: string) => invoke('clipboard:write-rich', text, html),
  writeClipboardImage: (bytes: Uint8Array) => invoke('clipboard:write-image', bytes),
  getSavedFilterState: () => invoke('saved-filters:state'),
  previewSavedFilters: (ids?: number[]) => invoke('saved-filters:preview', ids),
  previewProjectViews: () => invoke('saved-filters:preview-views'),
  applySavedFilterImport: (request: { add: string[]; answers: Array<{ key: string; answer: string }> }) =>
    invoke('saved-filters:apply', request),
  undoSavedFilterImport: (undoId: string) => invoke('saved-filters:undo', undoId),
  dismissSavedFilters: (ids: number[], changed?: number[]) => invoke('saved-filters:dismiss', ids, changed),
  closeSavedFilterNotice: (listId: string) => invoke('saved-filters:close-notice', listId),
  onSavedFiltersChanged: (cb: (state: unknown) => void) => {
    return on('saved-filters-changed', cb as ApiListener)
  },
  onSavedFiltersImported: (cb: (outcome: unknown) => void) => {
    return on('saved-filters-imported', cb as ApiListener)
  },
  getUnsyncedDocuments: () => invoke('synced-documents:unsynced'),
  discardUnsyncedDocuments: () => invoke('synced-documents:discard'),
  onCustomListsChanged: (cb: (lists: unknown[]) => void) => {
    return on('custom-lists-changed', cb as ApiListener)
  },
  onCustomListSyncStatus: (cb: (status: unknown) => void) => {
    return on('custom-list-sync-status', cb as ApiListener)
  },

  // Badge
  setTaskBadge: (count: number, dataUrl: string | null) =>
    invoke('set-task-badge', count, dataUrl),
  openBadgeNotificationSettings: () => invoke('open-badge-notification-settings'),

  // Connection test
  testConnection: (url: string, token: string) =>
    invoke('test-connection', url, token),

  // Auth
  discoverOidc: (url: string) =>
    invoke('auth:discover-oidc', url),
  discoverAuthMethods: (url: string) =>
    invoke('auth:discover-methods', url),
  oidcLogin: (url: string, providerKey: string, totpPasscode?: string) =>
    invoke('auth:login-oidc', url, providerKey, totpPasscode),
  oidcBrowserLogin: (url: string, providerKey: string, totpPasscode?: string) =>
    invoke('auth:login-oidc-browser', url, providerKey, totpPasscode),
  cancelOidcBrowserLogin: () =>
    invoke('auth:cancel-oidc-browser'),
  getOidcSignIn: () =>
    invoke('auth:oidc-sign-in'),
  loginPassword: (url: string, username: string, password: string, totpPasscode?: string) =>
    invoke('auth:login-password', url, username, password, totpPasscode),
  getUser: () =>
    invoke('auth:get-user'),
  checkAuth: () =>
    invoke('auth:check'),
  logout: () =>
    invoke('auth:logout'),

  // Notifications
  testNotification: () =>
    invoke('notifications:test'),
  rescheduleNotifications: () =>
    invoke('notifications:reschedule'),
  refreshTaskReminders: () =>
    invoke('notifications:refresh-task-reminders'),
  refreshRoutineReminders: () =>
    invoke('notifications:refresh-routine-reminders'),

  // Attachments
  fetchTaskAttachments: (taskId: number) =>
    invoke('fetch-task-attachments', taskId),
  uploadTaskAttachment: (taskId: number, fileData: Uint8Array, fileName: string, mimeType: string, options?: unknown) =>
    invoke('upload-task-attachment', taskId, fileData, fileName, mimeType, options),
  deleteTaskAttachment: (taskId: number, attachmentId: number) =>
    invoke('delete-task-attachment', taskId, attachmentId),
  fetchTaskAttachmentBytes: (taskId: number, attachmentId: number, size?: 'preview' | 'original') =>
    invoke('fetch-task-attachment-bytes', taskId, attachmentId, size),
  openTaskAttachment: (taskId: number, attachmentId: number, fileName: string) =>
    invoke('open-task-attachment', taskId, attachmentId, fileName),
  saveTaskAttachment: (taskId: number, attachmentId: number, fileName: string) =>
    invoke('save-task-attachment', taskId, attachmentId, fileName),
  pickAndUploadAttachment: (taskId: number) =>
    invoke('pick-and-upload-attachment', taskId),
  pickAttachmentFiles: () => invoke('pick-attachment-files'),
  uploadPickedAttachment: (taskId: number, token: string) =>
    invoke('upload-picked-attachment', taskId, token),

  // Obsidian
  openDeepLink: (url: string) => invoke('open-deep-link', url),
  testObsidianConnection: () => invoke('test-obsidian-connection'),

  // Browser Link
  checkBrowserHostRegistration: () => invoke('check-browser-host-registration'),
  registerBrowserHosts: () => invoke('register-browser-hosts'),
  openBrowserExtensionFolder: () => invoke('open-browser-extension-folder'),

  // Quick Entry settings
  applyQuickEntrySettings: () =>
    invoke('apply-quick-entry-settings') as Promise<{ entry: boolean; viewer: boolean; waylandLimited: boolean }>,
  getGlobalShortcutStatus: () =>
    invoke('get-global-shortcut-status') as Promise<{ entry: boolean; viewer: boolean; waylandLimited: boolean }>,
  getSecretStorageStatus: () =>
    invoke('get-secret-storage-status') as Promise<'encrypted' | 'obfuscated' | 'plaintext'>,
  getLaunchOnStartupSupport: () =>
    invoke('get-launch-on-startup-support') as Promise<{ supported: boolean }>,
  getHotkeyLauncherCommand: () =>
    invoke('get-hotkey-launcher-command') as Promise<{ quickEntry: string; quickView: string; kind: 'appimage' | 'packaged' | 'dev' }>,

  // Locale and clock for dates (src/shared/date-display.ts); changes when the clock setting does.
  getDateFormat: () => invoke('get-date-format'),
  onDateFormatChanged: (callback: (format: { locale: string; hour12: boolean }) => void) => {
    return on('date-format-changed', callback as ApiListener)
  },

  // The language the app shows (src/shared/i18n); changes when the Language setting does.
  getLanguage: () => invoke('get-language'),
  onLanguageChanged: (callback: (info: { language: string; system: string }) => void) => {
    return on('language-changed', callback as ApiListener)
  },

  // The computer woke from sleep: timers and the clock may have jumped while it was asleep.
  onAppResumed: (callback: () => void) => {
    return on('app-resumed', callback as ApiListener)
  },

  // Offline queue: changes that could not reach the server wait here, in the main process, and are
  // replayed in order. Every call answers `{ success, data | error }`.
  offlineQueue: {
    snapshot: () => invoke('offline-queue:snapshot'),
    enqueueUpdate: (taskRef: number | string, patch: TaskPatch, meta?: { title?: string }) =>
      invoke('offline-queue:enqueue-update', taskRef, patch, meta),
    enqueueComplete: (taskRef: number | string, done: boolean, meta?: { title?: string }) =>
      invoke('offline-queue:enqueue-complete', taskRef, done, meta),
    enqueueDelete: (taskRef: number | string, meta?: { title?: string }) =>
      invoke('offline-queue:enqueue-delete', taskRef, meta),
    enqueueCreate: (input: OfflineCreateInput) =>
      invoke('offline-queue:enqueue-create', input),
    enqueueAddLabel: (taskRef: number | string, label: OfflineLabelRef, meta?: { title?: string }) =>
      invoke('offline-queue:enqueue-add-label', taskRef, label, meta),
    enqueueRemoveLabel: (taskRef: number | string, labelId: number, meta?: { title?: string }) =>
      invoke('offline-queue:enqueue-remove-label', taskRef, labelId, meta),
    cancelChange: (taskRef: number | string, keys: string[]) =>
      invoke('offline-queue:cancel-change', taskRef, keys),
    retryFailed: (ids?: string[]) => invoke('offline-queue:retry-failed', ids),
    discardFailed: (ids?: string[]) => invoke('offline-queue:discard-failed', ids),
    discardPending: (ids: string[]) => invoke('offline-queue:discard-pending', ids),
    replayNow: () => invoke('offline-queue:replay-now'),
    onChanged: (cb: (change: unknown) => void) => {
      return on('offline-queue:changed', cb as ApiListener)
    },
    onReplayed: (cb: (event: OfflineReplayEvent) => void) => {
      return on('offline-queue:replayed', cb as ApiListener)
    },
    onAuthProblem: (cb: (problem: { error: string }) => void) => {
      return on('offline-queue:auth-problem', cb as ApiListener)
    },
  },

  // Voice input (docs/voice-input.md): one listening session at a time, run in main.
  voice: {
    availability: (force?: boolean) => invoke('voice:availability', force),
    start: (options?: { locale?: string }) => invoke('voice:start', options),
    stop: (sessionId?: number) => invoke('voice:stop', sessionId),
    cancel: (sessionId?: number) => invoke('voice:cancel', sessionId),
    onEvent: (cb: (envelope: VoiceEventEnvelope) => void) => {
      return on('voice:event', cb as ApiListener)
    },
  },

  // Calendars on the Plan screen (proof of concept). The links are secrets: a window can add one,
  // never read it back.
  calendar: {
    list: () => invoke('calendar:list'),
    events: (range: { from: string; to: string }) => invoke('calendar:events', range),
    add: (input: { name: string; url: string; busyOnly?: boolean }) => invoke('calendar:add', input),
    caldavDiscover: (input: unknown) => invoke('calendar:caldav-discover', input),
    caldavSave: (draftId: string, input: { shown: string[]; busyOnly?: boolean }) => invoke('calendar:caldav-save', draftId, input),
    caldavCancel: (draftId: string) => invoke('calendar:caldav-cancel', draftId),
    update: (id: string, patch: Record<string, unknown>) => invoke('calendar:update', id, patch),
    remove: (id: string) => invoke('calendar:remove', id),
    refresh: (connectionId?: string) => invoke('calendar:refresh', connectionId),
    // Microsoft 365 and Google: the tokens stay in main; the pick of calendars uses caldavSave.
    oauthClients: () => invoke('calendar:oauth-clients'),
    oauthSetClient: (provider: string, input: { clientId: string; clientSecret?: string } | null) => invoke('calendar:oauth-set-client', provider, input),
    oauthSignIn: (provider: string) => invoke('calendar:oauth-sign-in', provider),
    oauthCancel: () => invoke('calendar:oauth-cancel'),
    oauthReconnect: (connectionId: string) => invoke('calendar:oauth-reconnect', connectionId),
    importFile: () => invoke('calendar:import-file'),
    // A calendar file on this computer: the main process asks for the file.
    addFile: (input: { name?: string; busyOnly?: boolean }) => invoke('calendar:file-add', input),
    // Classic Outlook on this PC (Windows); its calendars are picked with caldavSave.
    outlook: {
      status: () => invoke('calendar:outlook-status'),
      discover: () => invoke('calendar:outlook-discover'),
    },
    // The Mac's calendars (EventKit), macOS only.
    eventkit: {
      status: () => invoke('calendar:eventkit-status'),
      discover: () => invoke('calendar:eventkit-discover'),
      save: (input: { shown: string[]; busyOnly?: boolean }) => invoke('calendar:eventkit-save', input),
      openSettings: () => invoke('calendar:eventkit-open-settings'),
    },
    onChanged: (cb: () => void) => {
      return on('calendar-changed', cb as ApiListener)
    },
  },

  // The AI assistant (docs/ai-assistant-v1.md). Provider requests run in main, where the key is;
  // a window can save or remove the key, never read it.
  ai: {
    getSettings: () => invoke('ai:get-settings'),
    saveSettings: (patch: AiSettingsPatch) => invoke('ai:save-settings', patch),
    setKey: (key: string | null) => invoke('ai:set-key', key),
    chooseProvider: (id: string | null) => invoke('ai:choose-provider', id),
    saveAddress: (address: string, replacing: boolean) => invoke('ai:save-address', { address, replacing }),
    useSavedAddress: (address: string) => invoke('ai:use-saved-address', address),
    removeSavedAddress: (address: string) => invoke('ai:remove-saved-address', address),
    listModels: () => invoke('ai:list-models'),
    testConnection: (model: string) => invoke('ai:test-connection', model),
    dictate: (input: { requestId: string; edit: boolean; user: string; brainDump?: boolean; notes?: boolean }) => invoke('ai:dictate', input),
    readPage: (input: { requestId: string; image: { media_type: string; data: string }; page: number; pages: number; title: string }) => invoke('ai:read-page', input),
    testVision: (model: string) => invoke('ai:test-vision', model),
    cancelDictation: (requestId: string) => invoke('ai:cancel-dictation', requestId),
    planDay: (input: { requestId: string; user: string }) => invoke('ai:plan-day', input),
    organize: (input: { requestId: string; user: string }) => invoke('ai:organize', input),
    proImport: (input: { requestId: string; user: string }) => invoke('ai:pro-import', input),
    promiseDrafts: (input: { requestId: string; user: string }) => invoke('ai:promise-drafts', input),
    askStart: (request: AskTurnRequest) => invoke('ai:ask-start', request),
    askCancel: (turnId: string) => invoke('ai:ask-cancel', turnId),
    onAskEvent: (cb: (envelope: AskTurnEnvelope) => void) => {
      return on('ai:ask-event', cb as ApiListener)
    },
    getConversations: () => invoke('ai:get-conversations'),
    saveConversations: (list: unknown) => invoke('ai:save-conversations', list),
    getKeptTranscripts: () => invoke('ai:get-kept-transcripts'),
    keepTranscript: (entry: KeptTranscript) => invoke('ai:keep-transcript', entry),
    dropKeptTranscript: (id: string) => invoke('ai:drop-kept-transcript', id),
  },

  // Notes to tasks (docs/ai-assistant-v1.md 4.9): files from main's open dialog, the open notes kept.
  notes: {
    pickFiles: () => invoke('notes:pick-files'),
    getSession: () => invoke('notes:session-get'),
    saveSession: (session: unknown) => invoke('notes:session-save', session),
    clearSession: () => invoke('notes:session-clear'),
  },

  // Local speech (docs/ai-assistant-v1.md section 3): one recording at a time, run in main.
  speech: {
    status: () => invoke('speech:status'),
    download: (id: string) => invoke('speech:download', id),
    cancelDownload: (id: string) => invoke('speech:cancel-download', id),
    deleteModel: (id: string) => invoke('speech:delete-model', id),
    start: (options: SpeechStartOptions) => invoke('speech:start', options),
    audio: (sessionId: number, samples: Float32Array) => invoke('speech:audio', sessionId, samples),
    stop: (sessionId: number) => invoke('speech:stop', sessionId),
    cancel: (sessionId: number) => invoke('speech:cancel', sessionId),
    onEvent: (cb: (envelope: SpeechEventEnvelope) => void) => {
      return on('speech:event', cb as ApiListener)
    },
    onDownloadProgress: (cb: (progress: SpeechDownloadProgress) => void) => {
      return on('speech:download-progress', cb as ApiListener)
    },
  },

  // Standalone mode
  getStandaloneTaskCount: () =>
    invoke('qe:get-standalone-task-count') as Promise<number>,
  uploadStandaloneTasks: (projectId: number) =>
    invoke('qe:upload-standalone-tasks', projectId) as Promise<
      { success: boolean; uploaded: number; error?: string; totalErrors?: number }
    >,

  // Task completion sound
  pickCompletionSound: () =>
    invoke('sound:pick') as Promise<
      { success: true; path: string; fileName: string } | { success: false; error: string }
    >,
  resetCompletionSound: () =>
    invoke('sound:reset') as Promise<void>,
  readCompletionSound: () =>
    invoke('sound:read') as Promise<
      { success: true; data: Uint8Array<ArrayBuffer>; mimeType: string } | { success: false; error: string }
    >,
  getCompletionSoundInfo: () =>
    invoke('sound:get-info') as Promise<{ path: string; fileName: string; isDefault: boolean }>,

  // Update checker
  checkForUpdate: () => invoke('update:check'),
  getUpdateStatus: () => invoke('update:get-status'),
  dismissUpdate: (version: string) => invoke('update:dismiss', version),
  onUpdateAvailable: (cb: (status: unknown) => void) => {
    return on('update-available', cb as ApiListener)
  },

  // Window controls
  windowMinimize: () => invoke('window-minimize'),
  windowMaximize: () => invoke('window-maximize'),
  windowClose: () => invoke('window-close'),
  windowIsMaximized: () => invoke('window-is-maximized') as Promise<boolean>,
  onWindowMaximizedChange: (cb: (maximized: boolean) => void) => {
    return on('window-maximized-change', cb as ApiListener)
  },
  onTasksChanged: (cb: () => void) => {
    return on('tasks-changed', cb as ApiListener)
  },
  onNavigate: (cb: (path: string) => void) => {
    return on('navigate', cb as ApiListener)
  },
  onProOpenImport: (cb: (text: string) => void) => {
    return on('pro:open-import', cb as ApiListener)
  },
  // File > New Task (Ctrl+N). The menu accelerator takes the key before the page sees it.
  onNewTask: (cb: () => void) => {
    return on('new-task', cb as ApiListener)
  },
  // View > Refresh (Mod+R): read the page again from the server.
  onRefreshView: (cb: () => void) => {
    return on('refresh-view', cb as ApiListener)
  },
  // Main asks the window to show one task (a clicked reminder, Quick View's "open in app").
  onNavigateToTask: (cb: (taskId: number) => void) => {
    return on('navigate-to-task', cb as ApiListener)
  },
  // Print
  printHtml: (html: string) =>
    invoke('print-html', html),
  onPrintView: (cb: () => void) => {
    return on('print-view', cb as ApiListener)
  },
  onAuthRequired: (cb: () => void) => {
    return on('auth-required', cb as ApiListener)
  },
}
}

export type VicuApi = ReturnType<typeof createApi>
