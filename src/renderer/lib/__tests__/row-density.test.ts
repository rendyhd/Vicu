import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { hasNotesContent, notesPreview } from '../note-link'

const fixture = JSON.parse(readFileSync(resolve(__dirname, '../../../../test-fixtures/design-tokens-v1.json'), 'utf-8'))

describe('row density', () => {
  it('has the values of the shared fixture, which the row classes follow', () => {
    expect(fixture.rowDensity.default).toBe('compact')
    expect(fixture.rowDensity.compact).toEqual({ titleLines: 1, notesLines: 0 })
    expect(fixture.rowDensity.comfortable).toEqual({ titleLines: 3, notesLines: 1 })
  })
})

describe('notesPreview', () => {
  it('is the plain text on one line', () => {
    expect(notesPreview('<p>Call the <b>bank</b></p><p>Ask for Sam</p>')).toBe('Call the bank Ask for Sam')
    expect(notesPreview('<ul><li>One</li><li>Two</li></ul>')).toBe('One Two')
    expect(notesPreview('<p>First<br>second<br/>third</p>')).toBe('First second third')
  })

  it('decodes entities once', () => {
    expect(notesPreview('<p>Salt &amp; pepper&nbsp;&lt;3 &#39;a&#39; &#x41;</p>')).toBe("Salt & pepper <3 'a' A")
    expect(notesPreview('<p>&amp;lt;</p>')).toBe('&lt;')
  })

  it('leaves out link markers and images', () => {
    const note = '<!-- notelink:obsidian://open?file=a --><p><a href="obsidian://open?file=a">\u{1F4CE} A note</a></p>'
    const page = '<!-- pagelink:https://example.com --><p><a href="https://example.com">\u{1F517} A page</a></p>'
    expect(notesPreview(`<p>Text</p>${note}${page}`)).toBe('Text')
    expect(notesPreview(note)).toBe('')
    expect(notesPreview('<p>[[image:12]] after [[image-pending:ab-1]]</p>')).toBe('after')
    expect(notesPreview('<img src="a.png">')).toBe('')
  })

  it('leaves the icon to notes without text', () => {
    const onlyImage = '<p>[[image:12]]</p>'
    expect(hasNotesContent(onlyImage)).toBe(true)
    expect(notesPreview(onlyImage)).toBe('')
  })

  it('is empty without notes', () => {
    expect(notesPreview(null)).toBe('')
    expect(notesPreview('')).toBe('')
    expect(notesPreview('<p></p>')).toBe('')
  })
})
