import { formatFileSize } from './attachment-preview'

/**
 * Files being sent from the attach dialog right now, shown at the end of the task's attachments
 * until the attachment they make is listed (the phone's `UploadingFile`).
 */
export interface UploadingFile {
  key: number
  taskId: number
  name: string
  size: number
  /** The attachments the task had when the upload started: a new one with this name is this file. */
  knownIds: readonly number[]
  /** The attachment the upload made, once the server answered. */
  attachmentId?: number
}

interface ListedAttachment {
  id: number
  file?: { name?: string } | null
}

/** The line under the name of a file being sent. */
export function uploadingStatus(size: number): string {
  return `Uploading · ${formatFileSize(size)}`
}

/** True once [attachments] holds the attachment [upload] made, so its own row takes the place. */
export function hasLanded(upload: UploadingFile, attachments: readonly ListedAttachment[]): boolean {
  return attachments.some((a) =>
    a.id === upload.attachmentId || (!upload.knownIds.includes(a.id) && a.file?.name === upload.name))
}

/** The task's files still on their way, given the attachments [attachments] already lists. */
export function uploadsToShow(
  uploads: readonly UploadingFile[],
  taskId: number,
  attachments: readonly ListedAttachment[],
): UploadingFile[] {
  return uploads.filter((upload) => upload.taskId === taskId && !hasLanded(upload, attachments))
}
