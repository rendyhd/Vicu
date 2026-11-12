import type {
  Task,
  TaskAttachment,
  Project,
  ProjectView,
  Label,
  CreateTaskPayload,
  UpdateTaskPayload,
  CreateProjectPayload,
  UpdateProjectPayload,
  CreateLabelPayload,
  UpdateLabelPayload,
  TaskQueryParams,
  ApiResult,
  AppConfig,
  ConnectionConfig,
  OIDCProvider,
  ServerAuthInfo,
  PasswordLoginResult,
  VikunjaUser,
  AuthCheckResult,
  CustomList,
  CustomListSyncStatus,
  UnsyncedDocuments,
  PersonRef,
  ProjectShares,
  TaskComment,
  TaskCommentPage,
} from '../renderer/lib/vikunja-types'
import type { TaskPatch } from '../shared/merge-patches'
import type { CalendarEventsResult, CalendarFeedView } from '../shared/calendar-events'
import type {
  AddCalendarLinkInput,
  CaldavDiscoverInput,
  CaldavDraft,
  CaldavSaveInput,
  CalendarConnectionView,
  CalendarSourcesView,
} from '../shared/calendar-sources'
import type { CalendarAccountProvider, OAuthClientsView, OwnOAuthClientInput } from '../shared/calendar-accounts'
import type { IcsImportPreview } from '../shared/ics-import'
import type { EventKitFoundCalendar, EventKitSaveInput, EventKitStatusView } from '../shared/calendar-eventkit'
import type { SavedFilterImportOutcome, SavedFilterPreview, SavedFilterState } from '../shared/saved-filter-import'
import type { SyncedPrefsSnapshot } from '../shared/synced-prefs'
import type { ArchiveRecords } from '../shared/pro/ledger'
import type { ProLedgerOperation, ProLedgerSnapshot } from '../shared/pro/ledger-ipc'
import type {
  OfflineCreateInput,
  OfflineCreateResult,
  OfflineEnqueueResult,
  OfflineLabelRef,
  OfflineQueueChange,
  OfflineQueueResult,
  OfflineQueueSnapshot,
  OfflineReplayEvent,
  QueuedCommentReply,
  QueuedWriteReply,
  TaskWriteOptions,
} from '../shared/offline-queue-types'
import type { VoiceAvailability, VoiceEventEnvelope, VoiceStartResult } from '../shared/voice-types'
import type {
  AiResult,
  AiSettingsPatch,
  AiSettingsView,
  AskTurnEnvelope,
  AskTurnRequest,
  ConnectionTestResult,
  KeptTranscript,
  SpeechDownloadProgress,
  SpeechEventEnvelope,
  SpeechStartOptions,
  SpeechStatus,
  StoredConversation,
} from '../shared/ai/types'

type OidcLoginResult =
  | { success: true }
  | { success: false; error: string; totpRequired?: boolean; passkeyUnavailable?: boolean; cancelled?: boolean }

export interface UpdateStatus {
  available: boolean
  currentVersion: string
  latestVersion: string
  releaseUrl: string
  releaseNotes: string
}

export interface ElectronAPI {
  platform: 'darwin' | 'win32' | 'linux'
  /** 'mica' when the main window has Mica behind it (Windows 11 22H2+). */
  windowMaterial: 'mica' | 'none'

  // Tasks
  fetchTasks(params: TaskQueryParams): Promise<ApiResult<Task[]>>
  /** The routine carrier tasks (hidden done tasks), found without listing every done task. */
  fetchRoutineCarriers(): Promise<ApiResult<Task[]>>
  /** The signed-in user's id, asked from the server once when not known yet; null when it cannot be told. */
  getOwnUserId(): Promise<number | null>
  createTask(projectId: number, task: CreateTaskPayload): Promise<ApiResult<Task>>
  /** With `options.queue` the answer may be `QueuedWriteReply`: the change was queued instead of sent. */
  updateTask(id: number, task: UpdateTaskPayload, options?: TaskWriteOptions): Promise<ApiResult<Task> | QueuedWriteReply>
  deleteTask(id: number, options?: TaskWriteOptions): Promise<ApiResult<void> | QueuedWriteReply>
  fetchTaskById(id: number): Promise<ApiResult<Task>>
  patchTaskJson(id: number, operations: ReadonlyArray<Record<string, unknown>>): Promise<ApiResult<Task>>
  createTaskRelation(taskId: number, otherTaskId: number, relationKind: string): Promise<ApiResult<unknown>>
  deleteTaskRelation(taskId: number, relationKind: string, otherTaskId: number): Promise<ApiResult<void>>

