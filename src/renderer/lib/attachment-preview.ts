/**
 * Which task attachments the in-app image viewer can show, and the type to give their bytes.
 * Only formats Chromium draws in an <img>; HEIC, TIFF and the like open in the default app.
 */

const TYPE_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  apng: 'image/apng',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jfif: 'image/jpeg',
  pjpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
}

const VIEWABLE_TYPES = new Set([
  ...Object.values(TYPE_BY_EXTENSION),
  'image/pjpeg',
  'image/x-ms-bmp',
  'image/vnd.microsoft.icon',
])

export interface AttachmentFileInfo {
  mime?: string | null
  name?: string | null
}

/** One image of the viewer: the attachment, its file name and the type its bytes are drawn as. */
export interface ViewerImage {
  id: number
  name: string
  mime: string
}

/**
 * The type to draw the file as, or null when the viewer cannot show it. The server's type wins
 * when it names an image; an image type the viewer cannot draw stays unviewable whatever the name
 * says. Without an image type (empty, `application/octet-stream`) the extension decides.
 */
export function viewableImageType(file: AttachmentFileInfo): string | null {
  const mime = (file.mime ?? '').split(';')[0].trim().toLowerCase()
  if (VIEWABLE_TYPES.has(mime)) return mime
  if (mime.startsWith('image/')) return null
  const dot = (file.name ?? '').lastIndexOf('.')
  if (dot < 0) return null
  return TYPE_BY_EXTENSION[(file.name ?? '').slice(dot + 1).trim().toLowerCase()] ?? null
}

/** The attachments the viewer can show, in the order given. */
export function viewableImages(
  attachments: readonly { id: number; file: AttachmentFileInfo }[] | null | undefined,
): ViewerImage[] {
  const images: ViewerImage[] = []
  for (const attachment of attachments ?? []) {
    const mime = viewableImageType(attachment.file)
    if (mime) images.push({ id: attachment.id, name: attachment.file.name || `Image ${attachment.id}`, mime })
  }
  return images
}

/** The image after (`1`) or before (`-1`) the current one, going round at the ends. */
export function stepImage(index: number, count: number, step: 1 | -1): number {
  if (count <= 0) return 0
  return (((index + step) % count) + count) % count
}
