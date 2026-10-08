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
} from '../renderer/lib/vikunja-types'
import type { TaskPatch } from '../shared/merge-patches'
import type {
  OfflineCreateInput,
  OfflineCreateResult,
  OfflineEnqueueResult,
  OfflineLabelRef,
  OfflineQueueChange,
  OfflineQueueResult,
  OfflineQueueSnapshot,
  OfflineReplayEvent,
  QueuedWriteReply,
  TaskWriteOptions,
} from '../shared/offline-queue-types'

type OidcLoginResult =
  | { success: true }
  | { success: false; error: string; totpRequired?: boolean }

export interface UpdateStatus {
  available: boolean
  currentVersion: string
  latestVersion: string
  releaseUrl: string
  releaseNotes: string
}

export interface ElectronAPI {
  platform: 'darwin' | 'win32' | 'linux'

  // Tasks
  fetchTasks(params: TaskQueryParams): Promise<ApiResult<Task[]>>
  /** The routine carrier tasks (hidden done tasks), found without listing every done task. */
  fetchRoutineCarriers(): Promise<ApiResult<Task[]>>
  createTask(projectId: number, task: CreateTaskPayload): Promise<ApiResult<Task>>
  /** With `options.queue` the answer may be `QueuedWriteReply`: the change was queued instead of sent. */
  updateTask(id: number, task: UpdateTaskPayload, options?: TaskWriteOptions): Promise<ApiResult<Task> | QueuedWriteReply>
  deleteTask(id: number, options?: TaskWriteOptions): Promise<ApiResult<void> | QueuedWriteReply>
  fetchTaskById(id: number): Promise<ApiResult<Task>>
  createTaskRelation(taskId: number, otherTaskId: number, relationKind: string): Promise<ApiResult<unknown>>
  deleteTaskRelation(taskId: number, relationKind: string, otherTaskId: number): Promise<ApiResult<void>>

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
  onCustomListsChanged(cb: (lists: CustomList[]) => void): () => void
  onCustomListSyncStatus(cb: (status: CustomListSyncStatus) => void): () => void
  setTaskBadge(count: number, dataUrl: string | null): Promise<void>
  testConnection(url: string, token: string): Promise<ApiResult<Project[]>>

  // Auth
  discoverOidc(url: string): Promise<OIDCProvider[]>
  discoverAuthMethods(url: string): Promise<ServerAuthInfo>
  oidcLogin(url: string, providerKey: string, totpPasscode?: string): Promise<OidcLoginResult>
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
  uploadTaskAttachment(taskId: number, fileData: Uint8Array, fileName: string, mimeType: string): Promise<ApiResult<unknown>>
  deleteTaskAttachment(taskId: number, attachmentId: number): Promise<ApiResult<void>>
  fetchTaskAttachmentBytes(taskId: number, attachmentId: number): Promise<ApiResult<Uint8Array>>
  openTaskAttachment(taskId: number, attachmentId: number, fileName: string): Promise<ApiResult<void>>
  pickAndUploadAttachment(taskId: number): Promise<ApiResult<{ count: number }>>

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
  onNavigateToTask(cb: (taskId: number) => void): () => void
  onNewTask(cb: () => void): () => void
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
