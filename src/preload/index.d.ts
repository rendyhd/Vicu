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
  OIDCProvider,
  ServerAuthInfo,
  PasswordLoginResult,
  VikunjaUser,
  AuthCheckResult,
} from '../renderer/lib/vikunja-types'

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
  createTask(projectId: number, task: CreateTaskPayload): Promise<ApiResult<Task>>
  updateTask(id: number, task: UpdateTaskPayload): Promise<ApiResult<Task>>
  deleteTask(id: number): Promise<ApiResult<void>>
  fetchTaskById(id: number): Promise<ApiResult<Task>>
  createTaskRelation(taskId: number, otherTaskId: number, relationKind: string): Promise<ApiResult<unknown>>
  deleteTaskRelation(taskId: number, relationKind: string, otherTaskId: number): Promise<ApiResult<void>>

  // Project views
  fetchProjectViews(projectId: number): Promise<ApiResult<ProjectView[]>>
  fetchViewTasks(projectId: number, viewId: number, params: TaskQueryParams): Promise<ApiResult<Task[]>>
  updateTaskPosition(taskId: number, viewId: number, position: number): Promise<ApiResult<unknown>>

  // Projects
  fetchProjects(): Promise<ApiResult<Project[]>>
  createProject(project: CreateProjectPayload): Promise<ApiResult<Project>>
  updateProject(id: number, project: UpdateProjectPayload): Promise<ApiResult<Project>>
  deleteProject(id: number): Promise<ApiResult<void>>

  // Labels
  fetchLabels(): Promise<ApiResult<Label[]>>
  addLabelToTask(taskId: number, labelId: number): Promise<ApiResult<void>>
  removeLabelFromTask(taskId: number, labelId: number): Promise<ApiResult<void>>
  createLabel(label: CreateLabelPayload): Promise<ApiResult<Label>>
  updateLabel(id: number, label: UpdateLabelPayload): Promise<ApiResult<Label>>
  deleteLabel(id: number): Promise<ApiResult<void>>

  // Config
  getConfig(): Promise<AppConfig | null>
  saveConfig(config: AppConfig): Promise<void>
  setTaskBadge(count: number, dataUrl: string | null): Promise<void>
  testConnection(url: string, token: string): Promise<ApiResult<Project[]>>

  // Auth
  discoverOidc(url: string): Promise<OIDCProvider[]>
  discoverAuthMethods(url: string): Promise<ServerAuthInfo>
  oidcLogin(url: string, providerKey: string): Promise<ApiResult<void>>
  loginPassword(url: string, username: string, password: string, totpPasscode?: string): Promise<PasswordLoginResult>
  getUser(): Promise<VikunjaUser | null>
  checkAuth(): Promise<AuthCheckResult>
  logout(): Promise<void>

  // Notifications
  testNotification(): Promise<void>
  rescheduleNotifications(): Promise<void>
  refreshTaskReminders(): Promise<void>

  // Attachments
  fetchTaskAttachments(taskId: number): Promise<ApiResult<TaskAttachment[]>>
  uploadTaskAttachment(taskId: number, fileData: Uint8Array, fileName: string, mimeType: string): Promise<ApiResult<unknown>>
  deleteTaskAttachment(taskId: number, attachmentId: number): Promise<ApiResult<void>>
  fetchTaskAttachmentBytes(taskId: number, attachmentId: number): Promise<ApiResult<Uint8Array>>
  openTaskAttachment(taskId: number, attachmentId: number, fileName: string): Promise<ApiResult<void>>
  pickAndUploadAttachment(taskId: number): Promise<ApiResult<{ count: number }>>

  // Quick Entry/View
  applyQuickEntrySettings(): Promise<{ entry: boolean; viewer: boolean }>

  // Obsidian
  openDeepLink(url: string): Promise<void>
  testObsidianConnection(): Promise<{ success: boolean; error?: string; data?: unknown }>

  // Browser Link
  checkBrowserHostRegistration(): Promise<{ chrome: boolean; firefox: boolean }>
  registerBrowserHosts(): Promise<{ chrome: boolean; firefox: boolean }>
  getBrowserExtensionPath(): Promise<string>
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
  onAuthRequired(cb: () => void): () => void
}

declare global {
  interface Window {
    api: ElectronAPI
  }
}
