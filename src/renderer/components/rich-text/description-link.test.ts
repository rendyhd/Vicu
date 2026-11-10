import { describe, expect, it } from 'vitest'
import { getSchema } from '@tiptap/core'
import { StarterKit } from '@tiptap/starter-kit'
import { DescriptionLink } from './description-link'

const schema = getSchema([StarterKit.configure({ link: false }), DescriptionLink])

describe('DescriptionLink', () => {
  // rendyhd/Vicu#67: the editor must write only what the storage sanitizer
  // keeps, or every keystroke resets the document and a space after a link
  // is lost.
  it('renders a link with its stored attributes only', () => {
    const mark = schema.marks.link.create({ href: 'https://example.com' })
    const spec = schema.marks.link.spec.toDOM!(mark, true) as [string, Record<string, unknown>, ...unknown[]]
    const attrs = Object.fromEntries(Object.entries(spec[1]).filter(([, value]) => value != null))
    expect(spec[0]).toBe('a')
    expect(attrs).toEqual({ href: 'https://example.com' })
  })

  it('does not take in words typed at its end', () => {
    expect(schema.marks.link.spec.inclusive).toBe(false)
  })
})
