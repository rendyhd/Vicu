/**
 * Pictures of pages before they leave the device (docs/ai-assistant-v1.md 4.9.2): turned upright by
 * their orientation, scaled so the long edge is at most `notes_image_long_edge` pixels, drawn on
 * white (a transparent PNG reads badly as JPEG) and encoded as JPEG. Drawing on a canvas drops every
 * piece of metadata (location, camera, time).
 */
import { AI_LIMITS } from '../../../shared/ai/contract'

export interface PreparedImage {
  /** Base64 of the JPEG, without the `data:` prefix. */
  data: string
  width: number
  height: number
}

const JPEG_QUALITY = 0.85

/** The size a picture is scaled to: the long edge at most `max`, never larger than it was. */
export function scaledSize(width: number, height: number, max: number = AI_LIMITS.notes_image_long_edge): { width: number; height: number } {
  const long = Math.max(width, height)
  if (long <= max || long === 0) return { width, height }
  const scale = max / long
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  return btoa(binary)
}

/** Draws a source on a white canvas of the given size and encodes it as JPEG. */
export async function drawAsJpeg(source: CanvasImageSource, width: number, height: number): Promise<PreparedImage> {
  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('no canvas')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  context.drawImage(source, 0, 0, width, height)
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY })
  return { data: await blobToBase64(blob), width, height }
}

/** A picture (any type Chromium draws) prepared for reading. */
export async function prepareImage(blob: Blob): Promise<PreparedImage> {
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' })
  try {
    const size = scaledSize(bitmap.width, bitmap.height)
    return await drawAsJpeg(bitmap, size.width, size.height)
  } finally {
    bitmap.close()
  }
}

/** The data URL a page's picture is shown with. */
export function imageUrl(data: string): string {
  return `data:image/jpeg;base64,${data}`
}
