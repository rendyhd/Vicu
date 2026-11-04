import { viewableImageType, type ViewerImage } from './attachment-preview'
import { commentAttachmentAddress, isInlineImageType, type CommentAttachment, type CommentSegment } from './collaboration'
import { getClipboardImages } from './clipboard-images'
import type { TaskAttachment } from './vikunja-types'

// Files in comments (cross-app semantics 9.5): the pure part of showing and sending them.

export type TextSegment = Exclude<CommentSegment, CommentAttachment>

/** A comment in reading order: runs of text, and the attachments between them. */
export type CommentBlock = { kind: 'text'; segments: TextSegment[] } | { kind: 'file'; file: CommentAttachment }

export function commentBlocks(segments: readonly CommentSegment[]): CommentBlock[] {
  const blocks: CommentBlock[] = []
  for (const segment of segments) {
    if ('attachment' in segment) {
      blocks.push({ kind: 'file', file: segment })
      continue
    }
    const last = blocks[blocks.length - 1]
    if (last?.kind === 'text') last.segments.push(segment)
    else blocks.push({ kind: 'text', segments: [segment] })
  }
  return blocks
}

/** What the thread knows about the task's attachments. */
export interface CommentFileList {
  known: ReadonlyMap<number, TaskAttachment>
  /** `known` is what the server said after the thread was read, so a file missing from it is gone. */
  read: boolean
}

export function isFileGone(file: CommentAttachment, list: CommentFileList): boolean {
  return list.read && !list.known.has(file.attachment)
}

/** The file's own name when the task's list holds it, else what the comment says. */
export function fileDisplayName(file: CommentAttachment, list: CommentFileList): string {
  return list.known.get(file.attachment)?.file.name || file.name || (file.image ? 'Image' : 'File')
}

/** A comment's images for the viewer: not the ones that are gone or that it could not draw. */
export function viewerImagesOf(files: readonly CommentAttachment[], list: CommentFileList): ViewerImage[] {
  const images: ViewerImage[] = []
  for (const file of files) {
    if (!file.image || isFileGone(file, list)) continue
    const known = list.known.get(file.attachment)?.file
    const mime = known ? viewableImageType(known) : 'image/png'
    if (mime) images.push({ id: file.attachment, name: fileDisplayName(file, list), mime })
  }
  return images
}

/** How files added to a comment are written into it. */
export function commentAttachmentsOf(files: readonly TaskAttachment[], server: string, taskId: number): CommentAttachment[] {
  return files.map((attachment) => ({
    attachment: attachment.id,
    name: attachment.file.name,
    image: isInlineImageType(attachment.file.mime),
    url: commentAttachmentAddress(server, taskId, attachment.id),
  }))
}

/** A file to upload, with the name and type to send it under. */
export interface FileToAttach {
  file: File
  name: string
  mime: string
}

export function filesToAttach(files: Iterable<File>): FileToAttach[] {
  return [...files].map((file) => ({ file, name: file.name || 'File', mime: file.type || 'application/octet-stream' }))
}

/** The files on the clipboard: images under the names `getClipboardImages` gives them, and any others. */
export function pastedFiles(event: ClipboardEvent | React.ClipboardEvent): FileToAttach[] {
  const images = getClipboardImages(event)
  const data = 'clipboardData' in event ? event.clipboardData : null
  const others = [...(data?.files ?? [])].filter((file) => !file.type.startsWith('image/'))
  return [...images, ...filesToAttach(others)]
}
