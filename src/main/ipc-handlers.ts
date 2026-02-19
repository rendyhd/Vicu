import { ipcMain, shell, dialog, app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import {
  fetchTasks,
  createTask,
  updateTask,
  deleteTask,
  fetchTaskById,
  createTaskRelation,
  deleteTaskRelation,
  fetchProjects,
  createProject,
  updateProject,
  deleteProject,
  fetchLabels,
  addLabelToTask,
  removeLabelFromTask,
  createLabel,
  updateLabel,
  deleteLabel,
  testConnection,
  fetchProjectViews,
  fetchViewTasks,
  updateTaskPosition,
  fetchTaskAttachments,
  uploadTaskAttachment,
  deleteTaskAttachment,
  downloadTaskAttachment,
} from './api-client'
import { loadConfig, saveConfig, type AppConfig } from './config'
import { discoverProviders, discoverAuthMethods } from './auth/oidc-discovery'
import { fetchCurrentUser } from './auth/user-info'
import { authManager } from './auth/auth-manager'
import { buildViewerFilterParams } from './quick-entry/filter-builder'
import {
  hideQuickEntry,
  hideQuickView,
  setViewerHeight,
  getMainWindow,
  getQuickEntryWindow,
  getQuickViewWindow,
  applyQuickEntrySettings,
} from './quick-entry-state'
import { sendTestNotification, rescheduleNotifications, refreshTaskReminders } from './notifications'
import { getActiveNote, testObsidianConnection } from './obsidian-client'
import { isRegistered, registerHosts } from './browser-host-registration'
import {
  addPendingAction,
  removePendingAction,
  removePendingActionByTaskId,
  getPendingCount,
  setCachedTasks,
  getCachedTasks,
  isRetriableError,
  isAuthError,
  addStandaloneTask,
  getStandaloneTasks,
  getAllStandaloneTasks,
  markStandaloneTaskDone,
  markStandaloneTaskUndone,
  scheduleStandaloneTaskToday,
  removeStandaloneTaskDueDate,
  updateStandaloneTask,
  clearStandaloneTasks,
} from './cache'

export function registerIpcHandlers(): void {
  // Tasks
  ipcMain.handle('fetch-tasks', (_event, params: Record<string, unknown>) => {
    return fetchTasks(params)
  })

  ipcMain.handle('create-task', async (_event, projectId: number, task: Record<string, unknown>) => {
    const result = await createTask(projectId, task)
    if (result.success) notifyViewerSync()
    return result
  })

  ipcMain.handle('update-task', async (_event, id: number, task: Record<string, unknown>) => {
    const result = await updateTask(id, task)
    if (result.success) notifyViewerSync()
    return result
  })

  ipcMain.handle('delete-task', async (_event, id: number) => {
    const result = await deleteTask(id)
    if (result.success) notifyViewerSync()
    return result
  })

  ipcMain.handle('fetch-task-by-id', (_event, id: number) => {
    return fetchTaskById(id)
  })

  ipcMain.handle('create-task-relation', (_event, taskId: number, otherTaskId: number, relationKind: string) => {
    return createTaskRelation(taskId, otherTaskId, relationKind)
  })

  ipcMain.handle('delete-task-relation', (_event, taskId: number, relationKind: string, otherTaskId: number) => {
    return deleteTaskRelation(taskId, relationKind, otherTaskId)
  })

  // Projects
  ipcMain.handle('fetch-projects', () => {
    return fetchProjects()
  })

  ipcMain.handle('create-project', (_event, project: Record<string, unknown>) => {
    return createProject(project)
  })

  ipcMain.handle('update-project', (_event, id: number, project: Record<string, unknown>) => {
    return updateProject(id, project)
  })

  ipcMain.handle('delete-project', (_event, id: number) => {
    return deleteProject(id)
  })

  // Labels
  ipcMain.handle('fetch-labels', () => {
    return fetchLabels()
  })

  ipcMain.handle('add-label-to-task', (_event, taskId: number, labelId: number) => {
    return addLabelToTask(taskId, labelId)
  })

  ipcMain.handle('remove-label-from-task', (_event, taskId: number, labelId: number) => {
    return removeLabelFromTask(taskId, labelId)
  })

  ipcMain.handle('create-label', (_event, label: Record<string, unknown>) => {
    return createLabel(label)
  })

  ipcMain.handle('update-label', (_event, id: number, label: Record<string, unknown>) => {
    return updateLabel(id, label)
  })

  ipcMain.handle('delete-label', (_event, id: number) => {
    return deleteLabel(id)
  })

  // Project Views
  ipcMain.handle('fetch-project-views', (_event, projectId: number) => {
    return fetchProjectViews(projectId)
  })

  ipcMain.handle('fetch-view-tasks', (_event, projectId: number, viewId: number, params: Record<string, unknown>) => {
    return fetchViewTasks(projectId, viewId, params)
  })

  ipcMain.handle('update-task-position', (_event, taskId: number, viewId: number, position: number) => {
    return updateTaskPosition(taskId, viewId, position)
  })

  // Config
  ipcMain.handle('get-config', () => {
    return loadConfig()
  })

  ipcMain.handle('save-config', (_event, config: AppConfig) => {
    saveConfig(config)
  })

  // Connection test
  ipcMain.handle('test-connection', (_event, url: string, token: string) => {
    return testConnection(url, token)
  })

  // Auth
  ipcMain.handle('auth:discover-oidc', (_event, url: string) => {
    return discoverProviders(url)
  })

  ipcMain.handle('auth:login-oidc', async (_event, url: string, providerKey: string) => {
    try {
      await authManager.login(url, providerKey)
      return { success: true }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : 'Login failed' }
    }
  })

  ipcMain.handle('auth:discover-methods', (_event, url: string) => {
    return discoverAuthMethods(url)
  })

  ipcMain.handle('auth:login-password', async (_event, url: string, username: string, password: string, totpPasscode?: string) => {
    return authManager.loginPassword(url, username, password, totpPasscode)
  })

  ipcMain.handle('auth:get-user', async () => {
    const config = loadConfig()
    if (!config?.vikunja_url) return null
    const token = config.auth_method === 'api_token' ? config.api_token : authManager.getTokenSync()
    if (!token) return null
    return fetchCurrentUser(config.vikunja_url, token)
  })

  ipcMain.handle('auth:check', () => {
    return authManager.getTokenSync() !== null
  })

  ipcMain.handle('auth:logout', () => {
    authManager.logout()
  })

  // --- Quick Entry IPC ---
  ipcMain.handle('qe:save-task', async (_event, title: string, description: string | null, dueDate: string | null, projectId: number | null) => {
    const config = loadConfig()
    if (!config) return { success: false, error: 'Configuration not loaded' }

    // Standalone mode: store locally
    if (config.standalone_mode) {
      const task = addStandaloneTask(title, description, dueDate)
      notifyViewerSync()
      return { success: true, task }
    }

    const targetProjectId = projectId || config.quick_entry_default_project_id || config.inbox_project_id
    const taskPayload: Record<string, unknown> = { title }
    if (description) taskPayload.description = description
    if (dueDate) taskPayload.due_date = dueDate

    const result = await createTask(targetProjectId, taskPayload)

    if (result.success) {
      notifyViewerSync()
      notifyMainWindow()
      return result
    }

    // If retriable error, cache for later sync
    if (isRetriableError(result.error)) {
      addPendingAction({
        type: 'create',
        title,
        description: description || null,
        dueDate: dueDate || null,
        projectId: targetProjectId,
      })
      return { success: true, cached: true }
    }

    return result
  })

  ipcMain.handle('qe:close-window', () => {
    hideQuickEntry()
  })

  ipcMain.handle('qe:get-config', () => {
    const config = loadConfig()
    if (!config) return null
    return {
      vikunja_url: config.vikunja_url,
      quick_entry_default_project_id: config.quick_entry_default_project_id || config.inbox_project_id,
      inbox_project_id: config.inbox_project_id,
      exclamation_today: config.exclamation_today,
      secondary_projects: config.secondary_projects || [],
      project_cycle_modifier: config.project_cycle_modifier || 'ctrl',
      standalone_mode: config.standalone_mode === true,
    }
  })

  ipcMain.handle('qe:get-pending-count', () => {
    return getPendingCount()
  })

  // --- Quick View IPC ---
  ipcMain.handle('qv:fetch-tasks', async () => {
    const config = loadConfig()
    if (!config) return { success: false, error: 'Configuration not loaded' }

    // Standalone mode: read from local store
    if (config.standalone_mode) {
      const tasks = getStandaloneTasks(
        config.viewer_filter?.sort_by || 'due_date',
        config.viewer_filter?.order_by || 'asc',
      )
      return { success: true, tasks, standalone: true }
    }

    if (!config.viewer_filter) return { success: false, error: 'No filter configuration' }

    // Resolve custom list filter if set
    let effectiveFilter = config.viewer_filter
    if (config.viewer_filter.custom_list_id) {
      const list = config.custom_lists?.find(l => l.id === config.viewer_filter!.custom_list_id)
      if (list) {
        effectiveFilter = {
          project_ids: list.filter.project_ids,
          sort_by: list.filter.sort_by,
          order_by: list.filter.order_by,
          due_date_filter: list.filter.due_date_filter,
          include_today_all_projects: list.filter.include_today_all_projects,
        }
      }
    }

    const filterParams = buildViewerFilterParams(effectiveFilter)

    // Position sort needs special handling via project views
    if (effectiveFilter.sort_by === 'position') {
      const projectIds = effectiveFilter.project_ids
      if (!projectIds || projectIds.length === 0) {
        return { success: false, error: 'Position sort requires specific projects' }
      }
      const allTasks: unknown[] = []
      for (const pid of projectIds) {
        const viewsResult = await fetchProjectViews(pid)
        if (!viewsResult.success || !Array.isArray(viewsResult.data)) continue
        const views = viewsResult.data as Array<{ id: number; view_kind: string }>
        const listView = views.find(v => v.view_kind === 'list') || views[0]
        if (!listView) continue
        const viewResult = await fetchViewTasks(pid, listView.id, filterParams)
        if (viewResult.success && Array.isArray(viewResult.data)) {
          allTasks.push(...viewResult.data)
        }
      }
      setCachedTasks(allTasks)
      return { success: true, tasks: allTasks }
    }

    const result = await fetchTasks(filterParams)
    if (result.success) {
      setCachedTasks(result.data)
      return { success: true, tasks: result.data }
    }

    // API failed — serve cached tasks if available
    if (isRetriableError(result.error)) {
      const cached = getCachedTasks()
      if (cached.tasks) {
        return { success: true, tasks: cached.tasks, cached: true, cachedAt: cached.timestamp }
      }
    }

    return result
  })

  ipcMain.handle('qv:mark-task-done', async (_event, taskId: number, taskData: Record<string, unknown>) => {
    const config = loadConfig()
    if (config?.standalone_mode) {
      const task = markStandaloneTaskDone(String(taskId))
      return task ? { success: true, task } : { success: false, error: 'Task not found' }
    }

    const result = await updateTask(taskId, { ...taskData, done: true })
    if (result.success) {
      notifyMainWindow()
      return result
    }

    if (isRetriableError(result.error)) {
      addPendingAction({ type: 'complete', taskId, taskData })
      return { success: true, cached: true }
    }
    return result
  })

  ipcMain.handle('qv:mark-task-undone', async (_event, taskId: number, taskData: Record<string, unknown>) => {
    const config = loadConfig()
    if (config?.standalone_mode) {
      const task = markStandaloneTaskUndone(String(taskId))
      return task ? { success: true, task } : { success: false, error: 'Task not found' }
    }

    // Check if there's a pending 'complete' — if so, just cancel it
    const cancelled = removePendingActionByTaskId(taskId, 'complete')
    if (cancelled) return { success: true, cancelledPending: true }

    const result = await updateTask(taskId, { ...taskData, done: false })
    if (result.success) {
      notifyMainWindow()
      return result
    }

    if (isRetriableError(result.error)) {
      addPendingAction({ type: 'uncomplete', taskId, taskData })
      return { success: true, cached: true }
    }
    return result
  })

  ipcMain.handle('qv:schedule-task-today', async (_event, taskId: number, taskData: Record<string, unknown>) => {
    const now = new Date()
    const dueDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString()

    const config = loadConfig()
    if (config?.standalone_mode) {
      const task = scheduleStandaloneTaskToday(String(taskId))
      return task ? { success: true, task } : { success: false, error: 'Task not found' }
    }

    const result = await updateTask(taskId, { ...taskData, due_date: dueDate })
    if (result.success) {
      notifyMainWindow()
      return result
    }

    if (isRetriableError(result.error)) {
      addPendingAction({ type: 'schedule-today', taskId, taskData, dueDate })
      return { success: true, cached: true }
    }
    return result
  })

  ipcMain.handle('qv:remove-due-date', async (_event, taskId: number, taskData: Record<string, unknown>) => {
    const nullDate = '0001-01-01T00:00:00Z'

    const config = loadConfig()
    if (config?.standalone_mode) {
      const task = removeStandaloneTaskDueDate(String(taskId))
      return task ? { success: true, task } : { success: false, error: 'Task not found' }
    }

    const result = await updateTask(taskId, { ...taskData, due_date: nullDate })
    if (result.success) {
      notifyMainWindow()
      return result
    }

    if (isRetriableError(result.error)) {
      addPendingAction({ type: 'remove-due-date', taskId, taskData, dueDate: nullDate })
      return { success: true, cached: true }
    }
    return result
  })

  ipcMain.handle('qv:update-task', async (_event, taskId: number, taskData: Record<string, unknown>) => {
    const config = loadConfig()
    if (config?.standalone_mode) {
      const task = updateStandaloneTask(String(taskId), taskData)
      return task ? { success: true, task } : { success: false, error: 'Task not found' }
    }

    const result = await updateTask(taskId, taskData)
    if (result.success) {
      notifyMainWindow()
      return result
    }

    if (isRetriableError(result.error)) {
      addPendingAction({ type: 'update-task', taskId, taskData })
      return { success: true, cached: true }
    }
    return result
  })

  ipcMain.handle('qv:open-task-in-browser', (_event, taskId: number) => {
    const config = loadConfig()
    if (!config || config.standalone_mode) return
    const url = `${config.vikunja_url}/tasks/${taskId}`
    if (url.startsWith('https://') || url.startsWith('http://')) {
      shell.openExternal(url)
    }
  })

  ipcMain.handle('qv:close-window', () => {
    hideQuickView()
  })

  ipcMain.handle('qv:set-height', (_event, height: number) => {
    setViewerHeight(height)
  })

  ipcMain.handle('qv:get-pending-count', () => {
    return getPendingCount()
  })

  ipcMain.handle('qv:get-config', () => {
    const config = loadConfig()
    if (!config) return null
    return {
      standalone_mode: config.standalone_mode === true,
    }
  })

  // --- Notifications IPC ---
  ipcMain.handle('notifications:test', () => {
    sendTestNotification()
  })

  ipcMain.handle('notifications:reschedule', () => {
    rescheduleNotifications()
  })

  ipcMain.handle('notifications:refresh-task-reminders', () => {
    refreshTaskReminders()
  })

  // --- Apply Quick Entry Settings (called from renderer settings page) ---
  ipcMain.handle('apply-quick-entry-settings', () => {
    return applyQuickEntrySettings()
  })

  // --- Standalone mode IPC ---
  ipcMain.handle('qe:get-standalone-task-count', () => {
    return getAllStandaloneTasks().length
  })

  // --- Attachments IPC ---
  ipcMain.handle('fetch-task-attachments', (_event, taskId: number) => {
    return fetchTaskAttachments(taskId)
  })

  ipcMain.handle('upload-task-attachment', (_event, taskId: number, fileData: Uint8Array, fileName: string, mimeType: string) => {
    return uploadTaskAttachment(taskId, Buffer.from(fileData), fileName, mimeType)
  })

  ipcMain.handle('delete-task-attachment', (_event, taskId: number, attachmentId: number) => {
    return deleteTaskAttachment(taskId, attachmentId)
  })

  ipcMain.handle('open-task-attachment', async (_event, taskId: number, attachmentId: number, fileName: string) => {
    const result = await downloadTaskAttachment(taskId, attachmentId)
    if (!result.success) return result

    try {
      const tempDir = path.join(app.getPath('temp'), 'vicu-attachments')
      if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true })
      const filePath = path.join(tempDir, `${attachmentId}-${fileName}`)
      fs.writeFileSync(filePath, result.data)
      await shell.openPath(filePath)
      return { success: true, data: undefined }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to open file' }
    }
  })

  ipcMain.handle('pick-and-upload-attachment', async (_event, taskId: number) => {
    const win = getMainWindow()
    const dialogResult = await dialog.showOpenDialog(win!, {
      properties: ['openFile', 'multiSelections'],
    })
    if (dialogResult.canceled || dialogResult.filePaths.length === 0) {
      return { success: true, data: { count: 0 } }
    }

    let count = 0
    let lastError = ''
    for (const filePath of dialogResult.filePaths) {
      const fileBuffer = fs.readFileSync(filePath)
      const fileName = path.basename(filePath)
      const mimeType = getMimeType(fileName)
      const result = await uploadTaskAttachment(taskId, fileBuffer, fileName, mimeType)
      if (result.success) count++
      else lastError = result.error
    }
    if (count === 0 && dialogResult.filePaths.length > 0) {
      return { success: false, error: lastError || 'Upload failed' }
    }
    return { success: true, data: { count } }
  })

  // --- Obsidian IPC ---
  const ALLOWED_EXTERNAL_PROTOCOLS = new Set(['https:', 'http:', 'obsidian:'])

  ipcMain.handle('open-deep-link', (_event, url: string) => {
    if (typeof url !== 'string') return
    try {
      const parsed = new URL(url)
      if (ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol)) {
        shell.openExternal(url)
      }
    } catch { /* invalid URL */ }
  })

  ipcMain.handle('test-obsidian-connection', async () => {
    const config = loadConfig()
    if (!config?.obsidian_api_key) return { success: false, error: 'No API key configured' }
    try {
      const result = await testObsidianConnection(config.obsidian_api_key, config.obsidian_port || 27124)
      if (result.reachable) {
        return { success: true, data: result.noteName ? { noteName: result.noteName } : null }
      }
      return { success: false, error: 'Cannot reach Obsidian. Is the Local REST API plugin enabled?' }
    } catch {
      return { success: false, error: 'Cannot reach Obsidian. Is the Local REST API plugin enabled?' }
    }
  })

  ipcMain.handle('qe:upload-standalone-tasks', async (_event, projectId: number) => {
    const tasks = getAllStandaloneTasks()
    if (tasks.length === 0) return { success: true, uploaded: 0 }

    let uploaded = 0
    const errors: string[] = []

    for (const task of tasks) {
      const taskPayload: Record<string, unknown> = { title: task.title }
      if (task.description) taskPayload.description = task.description
      if (task.due_date && task.due_date !== '0001-01-01T00:00:00Z') {
        taskPayload.due_date = task.due_date
      }

      const result = await createTask(projectId, taskPayload)
      if (result.success) {
        uploaded++
      } else {
        errors.push(`"${task.title}": ${result.error}`)
        if (result.error && isAuthError(result.error)) break
      }
    }

    if (uploaded > 0 && uploaded === tasks.length) {
      clearStandaloneTasks()
    }

    if (errors.length > 0) {
      return { success: false, uploaded, error: errors[0], totalErrors: errors.length }
    }
    return { success: true, uploaded }
  })

  // --- Browser Link IPC ---
  ipcMain.handle('check-browser-host-registration', () => isRegistered())

  ipcMain.handle('register-browser-hosts', () => {
    const config = loadConfig()
    registerHosts({
      chromeExtensionId: config?.browser_extension_id || '',
      firefoxExtensionId: 'browser-link@vicu.app',
    })
    return isRegistered()
  })

  ipcMain.handle('get-browser-extension-path', () => {
    const base = app.isPackaged
      ? path.join(process.resourcesPath, 'extensions', 'browser')
      : path.join(app.getAppPath(), 'extensions', 'browser')
    return base
  })

  ipcMain.handle('open-browser-extension-folder', () => {
    const base = app.isPackaged
      ? path.join(process.resourcesPath, 'extensions', 'browser')
      : path.join(app.getAppPath(), 'extensions', 'browser')
    const manifest = path.join(base, 'manifest.json')
    shell.showItemInFolder(manifest)
  })
}

// Helper: notify main window to refresh its query cache
function notifyMainWindow(): void {
  try {
    const win = getMainWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('tasks-changed')
    }
  } catch { /* ignore */ }
}

// Helper: notify Quick View to refresh
function notifyViewerSync(): void {
  try {
    const viewerWindow = getQuickViewWindow()
    if (viewerWindow && !viewerWindow.isDestroyed()) {
      viewerWindow.webContents.send('sync-completed')
    }
  } catch { /* ignore */ }
}

// Helper: guess MIME type from file extension
function getMimeType(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase()
  const mimeMap: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.txt': 'text/plain',
    '.csv': 'text/csv',
    '.json': 'application/json',
    '.xml': 'application/xml',
    '.zip': 'application/zip',
    '.gz': 'application/gzip',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
  }
  return mimeMap[ext] || 'application/octet-stream'
}
