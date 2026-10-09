import { contextBridge, ipcRenderer } from 'electron'
import type { OfflineImageInput, OfflineLabelRef } from '../shared/offline-queue-types'

/** What the offline queue keeps alongside a create that could not reach the server (D-QE-1). */
interface QueuedCreateExtras {
  labels?: OfflineLabelRef[]
  images?: OfflineImageInput[]
}

// Page callbacks only ever receive the payload. The IpcRendererEvent carries
// `sender` (the ipcRenderer itself), which must not cross the context bridge.
contextBridge.exposeInMainWorld('quickEntryApi', {
  platform: process.platform as 'darwin' | 'win32' | 'linux',
  saveTask: (title: string, description: string | null, dueDate: string | null, projectId: number | null, priority?: number, repeatAfter?: number, repeatMode?: number, extras?: QueuedCreateExtras) =>
    ipcRenderer.invoke('qe:save-task', title, description, dueDate, projectId, priority, repeatAfter, repeatMode, extras),
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
  getQueueCounts: () => ipcRenderer.invoke('qe:get-queue-counts'),
  queueFollowUps: (taskId: number, extras: QueuedCreateExtras, title?: string) =>
    ipcRenderer.invoke('qe:queue-follow-ups', taskId, extras, title),
  // Asks main for the final Obsidian link when a task is saved with the note linked; main writes
  // the note's uid at that point and only then.
  resolveObsidianLink: () => ipcRenderer.invoke('qe:resolve-obsidian-link'),
  fetchLabels: () => ipcRenderer.invoke('fetch-labels'),
  fetchProjects: () => ipcRenderer.invoke('fetch-projects', false),
  addLabelToTask: (taskId: number, labelId: number) => ipcRenderer.invoke('add-label-to-task', taskId, labelId),
  createLabel: (label: { title: string; hex_color?: string }) => ipcRenderer.invoke('create-label', label),
  getDateFormat: () => ipcRenderer.invoke('get-date-format'),
  onDateFormatChanged: (callback: (format: { locale: string; hour12: boolean }) => void) => {
    ipcRenderer.on('date-format-changed', (_event, format: { locale: string; hour12: boolean }) => callback(format))
  },
  onShowWindow: (callback: () => void) => {
    ipcRenderer.on('window-shown', () => callback())
  },
  onHideWindow: (callback: () => void) => {
    ipcRenderer.on('window-hidden', () => callback())
  },
  onSyncCompleted: (callback: () => void) => {
    ipcRenderer.on('sync-completed', () => callback())
  },
  onDragHover: (callback: (hovering: boolean) => void) => {
    ipcRenderer.on('drag-hover', (_event, hovering: boolean) => callback(hovering))
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
