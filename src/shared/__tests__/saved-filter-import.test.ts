import { describe, expect, it } from 'vitest'
import { importOutcomeText, startsTicked } from '../saved-filter-import'

// The fixture-driven vectors (sections 3.7 and 3.9) live in cross-app-semantics-suite.ts. This file
// covers the words of the toast and which rows start ticked.

describe('saved-filter import', () => {
  it('says what an import or a set of answers did', () => {
    expect(importOutcomeText({ count: 1, list_id: 'a' })).toBe('Imported 1 list')
    expect(importOutcomeText({ count: 3, list_id: 'a' })).toBe('Imported 3 lists')
    expect(importOutcomeText({ count: 0, list_id: 'a', updated: 1, skipped: 0 })).toBe('Updated 1 list')
    expect(importOutcomeText({ count: 2, list_id: 'a', updated: 2, skipped: 1 })).toBe('Imported 2 lists, updated 2 lists, skipped 1')
    expect(importOutcomeText({ count: 0, list_id: null, updated: 0, skipped: 2 })).toBe('Skipped 2')
  })

  it('ticks a source changed in Vikunja, but not one only changed in Vicu', () => {
    expect(startsTicked('vikunja')).toBe(true)
    expect(startsTicked('both')).toBe(true)
    expect(startsTicked('differs')).toBe(true)
    expect(startsTicked('vicu')).toBe(false)
    expect(startsTicked('same')).toBe(false)
  })
})
