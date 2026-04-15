import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('quickEntryApi', {
  platform: process.platform as 'darwin' | 'win32' | 'linux',
  saveTask: (title: string, description: string | null, dueDate: string | null, projectId: number | null, priority?: number, repeatAfter?: number, repeatMode?: number) =>
    ipcRenderer.invoke('qe:save-task', title, description, dueDate, projectId, priority, repeatAfter, repeatMode),
  uploadAttachment: (taskId: number, fileData: Uint8Array, fileName: string, mimeType: string) =>
    ipcRenderer.invoke('upload-task-attachment', taskId, fileData, fileName, mimeType),
  fetchTaskAttachments: (taskId: number) =>
    ipcRenderer.invoke('fetch-task-attachments', taskId),
  updateTask: (taskId: number, task: Record<string, unknown>) =>
    ipcRenderer.invoke('update-task', taskId, task),
  closeWindow: () => ipcRenderer.invoke('qe:close-window'),
  setHeight: (height: number) => ipcRenderer.invoke('qe:set-height', height),
  getConfig: () => ipcRenderer.invoke('qe:get-config'),
  getPendingCount: () => ipcRenderer.invoke('qe:get-pending-count'),
  fetchLabels: () => ipcRenderer.invoke('fetch-labels'),
  fetchProjects: () => ipcRenderer.invoke('fetch-projects'),
  addLabelToTask: (taskId: number, labelId: number) => ipcRenderer.invoke('add-label-to-task', taskId, labelId),
  createLabel: (label: { title: string; hex_color?: string }) => ipcRenderer.invoke('create-label', label),
  onShowWindow: (callback: () => void) => {
    ipcRenderer.on('window-shown', callback)
  },
  onHideWindow: (callback: () => void) => {
    ipcRenderer.on('window-hidden', callback)
  },
  onSyncCompleted: (callback: () => void) => {
    ipcRenderer.on('sync-completed', callback)
  },
  onDragHover: (callback: (_event: unknown, hovering: boolean) => void) => {
    ipcRenderer.on('drag-hover', callback)
  },
  onObsidianContext: (callback: (context: {
    deepLink: string; noteName: string; vaultName: string; isUidBased: boolean; mode: 'ask' | 'always'
  } | null) => void) => {
    ipcRenderer.on('obsidian-context', (_event, context) => callback(context))
  },
  onBrowserContext: (callback: (context: {
    url: string; title: string; displayTitle: string; mode: 'ask' | 'always'
  } | null) => void) => {
    ipcRenderer.on('browser-context', (_event, context) => callback(context))
  },
})
