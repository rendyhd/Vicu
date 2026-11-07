import { describe, expect, it } from 'vitest'
import { noteFoldHeight, shownNoteHeight } from './note-fold'

describe('note fold', () => {
  it('folds at half the visible height, with a floor', () => {
    expect(noteFoldHeight(900)).toBe(450)
    expect(noteFoldHeight(300)).toBe(200)
  })

  it('shows short notes and notes just past the fold whole', () => {
    expect(shownNoteHeight(300, 450, false)).toBe(300)
    expect(shownNoteHeight(506, 450, false)).toBe(506)
  })

  it('stops long notes at the fold until they are opened', () => {
    expect(shownNoteHeight(507, 450, false)).toBe(450)
    expect(shownNoteHeight(2000, 450, true)).toBe(2000)
  })
})
