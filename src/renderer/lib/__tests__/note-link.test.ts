import { describe, expect, it } from 'vitest'
import { extractNoteLink, extractNoteLinkHtml, extractTaskLink, hasNotesContent, notesPreview, stripNoteLink } from '../note-link'

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

describe('extractNoteLink', () => {
  const pair = (url: string, name = 'Runbook') => {
    const escaped = url.replace(/&/g, '&amp;')
    return `<p>Body</p><!-- notelink:${escaped} --><p><a href="${escaped}">\u{1F4CE} ${name}</a></p>`
  }

  it('reads the two links Vicu writes', () => {
    expect(extractNoteLink(pair('obsidian://open?vault=Personal&file=Tasks%2FRunbook'))).toEqual({
      url: 'obsidian://open?vault=Personal&file=Tasks%2FRunbook',
      name: 'Runbook',
      app: 'obsidian',
    })
    expect(extractNoteLink(pair('obsidian://advanced-uri?vault=Personal&uid=42'))?.url).toBe(
      'obsidian://advanced-uri?vault=Personal&uid=42',
    )
  })

  it('gives no link for an Obsidian address that does more than open a note', () => {
    for (const url of [
      'obsidian://advanced-uri?vault=Personal&commandid=shell-commands%3Arun',
      'obsidian://advanced-uri?vault=Personal&uid=42&commandid=app%3Adelete-file',
      'obsidian://advanced-uri?vault=Personal&filepath=a.md&data=x&mode=overwrite',
      'obsidian://new?vault=Personal&file=Inbox&content=x&overwrite=true',
      'obsidian://open?vault=Ops',
    ]) {
      expect(extractNoteLink(pair(url, 'Meeting notes'))).toBeNull()
      expect(extractTaskLink(pair(url, 'Meeting notes'))).toBeNull()
    }
  })

  it('keeps a refused marker in the description', () => {
    const refused = pair('obsidian://advanced-uri?vault=Personal&commandid=x')
    expect(extractNoteLinkHtml(refused)).toContain('notelink:obsidian://advanced-uri')
    expect(stripNoteLink(refused)).toBe('<p>Body</p>')
  })

  it('still offers the page link of a task whose note link is refused', () => {
    const both = `${pair('obsidian://new?vault=V&file=a')}<!-- pagelink:https://example.com/a --><p><a href="https://example.com/a">\u{1F517} A page</a></p>`
    expect(extractTaskLink(both)).toMatchObject({ kind: 'page', url: 'https://example.com/a' })
  })
})
