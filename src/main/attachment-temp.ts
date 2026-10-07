import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'

/** Folder under the OS temp directory that holds attachments opened from Vicu. */
export const ATTACHMENT_TEMP_DIRNAME = 'vicu-attachments'

export function attachmentTempDirFor(tempRoot: string): string {
  return join(tempRoot, ATTACHMENT_TEMP_DIRNAME)
}

/** Create the attachment temp folder (private to the current user where the OS supports modes). */
export function ensureAttachmentTempDir(tempRoot: string): string {
  const dir = attachmentTempDirFor(tempRoot)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  return dir
}

/**
 * Delete everything in the attachment temp folder. Best effort: a file that is
 * still open in another program (Windows locks it) is left for the next
 * startup. Returns true when the folder is gone or never existed.
 */
export function cleanAttachmentTempDir(tempRoot: string): boolean {
  try {
    rmSync(attachmentTempDirFor(tempRoot), { recursive: true, force: true })
    return true
  } catch (err) {
    console.warn('[Attachments] Could not clean temp folder:', err instanceof Error ? err.message : err)
    return false
  }
}