  // Collaboration (docs/cross-app-semantics-v1.md section 9)
  /** Everyone who can see the project: owner, direct shares, team members, parent shares. */
  searchProjectUsers(projectId: number): Promise<ApiResult<PersonRef[]>>
  fetchProjectShares(projectId: number): Promise<ApiResult<ProjectShares>>
  /** Exact username, or the name or email of someone who made themselves findable. */
  searchUsers(query: string): Promise<ApiResult<PersonRef[]>>
  shareProject(projectId: number, username: string, permission: number): Promise<ApiResult<unknown>>
  updateProjectShare(projectId: number, username: string, permission: number): Promise<ApiResult<unknown>>
  removeProjectShare(projectId: number, username: string): Promise<ApiResult<void>>
  /** A data URL of the user's avatar. */
  fetchAvatar(username: string, size: number): Promise<ApiResult<string>>
  /** Pro's "after": `taskId` waits on `otherTaskId` (a `blocked` relation), queued offline. */
  addAfter(taskId: number, otherTaskId: number, options?: TaskWriteOptions): Promise<ApiResult<unknown> | QueuedWriteReply>
  removeAfter(taskId: number, otherTaskId: number, options?: TaskWriteOptions): Promise<ApiResult<unknown> | QueuedWriteReply>
  addTaskAssignee(taskId: number, userId: number, options?: TaskWriteOptions): Promise<ApiResult<unknown> | QueuedWriteReply>
  removeTaskAssignee(taskId: number, userId: number, options?: TaskWriteOptions): Promise<ApiResult<void> | QueuedWriteReply>
  /** A page of the thread, newest first, with queued comment changes laid over it. */
  fetchTaskComments(taskId: number, page: number): Promise<ApiResult<TaskCommentPage>>
  createTaskComment(taskId: number, html: string, options?: TaskWriteOptions): Promise<ApiResult<TaskComment> | QueuedCommentReply>
  updateTaskComment(taskId: number, commentId: number, html: string, options?: TaskWriteOptions): Promise<ApiResult<TaskComment> | QueuedWriteReply>
  deleteTaskComment(taskId: number, commentId: number, options?: TaskWriteOptions): Promise<ApiResult<void> | QueuedWriteReply>
  markTaskRead(taskId: number): Promise<ApiResult<unknown>>
  setTaskSubscription(taskId: number, subscribed: boolean): Promise<ApiResult<unknown>>

  // Project views
  fetchProjectViews(projectId: number): Promise<ApiResult<ProjectView[]>>
  fetchViewTasks(projectId: number, viewId: number, params: TaskQueryParams): Promise<ApiResult<Task[]>>
  updateTaskPosition(taskId: number, viewId: number, position: number): Promise<ApiResult<unknown>>

  // Projects
  countProjectTasks(projectId: number, done: boolean): Promise<ApiResult<number>>
  fetchProjects(includeArchived?: boolean): Promise<ApiResult<Project[]>>
  fetchProject(id: number): Promise<ApiResult<Project>>
  createProject(project: CreateProjectPayload): Promise<ApiResult<Project>>
  updateProject(id: number, project: UpdateProjectPayload): Promise<ApiResult<Project>>
  deleteProject(id: number): Promise<ApiResult<void>>

  // Labels
  fetchLabels(): Promise<ApiResult<Label[]>>
  addLabelToTask(taskId: number, labelId: number, options?: TaskWriteOptions): Promise<ApiResult<void> | QueuedWriteReply>
  removeLabelFromTask(taskId: number, labelId: number, options?: TaskWriteOptions): Promise<ApiResult<void> | QueuedWriteReply>
  createLabel(label: CreateLabelPayload): Promise<ApiResult<Label>>
  updateLabel(id: number, label: UpdateLabelPayload): Promise<ApiResult<Label>>
  deleteLabel(id: number): Promise<ApiResult<void>>

