import { describe, expect, it } from 'vitest'
import { joinDescriptionImages, splitDescriptionImages } from '../image-tokens'

describe('splitDescriptionImages', () => {
  it('takes the image tokens out of the text, in order', () => {
    expect(splitDescriptionImages('<p>Board</p>\n[[image:17]]\n[[image-pending:ab12]]')).toEqual({
      text: '<p>Board</p>',
      images: [
        { kind: 'image', attachmentId: 17 },
        { kind: 'pending', uuid: 'ab12' },
      ],
    })
    expect(splitDescriptionImages('[[image:3]]')).toEqual({ text: '', images: [{ kind: 'image', attachmentId: 3 }] })
    expect(splitDescriptionImages('<p>Only text</p>')).toEqual({ text: '<p>Only text</p>', images: [] })
  })
})

describe('joinDescriptionImages', () => {
  it('puts the tokens after the text, one per line', () => {
    const images = splitDescriptionImages('<p>a</p>\n[[image:1]]\n[[image:2]]').images
    expect(joinDescriptionImages('<p>a</p>', images)).toBe('<p>a</p>\n[[image:1]]\n[[image:2]]')
    expect(joinDescriptionImages('', images)).toBe('[[image:1]]\n[[image:2]]')
    expect(joinDescriptionImages('<p>a</p>', [])).toBe('<p>a</p>')
  })

  it('keeps the pictures when the editor rewrites the text of a card that opens', () => {
    // The card opens: the editor gets the text alone and answers with its normalized form, which
    // becomes the card's value. Without the tokens joined back the pictures dropped out of the notes.
    const stored = 'Board photo\n[[image:17]]'
    const { text, images } = splitDescriptionImages(stored)
    const normalizedByEditor = `<p>${text}</p>`
    expect(joinDescriptionImages(normalizedByEditor, images)).toBe('<p>Board photo</p>\n[[image:17]]')
  })
})
