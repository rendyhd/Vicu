import { describe, expect, it } from 'vitest'
import { hasUnsavedNotes, notesAfterServerChange, notesBaseAfterSave, notesBaseAfterServerChange } from '../notes-sync'

describe('the base of a notes save (description format, "Notes changed in two places")', () => {
  it('follows the server while the editor holds no unsaved text', () => {
    expect(notesBaseAfterServerChange({ edit: '<p>a</p>', baseline: '<p>a</p>' }, '<p>a</p>', '<p>a and b</p>')).toBe('<p>a and b</p>')
    expect(notesBaseAfterServerChange({ edit: '<p>old</p>', baseline: null }, '<p>old</p>', '<p>new</p>')).toBe('<p>new</p>')
  })

  it('keeps the base unsaved text was typed on', () => {
    expect(notesBaseAfterServerChange({ edit: '<p>a, mine</p>', baseline: '<p>a</p>' }, '<p>a</p>', '<p>a, theirs</p>')).toBe('<p>a</p>')
  })

  it('after a save is what the server answered, or what was saved when it was queued', () => {
    expect(notesBaseAfterSave('<p>a</p>', '<p>a</p>', false)).toBe('<p>a</p>')
    expect(notesBaseAfterSave('<p>b</p><hr><p>a</p>', '<p>a</p>', false)).toBe('<p>b</p><hr><p>a</p>')
    expect(notesBaseAfterSave(null, '<p>a</p>', false)).toBe('<p>a</p>')
  })

  it('stays what was saved when the server holds other notes and newer text is still unsaved', () => {
    expect(notesBaseAfterSave('<p>b</p><hr><p>a</p>', '<p>a</p>', true)).toBe('<p>a</p>')
    expect(notesBaseAfterSave('<p>a</p>', '<p>a</p>', true)).toBe('<p>a</p>')
  })
})

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