  // Config
  getConfig(): Promise<AppConfig | null>
  saveConfigPatch(patch: Partial<AppConfig>): Promise<void>
  saveConnectionConfig(connection: ConnectionConfig): Promise<void>
  getCustomLists(): Promise<CustomList[]>
  upsertCustomList(list: CustomList): Promise<CustomList[]>
  deleteCustomList(id: string): Promise<CustomList[]>
  reorderCustomLists(ids: string[]): Promise<CustomList[]>
  syncCustomLists(): Promise<CustomListSyncStatus>
  getCustomListSyncStatus(): Promise<CustomListSyncStatus>
  getSavedFilterState(): Promise<SavedFilterState>
  previewSavedFilters(ids?: number[]): Promise<SavedFilterPreview[] | null>
  importSavedFilters(ids: number[]): Promise<SavedFilterImportOutcome | null>
  dismissSavedFilters(ids: number[]): Promise<SavedFilterState>
  closeSavedFilterNotice(listId: string): Promise<SavedFilterState>
  onSavedFiltersChanged(cb: (state: SavedFilterState) => void): () => void
  onSavedFiltersImported(cb: (outcome: SavedFilterImportOutcome) => void): () => void
  onCustomListsChanged(cb: (lists: CustomList[]) => void): () => void
  onCustomListSyncStatus(cb: (status: CustomListSyncStatus) => void): () => void
  /** The synced preferences (cross-app semantics 11): every entry's value and the Inbox in use. */
  getSyncedPrefs(): Promise<SyncedPrefsSnapshot>
  /** A choice the user made (`null` resets it to the default on every device). */
  setSyncedPreference(key: string, value: unknown): Promise<SyncedPrefsSnapshot>
  /** Several choices at once: one change and one sync, and nothing written unless every value may be. */
  setSyncedPreferences(values: Record<string, unknown>): Promise<SyncedPrefsSnapshot>
  syncSyncedPrefs(): Promise<CustomListSyncStatus>
  getSyncedPrefsStatus(): Promise<CustomListSyncStatus>
  /** Setup: the account's synced Inbox and Vikunja's default project, read before asking for an Inbox. */
  readSetupPreferences(url: string, token?: string): Promise<{ inboxProjectId: number | null; defaultProjectId: number | null }>
  onSyncedPrefsChanged(cb: (snapshot: SyncedPrefsSnapshot) => void): () => void
  // Pro (cross-app semantics section 21)
  getProLedger(): Promise<ProLedgerSnapshot>
  /** Changes applied by main to its current copy; returns the new snapshot. */
  mutateProLedger(operations: ProLedgerOperation[]): Promise<ProLedgerSnapshot>
  syncProLedger(): Promise<CustomListSyncStatus>
  getProLedgerStatus(): Promise<CustomListSyncStatus>
  /** Every archive part's records, merged (read on demand). */
  readProArchive(): Promise<ArchiveRecords>
  onProLedgerChanged(cb: (snapshot: ProLedgerSnapshot) => void): () => void
  onProLedgerStatus(cb: (status: CustomListSyncStatus) => void): () => void
  /** Puts a plain text and, when given, an HTML version on the clipboard. */
  writeClipboardRich(text: string, html?: string): Promise<boolean>
  onSyncedPrefsStatus(cb: (status: CustomListSyncStatus) => void): () => void
  /** Custom-list and settings changes that have not reached the server, with their sync status. */
  getUnsyncedDocuments(): Promise<UnsyncedDocuments>
  /** Drops those changes; each document goes back to the server's copy. Says which had any. */
  discardUnsyncedDocuments(): Promise<{ customLists: boolean; preferences: boolean }>
  setTaskBadge(count: number, dataUrl: string | null): Promise<void>
  testConnection(url: string, token: string): Promise<ApiResult<Project[]>>

  // Auth
  discoverOidc(url: string): Promise<OIDCProvider[]>
  discoverAuthMethods(url: string): Promise<ServerAuthInfo>
  oidcLogin(url: string, providerKey: string, totpPasscode?: string): Promise<OidcLoginResult>
  oidcBrowserLogin(url: string, providerKey: string, totpPasscode?: string): Promise<OidcLoginResult>
  cancelOidcBrowserLogin(): Promise<void>
  getOidcSignIn(): Promise<{ mode: 'window' | 'browser'; providerKey: string | null }>
  loginPassword(url: string, username: string, password: string, totpPasscode?: string): Promise<PasswordLoginResult>
  getUser(): Promise<VikunjaUser | null>
  checkAuth(): Promise<AuthCheckResult>
  logout(): Promise<void>

  // Notifications
  testNotification(): Promise<void>
  rescheduleNotifications(): Promise<void>
  refreshTaskReminders(): Promise<void>
  refreshRoutineReminders(): Promise<void>

