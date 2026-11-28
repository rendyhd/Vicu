import { describe, expect, it } from 'vitest'
import { getClipboardImages, getTitlePasteImages } from '../clipboard-images'

function pasteEvent(entries: { text?: string; images?: string[] }): ClipboardEvent {
  const items = (entries.images ?? []).map((type) => ({
    kind: 'file',
    type,
    getAsFile: () => new File([new Uint8Array([1, 2, 3])], 'image.png', { type }),
  }))
  if (entries.text !== undefined) {
    items.push({ kind: 'string', type: 'text/plain', getAsFile: () => null as unknown as File })
  }
  const clipboardData = {
    items: Object.assign(items, { length: items.length }),
    getData: (type: string) => (type === 'text/plain' ? entries.text ?? '' : ''),
  }
  return { clipboardData } as unknown as ClipboardEvent
}

describe('getTitlePasteImages', () => {
  it('takes a pasted screenshot', () => {
    const images = getTitlePasteImages(pasteEvent({ images: ['image/png'] }))
    expect(images).toHaveLength(1)
    expect(images[0].mime).toBe('image/png')
    expect(images[0].name).toMatch(/^pasted-\d+\.png$/)
  })

  it('leaves a paste with text to the title, even with a picture of it', () => {
    const event = pasteEvent({ text: 'Call the bank', images: ['image/png'] })
    expect(getTitlePasteImages(event)).toEqual([])
    // The notes still take the picture, as before.
    expect(getClipboardImages(event)).toHaveLength(1)
  })

  it('takes the image when the text is only white space', () => {
    expect(getTitlePasteImages(pasteEvent({ text: ' \n', images: ['image/jpeg'] }))).toHaveLength(1)
  })

  it('finds nothing in a text paste', () => {
    expect(getTitlePasteImages(pasteEvent({ text: 'Buy milk' }))).toEqual([])
  })
})
