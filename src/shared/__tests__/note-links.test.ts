import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { isAllowedNoteLink, NOTE_LINK_MAX_CHARS } from '../note-links'

interface Vector {
  name: string
  url: string
  offered: boolean
}

const vectors = (JSON.parse(
  readFileSync(join(process.cwd(), 'test-fixtures', 'description-format-v1.json'), 'utf8'),
) as { noteLinks: Vector[] }).noteLinks

describe('isAllowedNoteLink', () => {
  it('has vectors for both answers', () => {
    expect(vectors.length).toBeGreaterThanOrEqual(35)
    expect(vectors.some((vector) => vector.offered)).toBe(true)
    expect(vectors.some((vector) => !vector.offered)).toBe(true)
  })

  it.each(vectors.map((vector) => [vector.name, vector] as const))('%s', (_name, vector) => {
    expect(isAllowedNoteLink(vector.url)).toBe(vector.offered)
  })

  it('offers the links Vicu writes', () => {
    const vault = encodeURIComponent('Work & Home')
    expect(isAllowedNoteLink(`obsidian://open?vault=${vault}&file=${encodeURIComponent('Projects/Q4 plan #2')}`)).toBe(true)
    expect(isAllowedNoteLink(`obsidian://advanced-uri?vault=${vault}&uid=${encodeURIComponent('a b/c')}`)).toBe(true)
  })

  it('stops at the length limit', () => {
    const base = 'obsidian://open?vault=V&file='
    expect(isAllowedNoteLink(base + 'a'.repeat(NOTE_LINK_MAX_CHARS - base.length))).toBe(true)
    expect(isAllowedNoteLink(base + 'a'.repeat(NOTE_LINK_MAX_CHARS - base.length + 1))).toBe(false)
  })

  it('takes only text', () => {
    for (const value of [null, undefined, 42, {}, ['obsidian://open?vault=V&file=a']]) {
      expect(isAllowedNoteLink(value)).toBe(false)
    }
  })

  it('does not read an inherited name as an action', () => {
    expect(isAllowedNoteLink('obsidian://constructor?vault=V&file=a')).toBe(false)
    expect(isAllowedNoteLink('obsidian://toString?vault=V&uid=a')).toBe(false)
  })
})