  // Attachments
  fetchTaskAttachments(taskId: number): Promise<ApiResult<TaskAttachment[]>>
  /**
   * With `options.queue` the file waits in the offline queue when the server cannot be reached and
   * the answer is `QueuedWriteReply`; `inline` then puts the image at the end of the notes once uploaded.
   */
  uploadTaskAttachment(taskId: number, fileData: Uint8Array, fileName: string, mimeType: string, options?: TaskWriteOptions & { inline?: boolean }): Promise<ApiResult<unknown> | QueuedWriteReply>
  deleteTaskAttachment(taskId: number, attachmentId: number): Promise<ApiResult<void>>
  fetchTaskAttachmentBytes(taskId: number, attachmentId: number, size?: 'preview' | 'original'): Promise<ApiResult<Uint8Array>>
  openTaskAttachment(taskId: number, attachmentId: number, fileName: string): Promise<ApiResult<void>>
  saveTaskAttachment(taskId: number, attachmentId: number, fileName: string): Promise<ApiResult<{ saved: boolean; path?: string }>>
  /** `queued` names the files kept for later because the server could not be reached. */
  pickAndUploadAttachment(taskId: number): Promise<ApiResult<{ count: number; attachments: unknown[]; queued?: string[]; error?: string }>>

  // Quick Entry/View
  applyQuickEntrySettings(): Promise<{ entry: boolean; viewer: boolean; waylandLimited: boolean }>
  getGlobalShortcutStatus(): Promise<{ entry: boolean; viewer: boolean; waylandLimited: boolean }>
  getSecretStorageStatus(): Promise<'encrypted' | 'obfuscated' | 'plaintext'>
  getLaunchOnStartupSupport(): Promise<{ supported: boolean }>
  getHotkeyLauncherCommand(): Promise<{ quickEntry: string; quickView: string; kind: 'appimage' | 'packaged' | 'dev' }>

  // Offline queue (main process): changes that could not reach the server, replayed in order
  offlineQueue: {
    snapshot(): Promise<OfflineQueueResult<OfflineQueueSnapshot>>
    /** `taskRef` is a real id, a negative temp id, or `pending_<actionId>`; `patch` is a merge patch. */
    enqueueUpdate(taskRef: number | string, patch: TaskPatch, meta?: { title?: string }): Promise<OfflineQueueResult<OfflineEnqueueResult>>
    enqueueComplete(taskRef: number | string, done: boolean, meta?: { title?: string }): Promise<OfflineQueueResult<OfflineEnqueueResult>>
    enqueueDelete(taskRef: number | string, meta?: { title?: string }): Promise<OfflineQueueResult<OfflineEnqueueResult>>
    enqueueCreate(input: OfflineCreateInput): Promise<OfflineQueueResult<OfflineCreateResult>>
    enqueueAddLabel(taskRef: number | string, label: OfflineLabelRef, meta?: { title?: string }): Promise<OfflineQueueResult<OfflineEnqueueResult>>
    enqueueRemoveLabel(taskRef: number | string, labelId: number, meta?: { title?: string }): Promise<OfflineQueueResult<OfflineEnqueueResult>>
    /** Take a queued change back out (undo). `data` is false when nothing could be cancelled. */
    cancelChange(taskRef: number | string, keys: string[]): Promise<OfflineQueueResult<boolean>>
    /** Retry all failed actions, or the given ones (their group comes with them). */
    retryFailed(ids?: string[]): Promise<OfflineQueueResult<number>>
    discardFailed(ids?: string[]): Promise<OfflineQueueResult<number>>
    discardPending(ids: string[]): Promise<OfflineQueueResult<number>>
    /** Replay now. `data` is null when there was nothing to do (empty queue, standalone mode). */
    replayNow(): Promise<OfflineQueueResult<OfflineReplayEvent | null>>
    onChanged(cb: (change: OfflineQueueChange) => void): () => void
    onReplayed(cb: (event: OfflineReplayEvent) => void): () => void
    onAuthProblem(cb: (problem: { error: string }) => void): () => void
  }

  // Voice input (docs/voice-input.md)
  voice: {
    availability(force?: boolean): Promise<VoiceAvailability>
    /** Starts listening; on macOS the first call asks for the microphone. */
    start(options?: { locale?: string }): Promise<VoiceStartResult>
    /** Finish; the final text follows as an event. Without an id: the session still starting. */
    stop(sessionId?: number): Promise<boolean>
    cancel(sessionId?: number): Promise<boolean>
    onEvent(cb: (envelope: VoiceEventEnvelope) => void): () => void
  }

