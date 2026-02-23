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
} from './vikunja-types'

export interface OIDCProvider {
  name: string
  key: string
  auth_url: string
  client_id: string
  scope: string
}

export interface ServerAuthInfo {
  local_enabled: boolean
  oidc_enabled: boolean
  oidc_providers: OIDCProvider[]
  totp_enabled: boolean
}

export type PasswordLoginResult =
  | { success: true; token: string }
  | { success: false; error: string; totpRequired?: boolean }

export interface VikunjaUser {
  id: number
  username: string
  email: string
  name: string
}

export const api = {
  fetchTasks: (params: TaskQueryParams) =>
    window.api.fetchTasks(params) as Promise<ApiResult<Task[]>>,

  createTask: (projectId: number, task: CreateTaskPayload) =>
    window.api.createTask(projectId, task) as Promise<ApiResult<Task>>,

  updateTask: (id: number, task: UpdateTaskPayload) =>
    window.api.updateTask(id, task) as Promise<ApiResult<Task>>,

  deleteTask: (id: number) =>
    window.api.deleteTask(id) as Promise<ApiResult<void>>,

  fetchTaskById: (id: number) =>
    window.api.fetchTaskById(id) as Promise<ApiResult<Task>>,

  createTaskRelation: (taskId: number, otherTaskId: number, relationKind: string) =>
    window.api.createTaskRelation(taskId, otherTaskId, relationKind) as Promise<ApiResult<unknown>>,

  deleteTaskRelation: (taskId: number, relationKind: string, otherTaskId: number) =>
    window.api.deleteTaskRelation(taskId, relationKind, otherTaskId) as Promise<ApiResult<void>>,

  fetchProjectViews: (projectId: number) =>
    window.api.fetchProjectViews(projectId) as Promise<ApiResult<ProjectView[]>>,

  fetchViewTasks: (projectId: number, viewId: number, params: TaskQueryParams) =>
    window.api.fetchViewTasks(projectId, viewId, params) as Promise<ApiResult<Task[]>>,

  updateTaskPosition: (taskId: number, viewId: number, position: number) =>
    window.api.updateTaskPosition(taskId, viewId, position) as Promise<ApiResult<unknown>>,

  fetchProjects: () =>
    window.api.fetchProjects() as Promise<ApiResult<Project[]>>,

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

  removeLabelFromTask: (taskId: number, labelId: number) =>
    window.api.removeLabelFromTask(taskId, labelId) as Promise<ApiResult<void>>,

  createLabel: (label: CreateLabelPayload) =>
    window.api.createLabel(label) as Promise<ApiResult<Label>>,

  updateLabel: (id: number, label: UpdateLabelPayload) =>
    window.api.updateLabel(id, label) as Promise<ApiResult<Label>>,

  deleteLabel: (id: number) =>
    window.api.deleteLabel(id) as Promise<ApiResult<void>>,

  getConfig: () =>
    window.api.getConfig() as Promise<AppConfig | null>,

  saveConfig: (config: AppConfig) =>
    window.api.saveConfig(config) as Promise<void>,

  testConnection: (url: string, token: string) =>
    window.api.testConnection(url, token) as Promise<ApiResult<Project[]>>,

  discoverOidc: (url: string) =>
    window.api.discoverOidc(url) as Promise<OIDCProvider[]>,

  discoverAuthMethods: (url: string) =>
    window.api.discoverAuthMethods(url) as Promise<ServerAuthInfo>,

  oidcLogin: (url: string, providerKey: string) =>
    window.api.oidcLogin(url, providerKey) as Promise<ApiResult<void>>,

  loginPassword: (url: string, username: string, password: string, totpPasscode?: string) =>
    window.api.loginPassword(url, username, password, totpPasscode) as Promise<PasswordLoginResult>,

  getUser: () =>
    window.api.getUser() as Promise<VikunjaUser | null>,

  checkAuth: () =>
    window.api.checkAuth() as Promise<boolean>,

  logout: () =>
    window.api.logout() as Promise<void>,

  testNotification: () =>
    window.api.testNotification() as Promise<void>,

  rescheduleNotifications: () =>
    window.api.rescheduleNotifications() as Promise<void>,

  refreshTaskReminders: () =>
    window.api.refreshTaskReminders() as Promise<void>,

  applyQuickEntrySettings: () =>
    window.api.applyQuickEntrySettings() as Promise<{ entry: boolean; viewer: boolean }>,

  // Attachments
  fetchTaskAttachments: (taskId: number) =>
    window.api.fetchTaskAttachments(taskId) as Promise<ApiResult<TaskAttachment[]>>,
  uploadTaskAttachment: (taskId: number, fileData: Uint8Array, fileName: string, mimeType: string) =>
    window.api.uploadTaskAttachment(taskId, fileData, fileName, mimeType) as Promise<ApiResult<unknown>>,
  deleteTaskAttachment: (taskId: number, attachmentId: number) =>
    window.api.deleteTaskAttachment(taskId, attachmentId) as Promise<ApiResult<void>>,
  openTaskAttachment: (taskId: number, attachmentId: number, fileName: string) =>
    window.api.openTaskAttachment(taskId, attachmentId, fileName) as Promise<ApiResult<void>>,
  pickAndUploadAttachment: (taskId: number) =>
    window.api.pickAndUploadAttachment(taskId) as Promise<ApiResult<{ count: number }>>,

  // Window controls
  windowMinimize: () => window.api.windowMinimize(),
  windowMaximize: () => window.api.windowMaximize(),
  windowClose: () => window.api.windowClose(),
  windowIsMaximized: () => window.api.windowIsMaximized(),
  onWindowMaximizedChange: (cb: (maximized: boolean) => void) =>
    window.api.onWindowMaximizedChange(cb),
  onTasksChanged: (cb: () => void) =>
    window.api.onTasksChanged?.(cb) ?? (() => {}),

  // Update checker
  checkForUpdate: () =>
    window.api.checkForUpdate(),
  getUpdateStatus: () =>
    window.api.getUpdateStatus(),
  dismissUpdate: (version: string) =>
    window.api.dismissUpdate(version),
  onUpdateAvailable: (cb: (status: { available: boolean; currentVersion: string; latestVersion: string; releaseUrl: string; releaseNotes: string }) => void) =>
    window.api.onUpdateAvailable(cb),
}
