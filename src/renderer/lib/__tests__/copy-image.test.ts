import { describe, expect, it } from 'vitest'
import { clipboardImageBytes, isClipboardReadyType } from '../copy-image'

describe('copy image', () => {
  it('sends PNG and JPEG as they are', async () => {
    expect(isClipboardReadyType('image/png')).toBe(true)
    expect(isClipboardReadyType('IMAGE/JPEG; charset=binary')).toBe(true)
    const bytes = new Uint8Array([1, 2, 3])
    expect(await clipboardImageBytes(bytes, 'image/jpeg')).toBe(bytes)
  })

  it('draws other formats again as PNG', () => {
    for (const mime of ['image/webp', 'image/gif', 'image/bmp', 'image/avif', 'image/svg+xml']) {
      expect(isClipboardReadyType(mime)).toBe(false)
    }
  })
})
