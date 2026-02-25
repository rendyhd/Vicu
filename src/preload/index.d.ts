import type {
  Task,
  Project,
  ProjectView,
  Label,
  CreateTaskPayload,
  UpdateTaskPayload,
  CreateProjectPayload,
  TaskQueryParams,
  ApiResult,
  AppConfig,
} from '../renderer/lib/vikunja-types'

export interface OIDCProvider {
  name: string
  key: string
  auth_url: string
  client_id: string
  scope: string
}

export interface UpdateStatus {
  available: boolean
  currentVersion: string
  latestVersion: string
  releaseUrl: string
  releaseNotes: string
}

export interface ElectronAPI {
  platform: 'darwin' | 'win32' | 'linux'
  fetchTasks(params: TaskQueryParams): Promise<ApiResult<Task[]>>
  createTask(projectId: number, task: CreateTaskPayload): Promise<ApiResult<Task>>
  updateTask(id: number, task: UpdateTaskPayload): Promise<ApiResult<Task>>
  deleteTask(id: number): Promise<ApiResult<void>>
  fetchTaskById(id: number): Promise<ApiResult<Task>>
  createTaskRelation(taskId: number, otherTaskId: number, relationKind: string): Promise<ApiResult<unknown>>
  deleteTaskRelation(taskId: number, relationKind: string, otherTaskId: number): Promise<ApiResult<void>>
  fetchProjectViews(projectId: number): Promise<ApiResult<ProjectView[]>>
  fetchViewTasks(projectId: number, viewId: number, params: TaskQueryParams): Promise<ApiResult<Task[]>>
  updateTaskPosition(taskId: number, viewId: number, position: number): Promise<ApiResult<unknown>>
  fetchProjects(): Promise<ApiResult<Project[]>>
  createProject(project: CreateProjectPayload): Promise<ApiResult<Project>>
  fetchLabels(): Promise<ApiResult<Label[]>>
  addLabelToTask(taskId: number, labelId: number): Promise<ApiResult<void>>
  removeLabelFromTask(taskId: number, labelId: number): Promise<ApiResult<void>>
  getConfig(): Promise<AppConfig | null>
  saveConfig(config: AppConfig): Promise<void>
  testConnection(url: string, token: string): Promise<ApiResult<Project[]>>
  discoverOidc(url: string): Promise<OIDCProvider[]>
  oidcLogin(url: string, providerKey: string): Promise<ApiResult<void>>
  checkAuth(): Promise<boolean>
  logout(): Promise<void>
  testNotification(): Promise<void>
  rescheduleNotifications(): Promise<void>
  refreshTaskReminders(): Promise<void>
  applyQuickEntrySettings(): Promise<void>

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
}

declare global {
  interface Window {
    api: ElectronAPI
  }
}
