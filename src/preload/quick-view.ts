import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('quickViewApi', {
  fetchTasks: () => ipcRenderer.invoke('qv:fetch-tasks'),
  markTaskDone: (taskId: number, taskData: Record<string, unknown>) =>
    ipcRenderer.invoke('qv:mark-task-done', taskId, taskData),
  markTaskUndone: (taskId: number, taskData: Record<string, unknown>) =>
    ipcRenderer.invoke('qv:mark-task-undone', taskId, taskData),
  scheduleTaskToday: (taskId: number, taskData: Record<string, unknown>) =>
    ipcRenderer.invoke('qv:schedule-task-today', taskId, taskData),
  removeDueDate: (taskId: number, taskData: Record<string, unknown>) =>
    ipcRenderer.invoke('qv:remove-due-date', taskId, taskData),
  updateTask: (taskId: number, taskData: Record<string, unknown>) =>
    ipcRenderer.invoke('qv:update-task', taskId, taskData),
  openTaskInBrowser: (taskId: number) => ipcRenderer.invoke('qv:open-task-in-browser', taskId),
  closeWindow: () => ipcRenderer.invoke('qv:close-window'),
  setHeight: (height: number) => ipcRenderer.invoke('qv:set-height', height),
  getPendingCount: () => ipcRenderer.invoke('qv:get-pending-count'),
  getConfig: () => ipcRenderer.invoke('qv:get-config'),
  onShowWindow: (callback: () => void) => {
    ipcRenderer.on('viewer-shown', callback)
  },
  onSyncCompleted: (callback: () => void) => {
    ipcRenderer.on('sync-completed', callback)
  },
  onDragHover: (callback: (_event: unknown, hovering: boolean) => void) => {
    ipcRenderer.on('drag-hover', callback)
  },
  openDeepLink: (url: string) => ipcRenderer.invoke('open-deep-link', url),
})
