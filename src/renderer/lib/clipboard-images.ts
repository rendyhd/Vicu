/**
 * Extract image files from a ClipboardEvent. Returns an array of { file, name, mime }
 * for every image in the clipboard. The caller is responsible for reading bytes
 * (e.g. via FileReader) and for calling preventDefault if any images were found.
 */
export interface ClipboardImage {
  file: File
  name: string
  mime: string
}

export function getClipboardImages(event: ClipboardEvent | React.ClipboardEvent): ClipboardImage[] {
  const data = 'clipboardData' in event ? event.clipboardData : null
  if (!data) return []
  const out: ClipboardImage[] = []
  for (let i = 0; i < data.items.length; i++) {
    const item = data.items[i]
    if (item.kind !== 'file') continue
    if (!item.type.startsWith('image/')) continue
    const file = item.getAsFile()
    if (!file) continue
    const ext = item.type.split('/')[1] || 'png'
    const name = file.name && file.name !== 'image.png'
      ? file.name
      : `pasted-${Date.now()}.${ext}`
    out.push({ file, name, mime: item.type })
  }
  return out
}

/**
 * Images pasted in a task title. Only a paste without text counts: Office apps (Word, Excel)
 * put a picture of copied text next to the text, and that paste is the text.
 */
export function getTitlePasteImages(event: ClipboardEvent | React.ClipboardEvent): ClipboardImage[] {
  const data = 'clipboardData' in event ? event.clipboardData : null
  if (!data || data.getData('text/plain').trim()) return []
  return getClipboardImages(event)
}

export async function fileToUint8Array(file: File): Promise<Uint8Array> {
  const buffer = await file.arrayBuffer()
  return new Uint8Array(buffer)
}
