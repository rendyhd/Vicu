import { describe, expect, it } from 'vitest'
import { stepImage, viewableImageType, viewableImages } from '../attachment-preview'

describe('viewableImageType', () => {
  it('takes the server type when it is an image the viewer draws', () => {
    expect(viewableImageType({ mime: 'image/png', name: 'shot.png' })).toBe('image/png')
    expect(viewableImageType({ mime: 'image/jpeg', name: 'IMG_0001' })).toBe('image/jpeg')
    expect(viewableImageType({ mime: 'IMAGE/WebP; charset=binary', name: 'a.webp' })).toBe('image/webp')
    expect(viewableImageType({ mime: 'image/svg+xml', name: 'logo.svg' })).toBe('image/svg+xml')
  })

  it('leaves images the viewer cannot draw to the default app', () => {
    expect(viewableImageType({ mime: 'image/heic', name: 'IMG_0002.heic' })).toBeNull()
    expect(viewableImageType({ mime: 'image/tiff', name: 'scan.jpg' })).toBeNull()
    expect(viewableImageType({ mime: '', name: 'scan.tiff' })).toBeNull()
  })

  it('falls back to the extension when the server has no image type', () => {
    expect(viewableImageType({ mime: 'application/octet-stream', name: 'Photo.JPG' })).toBe('image/jpeg')
    expect(viewableImageType({ mime: '', name: 'diagram.svg' })).toBe('image/svg+xml')
    expect(viewableImageType({ mime: null, name: 'pasted.png' })).toBe('image/png')
  })

  it('does not take other files for images', () => {
    expect(viewableImageType({ mime: 'application/pdf', name: 'invoice.pdf' })).toBeNull()
    expect(viewableImageType({ mime: 'text/plain', name: 'notes' })).toBeNull()
    expect(viewableImageType({ mime: '', name: 'png' })).toBeNull()
    expect(viewableImageType({})).toBeNull()
  })
})

describe('viewableImages', () => {
  it('keeps the images in order with a name for each', () => {
    const attachments = [
      { id: 1, file: { mime: 'image/png', name: 'one.png' } },
      { id: 2, file: { mime: 'application/pdf', name: 'two.pdf' } },
      { id: 3, file: { mime: 'application/octet-stream', name: 'three.gif' } },
      { id: 4, file: { mime: 'image/jpeg', name: '' } },
    ]
    expect(viewableImages(attachments)).toEqual([
      { id: 1, name: 'one.png', mime: 'image/png' },
      { id: 3, name: 'three.gif', mime: 'image/gif' },
      { id: 4, name: 'Image 4', mime: 'image/jpeg' },
    ])
    expect(viewableImages(null)).toEqual([])
  })
})

describe('stepImage', () => {
  it('goes round at both ends', () => {
    expect(stepImage(0, 3, 1)).toBe(1)
    expect(stepImage(2, 3, 1)).toBe(0)
    expect(stepImage(0, 3, -1)).toBe(2)
    expect(stepImage(0, 1, 1)).toBe(0)
    expect(stepImage(0, 0, -1)).toBe(0)
  })
})
