import { contextBridge, ipcRenderer } from 'electron'

const api = {
  // Tasks
  fetchTasks: (params: Record<string, unknown>) =>
    ipcRenderer.invoke('fetch-tasks', params),
  createTask: (projectId: number, task: Record<string, unknown>) =>
    ipcRenderer.invoke('create-task', projectId, task),
  updateTask: (id: number, task: Record<string, unknown>) =>
    ipcRenderer.invoke('update-task', id, task),
  deleteTask: (id: number) =>
    ipcRenderer.invoke('delete-task', id),
  fetchTaskById: (id: number) =>
    ipcRenderer.invoke('fetch-task-by-id', id),
  createTaskRelation: (taskId: number, otherTaskId: number, relationKind: string) =>
    ipcRenderer.invoke('create-task-relation', taskId, otherTaskId, relationKind),
  deleteTaskRelation: (taskId: number, relationKind: string, otherTaskId: number) =>
    ipcRenderer.invoke('delete-task-relation', taskId, relationKind, otherTaskId),

  // Projects
  fetchProjects: () =>
    ipcRenderer.invoke('fetch-projects'),
  createProject: (project: Record<string, unknown>) =>
    ipcRenderer.invoke('create-project', project),
  updateProject: (id: number, project: Record<string, unknown>) =>
    ipcRenderer.invoke('update-project', id, project),
  deleteProject: (id: number) =>
    ipcRenderer.invoke('delete-project', id),

  // Labels
  fetchLabels: () =>
    ipcRenderer.invoke('fetch-labels'),
  addLabelToTask: (taskId: number, labelId: number) =>
    ipcRenderer.invoke('add-label-to-task', taskId, labelId),
  removeLabelFromTask: (taskId: number, labelId: number) =>
    ipcRenderer.invoke('remove-label-from-task', taskId, labelId),
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
  saveConfig: (config: Record<string, unknown>) =>
    ipcRenderer.invoke('save-config', config),

  // Connection test
  testConnection: (url: string, token: string) =>
    ipcRenderer.invoke('test-connection', url, token),

  // Auth
  discoverOidc: (url: string) =>
    ipcRenderer.invoke('auth:discover-oidc', url),
  oidcLogin: (url: string, providerKey: string) =>
    ipcRenderer.invoke('auth:login-oidc', url, providerKey),
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

  // Obsidian
  openDeepLink: (url: string) => ipcRenderer.invoke('open-deep-link', url),
  testObsidianConnection: () => ipcRenderer.invoke('test-obsidian-connection'),

  // Quick Entry settings
  applyQuickEntrySettings: () =>
    ipcRenderer.invoke('apply-quick-entry-settings') as Promise<{ entry: boolean; viewer: boolean }>,

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
}

contextBridge.exposeInMainWorld('api', api)