  /**
   * Connected calendars on the Plan screen (contract 20.9). A link or a password can be given,
   * never read back: the windows only get CalendarSourcesView.
   */
  calendar: {
    list(): Promise<CalendarSourcesView>
    events(range: { from: string; to: string }): Promise<CalendarEventsResult>
    /** Add a calendar link (read once to check it). */
    add(input: AddCalendarLinkInput): Promise<ApiResult<CalendarConnectionView>>
    /** Sign in to a CalDAV account and list its calendars; nothing is saved until caldavSave. */
    caldavDiscover(input: CaldavDiscoverInput): Promise<ApiResult<CaldavDraft>>
    caldavSave(draftId: string, input: CaldavSaveInput): Promise<ApiResult<CalendarConnectionView>>
    caldavCancel(draftId: string): Promise<void>
    /** Change one calendar's choices. */
    update(calendarId: string, patch: Partial<Pick<CalendarFeedView, 'name' | 'color' | 'enabled' | 'busyOnly' | 'countsAsBusy'>>): Promise<CalendarSourcesView>
    /** Remove a connection (a link, an account) with its calendars. */
    remove(connectionId: string): Promise<CalendarSourcesView>
    /** Read now: one connection, or every one. */
    refresh(connectionId?: string): Promise<CalendarSourcesView>
    /** Which OAuth client the Microsoft 365 and Google sign-ins use on this device. */
    oauthClients(): Promise<OAuthClientsView>
    /** Save (or with null remove) the own OAuth client of a provider; its secret is never read back. */
    oauthSetClient(provider: CalendarAccountProvider, input: OwnOAuthClientInput | null): Promise<ApiResult<OAuthClientsView>>
    /** Sign in in the system browser and list the account's calendars; picked with caldavSave. */
    oauthSignIn(provider: CalendarAccountProvider): Promise<ApiResult<CaldavDraft>>
    /** Stop waiting for the browser. */
    oauthCancel(): Promise<void>
    /** Sign in again to a connected account whose sign-in the provider no longer takes. */
    oauthReconnect(connectionId: string): Promise<ApiResult<CalendarSourcesView>>
    /** Pick a calendar file and read it into a preview of Events (null when the dialog was cancelled). */
    importFile(): Promise<ApiResult<IcsImportPreview | null>>
    /** The Mac's calendars (EventKit), macOS only; nothing is saved until `save`. */
    eventkit: {
      /** Whether the kind is offered and what macOS allows; never asks. */
      status(): Promise<EventKitStatusView>
      /** Ask for the permission when not asked yet, then list the calendars to pick. */
      discover(): Promise<ApiResult<EventKitFoundCalendar[]>>
      save(input: EventKitSaveInput): Promise<ApiResult<CalendarConnectionView>>
      /** System Settings, Privacy & Security, Calendars. */
      openSettings(): Promise<void>
    }
    /** A background read brought something new: ask for the events again. */
    onChanged(cb: () => void): () => void
  }

  /** The AI assistant (docs/ai-assistant-v1.md). The key can be saved or removed, never read. */
  ai: {
    getSettings(): Promise<AiSettingsView>
    saveSettings(patch: AiSettingsPatch): Promise<AiSettingsView>
    setKey(key: string | null): Promise<AiSettingsView>
    chooseProvider(id: string | null): Promise<AiSettingsView>
    saveAddress(address: string, replacing: boolean): Promise<AiSettingsView>
    useSavedAddress(address: string): Promise<AiSettingsView>
    removeSavedAddress(address: string): Promise<AiSettingsView>
    listModels(): Promise<AiResult<string[]>>
    testConnection(model: string): Promise<AiResult<ConnectionTestResult>>
    /**
     * One dictation request; the answer is checked against the schema (and repaired once) in main.
     * `brainDump`: a brain dump's Organize or Update (4.8) instead.
     */
    dictate(input: { requestId: string; edit: boolean; user: string; brainDump?: boolean }): Promise<AiResult<unknown>>
    cancelDictation(requestId: string): Promise<boolean>
    /**
     * Suggestions for one batch of a guided session (section 9), from Ask's model under Ask's
     * agreement; checked against `organize.answerSchema` in main. Cancelled with `cancelDictation`.
     */
    organize(input: { requestId: string; user: string }): Promise<AiResult<unknown>>
    /** Pro: pasted text to an import (docs/ai-assistant-v1.md 11.1); refused while Pro's assistant is off. Cancelled with `cancelDictation`. */
    proImport(input: { requestId: string; user: string }): Promise<AiResult<unknown>>
    /** Pro: promise drafts from a meeting card's dictation (11.2); refused while Pro's assistant is off. */
    promiseDrafts(input: { requestId: string; user: string }): Promise<AiResult<unknown>>
    /** Plan my day's suggestions (docs/ai-assistant-v1.md section 10). Cancelled with `cancelDictation`. */
    planDay(input: { requestId: string; user: string }): Promise<AiResult<unknown>>
    askStart(request: AskTurnRequest): Promise<boolean>
    askCancel(turnId: string): Promise<boolean>
    onAskEvent(cb: (envelope: AskTurnEnvelope) => void): () => void
    getConversations(): Promise<StoredConversation[]>
    saveConversations(list: StoredConversation[]): Promise<StoredConversation[]>
    getKeptTranscripts(): Promise<KeptTranscript[]>
    keepTranscript(entry: KeptTranscript): Promise<boolean>
    dropKeptTranscript(id: string): Promise<boolean>
  }

