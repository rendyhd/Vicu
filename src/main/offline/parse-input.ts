import type { OfflineImageInput, OfflineLabelRef } from '../../shared/offline-queue-types'

// Shape checks for what windows send into the queue. Pure, so Quick Entry's handler and the
// queue's IPC share them.

/** Label names Quick Entry or the main window matched; keep only well-formed ones. */
export function parseQueuedLabels(raw: unknown): OfflineLabelRef[] {
  if (!Array.isArray(raw)) return []
  const labels: OfflineLabelRef[] = []
  for (const item of raw.slice(0, 50)) {
    if (!item || typeof item !== 'object') continue
    const { id, title } = item as { id?: unknown; title?: unknown }
    const ref: OfflineLabelRef = {}
    if (typeof id === 'number' && Number.isInteger(id) && id > 0) ref.id = id
    if (typeof title === 'string' && title.trim()) ref.title = title.trim()
    if (ref.id !== undefined || ref.title !== undefined) labels.push(ref)
  }
  return labels
}

export function parseQueuedImages(raw: unknown): OfflineImageInput[] {
  if (!Array.isArray(raw)) return []
  const images: OfflineImageInput[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const { name, mime, bytes } = item as { name?: unknown; mime?: unknown; bytes?: unknown }
    if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) continue
    images.push({
      name: typeof name === 'string' && name ? name : 'image',
      mime: typeof mime === 'string' ? mime : 'application/octet-stream',
      bytes,
    })
  }
  return images
}
