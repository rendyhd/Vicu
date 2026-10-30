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
  PersonRef,
  ProjectShares,
  TaskComment,
  TaskCommentPage,
} from './vikunja-types'
import type { TaskPatch } from './merge-patches'
import type { JsonPatchOperation } from '../../shared/routines'
import type { SyncedPrefsSnapshot } from '../../shared/synced-prefs'
import type { OidcSignInMode } from '../../shared/oidc-browser'
import { withCollabSignals } from './collab-signals'
import { announceAccountChanged } from './account-events'
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
} from '../../shared/offline-queue-types'

export type {
  OIDCProvider,
  ServerAuthInfo,
  PasswordLoginResult,
  VikunjaUser,
  AuthCheckResult,
}

export type OidcLoginResult =
  | { success: true }
  | {
      success: false
      error: string
      totpRequired?: boolean
      /** The provider asked for a passkey, which the sign-in window cannot use: sign in in the browser. */
      passkeyUnavailable?: boolean
      /** The browser sign-in was cancelled in Vicu. */
      cancelled?: boolean
    }

function queueOptions(title?: string): TaskWriteOptions {
  return title ? { queue: true, title } : { queue: true }
}

export const api = {
  fetchTasks: (params: TaskQueryParams) =>
    window.api.fetchTasks(withCollabSignals(params)) as Promise<ApiResult<Task[]>>,

  fetchRoutineCarriers: () =>
    window.api.fetchRoutineCarriers() as Promise<ApiResult<Task[]>>,

  /** Who is signed in: hidden tasks (routine archive parts) are only ever this user's (contract 10.3). */
  ownUserId: () => window.api.getOwnUserId(),

  createTask: (projectId: number, task: CreateTaskPayload) =>
    window.api.createTask(projectId, task) as Promise<ApiResult<Task>>,

  // The task writes below need the server's answer. When changes for the task are still waiting in
  // the offline queue they are refused instead of being sent around them. The `...OrQueue` variants
  // are for edits that can be queued: the main process queues them behind waiting changes, or when
  // the server cannot be reached, and answers `{ success: true, queued: true }`.
  updateTask: (id: number, task: UpdateTaskPayload) =>
    window.api.updateTask(id, task) as Promise<ApiResult<Task>>,

  updateTaskOrQueue: (id: number, task: UpdateTaskPayload, title?: string) =>
    window.api.updateTask(id, task, queueOptions(title)) as Promise<ApiResult<Task> | QueuedWriteReply>,

  deleteTask: (id: number) =>
    window.api.deleteTask(id) as Promise<ApiResult<void>>,

  deleteTaskOrQueue: (id: number, title?: string) =>
    window.api.deleteTask(id, queueOptions(title)) as Promise<ApiResult<void> | QueuedWriteReply>,

  fetchTaskById: (id: number) =>
    window.api.fetchTaskById(id) as Promise<ApiResult<Task>>,

  /** A JSON Patch of a routine carrier or archive part; a 422 (`statusCode`) means it changed since it was read. */
  patchTaskJson: (id: number, operations: ReadonlyArray<JsonPatchOperation>) =>
    window.api.patchTaskJson(id, operations as unknown as ReadonlyArray<Record<string, unknown>>) as Promise<ApiResult<Task> & { statusCode?: number }>,

  createTaskRelation: (taskId: number, otherTaskId: number, relationKind: string) =>
    window.api.createTaskRelation(taskId, otherTaskId, relationKind) as Promise<ApiResult<unknown>>,

  deleteTaskRelation: (taskId: number, relationKind: string, otherTaskId: number) =>
    window.api.deleteTaskRelation(taskId, relationKind, otherTaskId) as Promise<ApiResult<void>>,

  fetchProjectViews: (projectId: number) =>
    window.api.fetchProjectViews(projectId) as Promise<ApiResult<ProjectView[]>>,

  fetchViewTasks: (projectId: number, viewId: number, params: TaskQueryParams) =>
    window.api.fetchViewTasks(projectId, viewId, withCollabSignals(params)) as Promise<ApiResult<Task[]>>,

  // Collaboration (docs/cross-app-semantics-v1.md section 9)
  searchProjectUsers: (projectId: number) =>
    window.api.searchProjectUsers(projectId) as Promise<ApiResult<PersonRef[]>>,

  fetchProjectShares: (projectId: number) =>
    window.api.fetchProjectShares(projectId) as Promise<ApiResult<ProjectShares>>,

  searchUsers: (query: string) =>
    window.api.searchUsers(query) as Promise<ApiResult<PersonRef[]>>,

  shareProject: (projectId: number, username: string, permission: number) =>
    window.api.shareProject(projectId, username, permission) as Promise<ApiResult<unknown>>,

  updateProjectShare: (projectId: number, username: string, permission: number) =>
    window.api.updateProjectShare(projectId, username, permission) as Promise<ApiResult<unknown>>,

  removeProjectShare: (projectId: number, username: string) =>
    window.api.removeProjectShare(projectId, username) as Promise<ApiResult<void>>,

  fetchAvatar: (username: string, size: number) =>
    window.api.fetchAvatar(username, size) as Promise<ApiResult<string>>,

  addTaskAssigneeOrQueue: (taskId: number, user: PersonRef, taskTitle?: string) =>
    window.api.addTaskAssignee(taskId, user.id, { ...queueOptions(taskTitle), username: user.username }) as Promise<
      ApiResult<unknown> | QueuedWriteReply
    >,

  removeTaskAssigneeOrQueue: (taskId: number, user: PersonRef, taskTitle?: string) =>
    window.api.removeTaskAssignee(taskId, user.id, { ...queueOptions(taskTitle), username: user.username }) as Promise<
      ApiResult<void> | QueuedWriteReply
    >,

  fetchTaskComments: (taskId: number, page: number) =>
    window.api.fetchTaskComments(taskId, page) as Promise<ApiResult<TaskCommentPage>>,

  createTaskCommentOrQueue: (taskId: number, html: string, taskTitle?: string) =>
    window.api.createTaskComment(taskId, html, queueOptions(taskTitle)) as Promise<ApiResult<TaskComment> | QueuedCommentReply>,

  updateTaskCommentOrQueue: (taskId: number, commentId: number, html: string, taskTitle?: string) =>
    window.api.updateTaskComment(taskId, commentId, html, queueOptions(taskTitle)) as Promise<ApiResult<TaskComment> | QueuedWriteReply>,

  deleteTaskCommentOrQueue: (taskId: number, commentId: number, taskTitle?: string) =>
    window.api.deleteTaskComment(taskId, commentId, queueOptions(taskTitle)) as Promise<ApiResult<void> | QueuedWriteReply>,

  markTaskRead: (taskId: number) =>
    window.api.markTaskRead(taskId) as Promise<ApiResult<unknown>>,

  setTaskSubscription: (taskId: number, subscribed: boolean) =>
    window.api.setTaskSubscription(taskId, subscribed) as Promise<ApiResult<unknown>>,

  updateTaskPosition: (taskId: number, viewId: number, position: number) =>
    window.api.updateTaskPosition(taskId, viewId, position) as Promise<ApiResult<unknown>>,

  /** Tasks of a project that are done (or open), hidden carriers excluded; cached in main for ten minutes. */
  countProjectTasks: (projectId: number, done: boolean) =>
    window.api.countProjectTasks(projectId, done) as Promise<ApiResult<number>>,

  fetchProjects: (includeArchived = false) =>
    window.api.fetchProjects(includeArchived) as Promise<ApiResult<Project[]>>,

  fetchProject: (id: number) =>
    window.api.fetchProject(id) as Promise<ApiResult<Project>>,

  createProject: (project: CreateProjectPayload) =>
    window.api.createProject(project) as Promise<ApiResult<Project>>,

  updateProject: (id: number, project: UpdateProjectPayload) =>
    window.api.updateProject(id, project) as Promise<ApiResult<Project>>,

  deleteProject: (id: number) =>
    window.api.deleteProject(id) as Promise<ApiResult<void>>,

  fetchLabels: () =>
    window.api.fetchLabels() as Promise<ApiResult<Label[]>>,

  addLabelToTask: (taskId: number, labelId: number) =>
    window.api.addLabelToTask(taskId, labelId) as Promise<ApiResult<void>>,

  addLabelToTaskOrQueue: (taskId: number, label: { id: number; title?: string }, taskTitle?: string) =>
    window.api.addLabelToTask(taskId, label.id, {
      ...queueOptions(taskTitle),
      ...(label.title ? { labelTitle: label.title } : {}),
    }) as Promise<ApiResult<void> | QueuedWriteReply>,

  removeLabelFromTask: (taskId: number, labelId: number) =>
    window.api.removeLabelFromTask(taskId, labelId) as Promise<ApiResult<void>>,

  removeLabelFromTaskOrQueue: (taskId: number, labelId: number, taskTitle?: string) =>
    window.api.removeLabelFromTask(taskId, labelId, queueOptions(taskTitle)) as Promise<ApiResult<void> | QueuedWriteReply>,

  createLabel: (label: CreateLabelPayload) =>
    window.api.createLabel(label) as Promise<ApiResult<Label>>,

  updateLabel: (id: number, label: UpdateLabelPayload) =>
    window.api.updateLabel(id, label) as Promise<ApiResult<Label>>,

  deleteLabel: (id: number) =>
    window.api.deleteLabel(id) as Promise<ApiResult<void>>,

  caldav: {
    connections: () => window.api.caldav.connections(),
    discover: (input: import('../../shared/caldav-types').CalDavConnectionInput) => window.api.caldav.discover(input),
    select: (id: string, calendars: import('../../shared/caldav-types').CalDavCalendar[]) => window.api.caldav.select(id, calendars),
    remove: (id: string) => window.api.caldav.remove(id),
    events: (start: string, end: string) => window.api.caldav.events(start, end),
    update: (input: import('../../shared/caldav-types').CalDavEventUpdate) => window.api.caldav.update(input),
  },

  getConfig: () =>
    window.api.getConfig() as Promise<AppConfig | null>,

  saveConfigPatch: (patch: Partial<AppConfig>) =>
    window.api.saveConfigPatch(patch) as Promise<void>,

  saveConnectionConfig: async (connection: ConnectionConfig) => {
    await window.api.saveConnectionConfig(connection)
    // A login or a disconnect: lists cached for the previous account must not carry over.
    announceAccountChanged()
  },

  getCustomLists: () => window.api.getCustomLists(),
  upsertCustomList: (list: import('./vikunja-types').CustomList) => window.api.upsertCustomList(list),
  deleteCustomList: (id: string) => window.api.deleteCustomList(id),
  reorderCustomLists: (ids: string[]) => window.api.reorderCustomLists(ids),
  /** The synced preferences (cross-app semantics 11): every entry's value and the Inbox in use. */
  getSyncedPrefs: () => window.api.getSyncedPrefs(),
  /** A choice the user made; `null` resets it to the default on every device. */
  setSyncedPreference: (key: string, value: unknown) => window.api.setSyncedPreference(key, value),
  /** Several choices at once (one change, one sync); `null` resets a key. */
  setSyncedPreferences: (values: Record<string, unknown>) => window.api.setSyncedPreferences(values),
  syncSyncedPrefs: () => window.api.syncSyncedPrefs(),
  onSyncedPrefsChanged: (cb: (snapshot: SyncedPrefsSnapshot) => void) => window.api.onSyncedPrefsChanged(cb),
  /** Setup: the account's synced Inbox and Vikunja's default project, before the Inbox is asked for. */
  readSetupPreferences: (url: string, token?: string) => window.api.readSetupPreferences(url, token),
  syncCustomLists: () => window.api.syncCustomLists(),
  getCustomListSyncStatus: () => window.api.getCustomListSyncStatus(),
  getUnsyncedDocuments: () => window.api.getUnsyncedDocuments(),
  discardUnsyncedDocuments: () => window.api.discardUnsyncedDocuments(),
  onSyncedPrefsStatus: (cb: (status: import('./vikunja-types').CustomListSyncStatus) => void) =>
    window.api.onSyncedPrefsStatus(cb),
  onCustomListsChanged: (cb: (lists: import('./vikunja-types').CustomList[]) => void) =>
    window.api.onCustomListsChanged(cb),
  onCustomListSyncStatus: (cb: (status: import('./vikunja-types').CustomListSyncStatus) => void) =>
    window.api.onCustomListSyncStatus(cb),

  setTaskBadge: (count: number, dataUrl: string | null) =>
    window.api.setTaskBadge(count, dataUrl) as Promise<void>,

  testConnection: (url: string, token: string) =>
    window.api.testConnection(url, token) as Promise<ApiResult<Project[]>>,

  discoverOidc: (url: string) =>
    window.api.discoverOidc(url) as Promise<OIDCProvider[]>,

  discoverAuthMethods: (url: string) =>
    window.api.discoverAuthMethods(url) as Promise<ServerAuthInfo>,

  oidcLogin: (url: string, providerKey: string, totpPasscode?: string) =>
    window.api.oidcLogin(url, providerKey, totpPasscode) as Promise<OidcLoginResult>,

  oidcBrowserLogin: (url: string, providerKey: string, totpPasscode?: string) =>
    window.api.oidcBrowserLogin(url, providerKey, totpPasscode) as Promise<OidcLoginResult>,

  cancelOidcBrowserLogin: () => window.api.cancelOidcBrowserLogin(),

  /** How the last OIDC sign-in ran and with which provider, so signing in again starts the same way. */
  getOidcSignIn: () => window.api.getOidcSignIn() as Promise<{ mode: OidcSignInMode; providerKey: string | null }>,

  loginPassword: (url: string, username: string, password: string, totpPasscode?: string) =>
    window.api.loginPassword(url, username, password, totpPasscode) as Promise<PasswordLoginResult>,

  getUser: () =>
    window.api.getUser() as Promise<VikunjaUser | null>,

  checkAuth: () =>
    window.api.checkAuth() as Promise<AuthCheckResult>,

  logout: () =>
    window.api.logout() as Promise<void>,

  testNotification: () =>
    window.api.testNotification() as Promise<void>,

  rescheduleNotifications: () =>
    window.api.rescheduleNotifications() as Promise<void>,

  refreshTaskReminders: () =>
    window.api.refreshTaskReminders() as Promise<void>,

  refreshRoutineReminders: () =>
    window.api.refreshRoutineReminders() as Promise<void>,

  applyQuickEntrySettings: () =>
    window.api.applyQuickEntrySettings() as Promise<{ entry: boolean; viewer: boolean; waylandLimited: boolean }>,

  getGlobalShortcutStatus: () =>
    window.api.getGlobalShortcutStatus() as Promise<{ entry: boolean; viewer: boolean; waylandLimited: boolean }>,
  getSecretStorageStatus: () =>
    window.api.getSecretStorageStatus() as Promise<'encrypted' | 'obfuscated' | 'plaintext'>,
  getLaunchOnStartupSupport: () =>
    window.api.getLaunchOnStartupSupport() as Promise<{ supported: boolean }>,

  getHotkeyLauncherCommand: () =>
    window.api.getHotkeyLauncherCommand() as Promise<{ quickEntry: string; quickView: string; kind: 'appimage' | 'packaged' | 'dev' }>,

  getStandaloneTaskCount: () =>
    window.api.getStandaloneTaskCount() as Promise<number>,

  uploadStandaloneTasks: (projectId: number) =>
    window.api.uploadStandaloneTasks(projectId) as Promise<
      { success: boolean; uploaded: number; error?: string; totalErrors?: number }
    >,

  pickCompletionSound: () =>
    window.api.pickCompletionSound() as Promise<
      { success: true; path: string; fileName: string } | { success: false; error: string }
    >,

  resetCompletionSound: () =>
    window.api.resetCompletionSound() as Promise<void>,

  readCompletionSound: () =>
    window.api.readCompletionSound() as Promise<
      { success: true; data: Uint8Array<ArrayBuffer>; mimeType: string } | { success: false; error: string }
    >,

  getCompletionSoundInfo: () =>
    window.api.getCompletionSoundInfo() as Promise<{ path: string; fileName: string; isDefault: boolean }>,

  // Attachments
  fetchTaskAttachments: (taskId: number) =>
    window.api.fetchTaskAttachments(taskId) as Promise<ApiResult<TaskAttachment[]>>,
  uploadTaskAttachment: (taskId: number, fileData: Uint8Array, fileName: string, mimeType: string) =>
    window.api.uploadTaskAttachment(taskId, fileData, fileName, mimeType) as Promise<ApiResult<unknown>>,
  deleteTaskAttachment: (taskId: number, attachmentId: number) =>
    window.api.deleteTaskAttachment(taskId, attachmentId) as Promise<ApiResult<void>>,
  fetchTaskAttachmentBytes: (taskId: number, attachmentId: number) =>
    window.api.fetchTaskAttachmentBytes(taskId, attachmentId) as Promise<ApiResult<Uint8Array>>,
  openTaskAttachment: (taskId: number, attachmentId: number, fileName: string) =>
    window.api.openTaskAttachment(taskId, attachmentId, fileName) as Promise<ApiResult<void>>,
  saveTaskAttachment: (taskId: number, attachmentId: number, fileName: string) =>
    window.api.saveTaskAttachment(taskId, attachmentId, fileName) as Promise<ApiResult<{ saved: boolean; path?: string }>>,
  pickAndUploadAttachment: (taskId: number) =>
    window.api.pickAndUploadAttachment(taskId) as Promise<ApiResult<{ count: number }>>,

  // Offline queue (main process). Changes that fail for network or server reasons are queued here
  // and replayed in order; see src/main/offline/ and src/shared/offline-queue-types.ts.
  offlineQueue: {
    snapshot: () => window.api.offlineQueue.snapshot() as Promise<OfflineQueueResult<OfflineQueueSnapshot>>,
    enqueueUpdate: (taskRef: number | string, patch: TaskPatch, meta?: { title?: string }) =>
      window.api.offlineQueue.enqueueUpdate(taskRef, patch, meta) as Promise<OfflineQueueResult<OfflineEnqueueResult>>,
    enqueueComplete: (taskRef: number | string, done: boolean, meta?: { title?: string }) =>
      window.api.offlineQueue.enqueueComplete(taskRef, done, meta) as Promise<OfflineQueueResult<OfflineEnqueueResult>>,
    enqueueDelete: (taskRef: number | string, meta?: { title?: string }) =>
      window.api.offlineQueue.enqueueDelete(taskRef, meta) as Promise<OfflineQueueResult<OfflineEnqueueResult>>,
    enqueueCreate: (input: OfflineCreateInput) =>
      window.api.offlineQueue.enqueueCreate(input) as Promise<OfflineQueueResult<OfflineCreateResult>>,
    enqueueAddLabel: (taskRef: number | string, label: OfflineLabelRef, meta?: { title?: string }) =>
      window.api.offlineQueue.enqueueAddLabel(taskRef, label, meta) as Promise<OfflineQueueResult<OfflineEnqueueResult>>,
    enqueueRemoveLabel: (taskRef: number | string, labelId: number, meta?: { title?: string }) =>
      window.api.offlineQueue.enqueueRemoveLabel(taskRef, labelId, meta) as Promise<OfflineQueueResult<OfflineEnqueueResult>>,
    cancelChange: (taskRef: number | string, keys: string[]) =>
      window.api.offlineQueue.cancelChange(taskRef, keys) as Promise<OfflineQueueResult<boolean>>,
    retryFailed: (ids?: string[]) => window.api.offlineQueue.retryFailed(ids) as Promise<OfflineQueueResult<number>>,
    discardFailed: (ids?: string[]) => window.api.offlineQueue.discardFailed(ids) as Promise<OfflineQueueResult<number>>,
    discardPending: (ids: string[]) => window.api.offlineQueue.discardPending(ids) as Promise<OfflineQueueResult<number>>,
    replayNow: () => window.api.offlineQueue.replayNow() as Promise<OfflineQueueResult<OfflineReplayEvent | null>>,
    onChanged: (cb: (change: OfflineQueueChange) => void) =>
      window.api.offlineQueue?.onChanged(cb) ?? (() => {}),
    onReplayed: (cb: (event: OfflineReplayEvent) => void) =>
      window.api.offlineQueue?.onReplayed(cb) ?? (() => {}),
    onAuthProblem: (cb: (problem: { error: string }) => void) =>
      window.api.offlineQueue?.onAuthProblem(cb) ?? (() => {}),
  },

  // Window controls
  windowMinimize: () => window.api.windowMinimize(),
  windowMaximize: () => window.api.windowMaximize(),
  windowClose: () => window.api.windowClose(),
  windowIsMaximized: () => window.api.windowIsMaximized(),
  onWindowMaximizedChange: (cb: (maximized: boolean) => void) =>
    window.api.onWindowMaximizedChange(cb),
  onTasksChanged: (cb: () => void) =>
    window.api.onTasksChanged?.(cb) ?? (() => {}),
  onNavigate: (cb: (path: string) => void) =>
    window.api.onNavigate?.(cb) ?? (() => {}),

  onNavigateToTask: (cb: (taskId: number) => void) =>
    window.api.onNavigateToTask?.(cb) ?? (() => {}),

  onNewTask: (cb: () => void) =>
    window.api.onNewTask?.(cb) ?? (() => {}),
  onRefreshView: (cb: () => void) =>
    window.api.onRefreshView?.(cb) ?? (() => {}),
  onAppResumed: (cb: () => void) =>
    window.api.onAppResumed?.(cb) ?? (() => {}),
  printHtml: (html: string) =>
    window.api.printHtml(html) as Promise<{ success: true } | { success: false; error: string }>,
  onPrintView: (cb: () => void) =>
    window.api.onPrintView(cb),

  // Update checker
  checkForUpdate: () =>
    window.api.checkForUpdate(),
  getUpdateStatus: () =>
    window.api.getUpdateStatus(),
  dismissUpdate: (version: string) =>
    window.api.dismissUpdate(version),
  onUpdateAvailable: (cb: (status: { available: boolean; currentVersion: string; latestVersion: string; releaseUrl: string; releaseNotes: string }) => void) =>
    window.api.onUpdateAvailable(cb),
  onAuthRequired: (cb: () => void) =>
    window.api.onAuthRequired?.(cb) ?? (() => {}),
}
