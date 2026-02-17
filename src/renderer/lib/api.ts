import type {
  Task,
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

  oidcLogin: (url: string, providerKey: string) =>
    window.api.oidcLogin(url, providerKey) as Promise<ApiResult<void>>,

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

  // Window controls
  windowMinimize: () => window.api.windowMinimize(),
  windowMaximize: () => window.api.windowMaximize(),
  windowClose: () => window.api.windowClose(),
  windowIsMaximized: () => window.api.windowIsMaximized(),
  onWindowMaximizedChange: (cb: (maximized: boolean) => void) =>
    window.api.onWindowMaximizedChange(cb),
  onTasksChanged: (cb: () => void) =>
    window.api.onTasksChanged?.(cb) ?? (() => {}),
}
