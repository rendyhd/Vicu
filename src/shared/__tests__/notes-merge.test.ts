import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { decideNotesSave, mergeNotes, NOTES_MERGE_DIVIDER } from '../notes-merge'

interface Vector {
  name: string
  base: string | null
  local: string | null
  server: string | null
  expect: { action: 'nothing' | 'send' | 'merge'; description?: string }
}

const vectors = (JSON.parse(
  readFileSync(join(process.cwd(), 'test-fixtures', 'description-format-v1.json'), 'utf8'),
) as { notesConflict: Vector[] }).notesConflict

describe('decideNotesSave', () => {
  it('has vectors for every answer', () => {
    expect(vectors.length).toBeGreaterThanOrEqual(18)
    for (const action of ['nothing', 'send', 'merge']) {
      expect(vectors.some((vector) => vector.expect.action === action)).toBe(true)
    }
  })

  it.each(vectors.map((vector) => [vector.name, vector] as const))('%s', (_name, vector) => {
    expect(decideNotesSave(vector.base, vector.local, vector.server)).toEqual(vector.expect)
  })

  it('keeps every word of both versions when it merges', () => {
    const merged = decideNotesSave('<p>Base</p>', '<p>Base</p><p>Mine</p>', '<p>Theirs</p>')
    expect(merged).toEqual({ action: 'merge', description: `<p>Theirs</p>${NOTES_MERGE_DIVIDER}<p>Base</p><p>Mine</p>` })
  })

  it('merging the merged notes again adds nothing', () => {
    const once = mergeNotes('<p>Theirs</p>\n[[image:1]]', '<p>Mine</p>\n[[image:2]]')
    // The next save starts from what the server now holds.
    expect(decideNotesSave(once, once, once)).toEqual({ action: 'nothing' })
  })

  it('takes a missing description as no notes', () => {
    expect(decideNotesSave(undefined, null, '')).toEqual({ action: 'nothing' })
    expect(decideNotesSave(undefined, '<p>Mine</p>', null)).toEqual({ action: 'send', description: '<p>Mine</p>' })
  })
})
