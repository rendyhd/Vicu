import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  escapeHtml,
  hasRichDescriptionBody,
  isAllowedDescriptionUrl,
  normalizeEditableLink,
  plainTextFromDescriptionLines,
  plainTextToDescriptionHtml,
  resolveOpenableDescriptionHref,
  withLineBreaksAsNewlines,
} from '../description-html'

describe('description link policy', () => {
  it.each(['https://example.com/a', 'http://localhost:3456', 'mailto:user@example.com'])(
    'allows %s',
    (url) => expect(isAllowedDescriptionUrl(url)).toBe(true),
  )

  it.each(['javascript:alert(1)', 'data:text/html,x', '//example.com', '/relative', 'https://exa mple.com'])(
    'rejects %s',
    (url) => expect(isAllowedDescriptionUrl(url)).toBe(false),
  )

  it('normalizes a bare host to HTTPS', () => {
    expect(normalizeEditableLink('example.com/path')).toBe('https://example.com/path')
  })

  it('resolveOpenableDescriptionHref accepts http(s) and mailto', () => {
    expect(resolveOpenableDescriptionHref('https://example.com')).toBe('https://example.com')
    expect(resolveOpenableDescriptionHref('mailto:a@b.com')).toBe('mailto:a@b.com')
    expect(resolveOpenableDescriptionHref('javascript:alert(1)')).toBeNull()
  })
})

describe('hasRichDescriptionBody', () => {
  it.each(['', '<p>Plain text<br>next line</p>', 'legacy plain text'])(
    'keeps plain descriptions editable in Quick View: %s',
    (html) => expect(hasRichDescriptionBody(html)).toBe(false),
  )

  it.each([
    '<p><strong>bold</strong></p>',
    '<ul><li>one</li></ul>',
    '<ul data-type="taskList"><li data-type="taskItem" data-checked="false">one</li></ul>',
    '<h2>Heading</h2>',
    '<table><tbody><tr><td>cell</td></tr></tbody></table>',
  ])('protects rich descriptions from plain-text editing: %s', (html) => {
    expect(hasRichDescriptionBody(html)).toBe(true)
  })
})

describe('escapeHtml', () => {
  it('escapes the characters that can start markup or end an attribute', () => {
    expect(escapeHtml(`<a href="x">&</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;')
  })

  it('escapes the ampersand first, so entities are not escaped twice into something else', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;')
  })
})

describe('plainTextToDescriptionHtml (plain text typed in Quick Entry or Quick View)', () => {
  it('is empty for nothing at all', () => {
    expect(plainTextToDescriptionHtml('')).toBe('')
    expect(plainTextToDescriptionHtml('  \n \r\n\t ')).toBe('')
  })

  it('wraps a single line in one paragraph', () => {
    expect(plainTextToDescriptionHtml('Hello notes')).toBe('<p>Hello notes</p>')
  })

  it('makes one paragraph per line', () => {
    expect(plainTextToDescriptionHtml('Line one\nLine two')).toBe('<p>Line one</p>\n<p>Line two</p>')
    expect(plainTextToDescriptionHtml('Line one\r\nLine two\rLine three')).toBe(
      '<p>Line one</p>\n<p>Line two</p>\n<p>Line three</p>',
    )
  })

  it('leaves out blank lines and the whitespace around a line', () => {
    expect(plainTextToDescriptionHtml('  one  \n\n\n   \ntwo\n')).toBe('<p>one</p>\n<p>two</p>')
  })

  it('escapes markup, so text that looks like HTML stays text', () => {
    expect(plainTextToDescriptionHtml('<script>alert(1)</script> & "quoted"')).toBe(
      '<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quoted&quot;</p>',
    )
    expect(plainTextToDescriptionHtml('<strong>not bold</strong>')).toBe('<p>&lt;strong&gt;not bold&lt;/strong&gt;</p>')
  })

  it('is still a plain description for Quick View, which only edits plain ones', () => {
    expect(hasRichDescriptionBody(plainTextToDescriptionHtml('a <b> c\n<script>'))).toBe(false)
  })

  it('matches the plain-text fixtures of the description format contract', () => {
    const corpus = JSON.parse(readFileSync(join(process.cwd(), 'test-fixtures', 'description-format-v1.json'), 'utf8')) as {
      fixtures: Array<{ name: string; input: string; canonical: string }>
    }
    const plain = corpus.fixtures.filter((fixture) => fixture.name.startsWith('legacy-'))
    expect(plain.length).toBeGreaterThanOrEqual(2)
    for (const fixture of plain) {
      expect(plainTextToDescriptionHtml(fixture.input), fixture.name).toBe(fixture.canonical)
    }
  })
})

describe('reading a plain description back into a text box', () => {
  // What Quick View does: line breaks marked, tags dropped (it sanitizes through the DOM and reads
  // textContent), then the lines tidied.
  const text = (html: string) => plainTextFromDescriptionLines(withLineBreaksAsNewlines(html).replace(/<[^>]*>/g, ''))

  it('ends a line at every paragraph and every <br>', () => {
    expect(text('<p>one</p><p>two</p>')).toBe('one\ntwo')
    expect(text('<p>one<br>two</p>')).toBe('one\ntwo')
    expect(text('<p>one<br/>two<BR />three</p>')).toBe('one\ntwo\nthree')
  })

  it('keeps the tags, only adding the line breaks', () => {
    expect(withLineBreaksAsNewlines('<p>a</p><p>b<br>c</p>')).toBe('<p>a</p>\n<p>b<br>\nc</p>\n')
  })

  it('round-trips the text a user typed', () => {
    for (const typed of ['one', 'one\ntwo', 'three lines\nof\ntext']) {
      expect(text(plainTextToDescriptionHtml(typed))).toBe(typed)
    }
  })

  it('trims the line breaks around the text', () => {
    expect(plainTextFromDescriptionLines('\n\none\n\n\ntwo\n')).toBe('one\ntwo')
    expect(plainTextFromDescriptionLines('')).toBe('')
  })
})
