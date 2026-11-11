import type { OfflineFailedItemView, OfflineQueueItemView, OfflineQueueSnapshot } from '../../shared/offline-queue-types'

/**
 * Files attached while the server could not be reached (issue 104): the words the app uses for them,
 * the same as the phone's `WaitingUploadText`, and the task's waiting and failed uploads from the
 * offline queue's snapshot.
 */

/** The toast after a file was kept for later. */
export function queuedUploadText(fileName: string): string {
  return `${fileName} uploads when you're back online`
}

/** One toast for several files kept for later. */
export function queuedUploadsText(names: readonly string[]): string {
  return names.length === 1 ? queuedUploadText(names[0]) : `${names.length} files upload when you're back online`
}

export interface WaitingUpload {
  /** The queued or failed action, for Remove and Retry. */
  id: string
  name: string
  inline: boolean
  failed: boolean
  /** Why the server refused it (failed only). */
  error?: string
  /** False when sending it again cannot help (larger than the server accepts). */
  canRetry: boolean
}

/** The line under the file name in the task's attachments. */
export function waitingUploadStatus(upload: WaitingUpload): string {
  if (upload.failed) return `Not uploaded: ${upload.error || 'the server refused it'}`
  return upload.inline ? 'Waiting to upload · goes into the notes' : 'Waiting to upload'
}

/** The task's uploads that wait in the queue or were refused, oldest first. */
export function waitingUploadsFor(snapshot: OfflineQueueSnapshot | null, taskId: number): WaitingUpload[] {
  if (!snapshot) return []
  const pending = snapshot.pending
    .filter((item): item is OfflineQueueItemView & { upload: NonNullable<OfflineQueueItemView['upload']> } =>
      item.type === 'upload-attachment' && item.taskId === taskId && !!item.upload)
    .map((item) => ({ id: item.id, name: item.upload.name, inline: item.upload.inline, failed: false, canRetry: true }))
  const failed = snapshot.failed
    .filter((item): item is OfflineFailedItemView & { upload: NonNullable<OfflineFailedItemView['upload']> } =>
      item.type === 'upload-attachment' && item.taskId === taskId && !!item.upload)
    .map((item) => ({
      id: item.id,
      name: item.upload.name,
      inline: item.upload.inline,
      failed: true,
      error: item.reason === 'too-large' ? 'more than the server accepts' : item.error,
      canRetry: item.reason !== 'too-large',
    }))
  return [...pending, ...failed]
}