  /** Local speech (docs/ai-assistant-v1.md section 3). */
  speech: {
    status(): Promise<SpeechStatus>
    download(id: string): Promise<{ success: boolean; error?: string }>
    cancelDownload(id: string): Promise<boolean>
    deleteModel(id: string): Promise<boolean>
    start(options: SpeechStartOptions): Promise<{ success: true; sessionId: number } | { success: false; error: string; code: 'unavailable' | 'mic-denied' | 'busy' }>
    audio(sessionId: number, samples: Float32Array): Promise<boolean>
    stop(sessionId: number): Promise<boolean>
    cancel(sessionId: number): Promise<boolean>
    onEvent(cb: (envelope: SpeechEventEnvelope) => void): () => void
    onDownloadProgress(cb: (progress: SpeechDownloadProgress) => void): () => void
  }

  // Standalone mode
  getStandaloneTaskCount(): Promise<number>
  uploadStandaloneTasks(projectId: number): Promise<{ success: boolean; uploaded: number; error?: string; totalErrors?: number }>

  // Task completion sound
  pickCompletionSound(): Promise<
    { success: true; path: string; fileName: string } | { success: false; error: string }
  >
  resetCompletionSound(): Promise<void>
  readCompletionSound(): Promise<
    { success: true; data: Uint8Array<ArrayBuffer>; mimeType: string } | { success: false; error: string }
  >
  getCompletionSoundInfo(): Promise<{ path: string; fileName: string; isDefault: boolean }>

  // Obsidian
  openDeepLink(url: string): Promise<void>
  testObsidianConnection(): Promise<{ success: boolean; error?: string; data?: unknown }>

  // Browser Link
  checkBrowserHostRegistration(): Promise<{ chrome: boolean; firefox: boolean }>
  registerBrowserHosts(): Promise<{ chrome: boolean; firefox: boolean }>
  openBrowserExtensionFolder(): Promise<void>

  // Update checker
  checkForUpdate(): Promise<UpdateStatus | null>
  getUpdateStatus(): Promise<UpdateStatus | null>
  dismissUpdate(version: string): Promise<void>
  onUpdateAvailable(cb: (status: UpdateStatus) => void): () => void

  // Window controls
  windowMinimize(): Promise<void>
  windowMaximize(): Promise<void>
  windowClose(): Promise<void>
  windowIsMaximized(): Promise<boolean>
  onWindowMaximizedChange(cb: (maximized: boolean) => void): () => void
  onTasksChanged(cb: () => void): () => void
  onNavigate(cb: (path: string) => void): () => void
  /** Pro: an import pasted in Quick Entry, for the import review (plan 7.1.9). */
  onProOpenImport(cb: (text: string) => void): () => void
  onNavigateToTask(cb: (taskId: number) => void): () => void
  onNewTask(cb: () => void): () => void
  onRefreshView(cb: () => void): () => void
  onAppResumed(cb: () => void): () => void
  /** The locale and clock dates are phrased with (system locale, clock setting). */
  getDateFormat(): Promise<{ locale: string; hour12: boolean }>
  onDateFormatChanged(cb: (format: { locale: string; hour12: boolean }) => void): () => void
  // Print
  printHtml(html: string): Promise<{ success: true } | { success: false; error: string }>
  onPrintView(cb: () => void): () => void
  onAuthRequired(cb: () => void): () => void
}

declare global {
  interface Window {
    api: ElectronAPI
  }
}
