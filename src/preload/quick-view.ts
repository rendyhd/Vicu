import { contextBridge, ipcRenderer } from 'electron'
import type { TaskPatch } from '../shared/merge-patches'

// Page callbacks only ever receive the payload. The IpcRendererEvent carries
// `sender` (the ipcRenderer itself), which must not cross the context bridge.
contextBridge.exposeInMainWorld('quickViewApi', {
  platform: process.platform as 'darwin' | 'win32' | 'linux',
  fetchTasks: () => ipcRenderer.invoke('qv:fetch-tasks'),
  markTaskDone: (taskId: number | string, taskData: Record<string, unknown>) =>
    ipcRenderer.invoke('qv:mark-task-done', taskId, taskData),
  markTaskUndone: (taskId: number | string, taskData: Record<string, unknown>) =>
    ipcRenderer.invoke('qv:mark-task-undone', taskId, taskData),
  scheduleTaskToday: (taskId: number | string, taskData: Record<string, unknown>) =>
    ipcRenderer.invoke('qv:schedule-task-today', taskId, taskData),
  removeDueDate: (taskId: number | string, taskData: Record<string, unknown>) =>
    ipcRenderer.invoke('qv:remove-due-date', taskId, taskData),
  updateTask: (taskId: number | string, patch: TaskPatch) =>
    ipcRenderer.invoke('qv:update-task', taskId, patch),
  openTaskInBrowser: (taskId: number) => ipcRenderer.invoke('qv:open-task-in-browser', taskId),
  openTaskInApp: (taskId: number) => ipcRenderer.invoke('qv:open-task-in-app', taskId),
  closeWindow: () => ipcRenderer.invoke('qv:close-window'),
  setHeight: (height: number) => ipcRenderer.invoke('qv:set-height', height),
  getPendingCount: () => ipcRenderer.invoke('qv:get-pending-count'),
  getQueueCounts: () => ipcRenderer.invoke('qv:get-queue-counts'),
  getConfig: () => ipcRenderer.invoke('qv:get-config'),
  onShowWindow: (callback: () => void) => {
    ipcRenderer.on('viewer-shown', () => callback())
  },
  onHideWindow: (callback: () => void) => {
    ipcRenderer.on('viewer-hidden', () => callback())
  },
  onSyncCompleted: (callback: () => void) => {
    ipcRenderer.on('sync-completed', () => callback())
  },
  onConfigChanged: (callback: () => void) => {
    ipcRenderer.on('viewer-config-changed', () => callback())
  },
  onDragHover: (callback: (hovering: boolean) => void) => {
    ipcRenderer.on('drag-hover', (_event, hovering: boolean) => callback(hovering))
  },
  openDeepLink: (url: string) => ipcRenderer.invoke('open-deep-link', url),
})
