import { describe, expect, it } from 'vitest'
import { hasUnsavedNotes, notesAfterServerChange } from '../notes-sync'

describe('notesAfterServerChange (description format, Synchronization)', () => {
  it('a clean editor takes the newer notes, and they become its baseline', () => {
    const next = notesAfterServerChange({ edit: '<p>a</p>', baseline: '<p>a</p>' }, '<p>a and b</p>')
    expect(next).toEqual({ edit: '<p>a and b</p>', baseline: '<p>a and b</p>' })
    expect(hasUnsavedNotes(next)).toBe(false)
  })

  it('keeps unsaved text and its baseline, so the next save still goes out', () => {
    const typing = { edit: '<p>a, my line</p>', baseline: '<p>a</p>' }
    const next = notesAfterServerChange(typing, '<p>a, their line</p>')
    expect(next).toBe(typing)
    expect(hasUnsavedNotes(next)).toBe(true)
  })

  it('keeps text typed after a save while that save comes back through the cache', () => {
    // Saved "<p>x</p>", typed on; the optimistic cache now holds what was saved.
    expect(notesAfterServerChange({ edit: '<p>xy</p>', baseline: '<p>x</p>' }, '<p>x</p>').edit).toBe('<p>xy</p>')
  })

  it('follows the cache while no editor is ready (closed card)', () => {
    expect(notesAfterServerChange({ edit: '<p>old</p>', baseline: null }, '<p>new</p>')).toEqual({ edit: '<p>new</p>', baseline: null })
  })
})
