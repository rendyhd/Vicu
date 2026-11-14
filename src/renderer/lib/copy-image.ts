/** Formats the system clipboard takes as they are (Electron's `nativeImage` reads PNG and JPEG). */
const CLIPBOARD_READY = new Set(['image/png', 'image/jpeg', 'image/jpg'])

/** Whether the bytes can go to the clipboard without being drawn and encoded again. */
export function isClipboardReadyType(mime: string): boolean {
  return CLIPBOARD_READY.has(mime.toLowerCase().split(';')[0].trim())
}

/**
 * The bytes to put on the clipboard for an image: PNG and JPEG as they are, any other format the
 * window can draw (WebP, GIF, BMP, AVIF, SVG) drawn once and encoded as PNG. A GIF gives its first frame.
 */
export async function clipboardImageBytes(bytes: Uint8Array, mime: string): Promise<Uint8Array> {
  if (isClipboardReadyType(mime)) return bytes
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: mime }))
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('This image cannot be copied')
    context.drawImage(bitmap, 0, 0)
    const png = await canvas.convertToBlob({ type: 'image/png' })
    return new Uint8Array(await png.arrayBuffer())
  } finally {
    bitmap.close()
  }
}
