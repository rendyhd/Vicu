import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('quickEntryApi', {
  saveTask: (title: string, description: string | null, dueDate: string | null, projectId: number | null) =>
    ipcRenderer.invoke('qe:save-task', title, description, dueDate, projectId),
  closeWindow: () => ipcRenderer.invoke('qe:close-window'),
  getConfig: () => ipcRenderer.invoke('qe:get-config'),
  getPendingCount: () => ipcRenderer.invoke('qe:get-pending-count'),
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
})
