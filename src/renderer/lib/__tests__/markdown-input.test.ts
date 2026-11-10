import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { markdownHref, markdownPasteContent, markdownToDescriptionHtml } from '../markdown-input'

interface Vector {
  name: string
  markdown: string
  html: string
  isMarkdown: boolean
}

const vectors = (
  JSON.parse(readFileSync(join(process.cwd(), 'test-fixtures', 'description-format-v1.json'), 'utf8')) as {
    markdown: Vector[]
  }
).markdown

describe('markdown input vectors (description format, "Markdown input")', () => {
  it('has vectors', () => expect(vectors.length).toBeGreaterThanOrEqual(30))

  it.each(vectors.map((v) => [v.name, v] as const))('%s', (_name, vector) => {
    const result = markdownToDescriptionHtml(vector.markdown)
    expect(result.html).toBe(vector.html)
    expect(result.markdown).toBe(vector.isMarkdown)
  })
})

describe('markdownPasteContent', () => {
  it('pastes plain text as before', () => {
    expect(markdownPasteContent('Just words\nand more')).toBeNull()
    expect(markdownPasteContent('See https://example.com')).toBeNull()
    expect(markdownPasteContent('')).toBeNull()
  })

  it('puts one paragraph into the current line (rendyhd/Vicu#66)', () => {
    expect(markdownPasteContent('[Link Text](http://www.example.com)')).toEqual({
      inline: true,
      html: '<a href="http://www.example.com">Link Text</a>',
    })
  })

  it('inserts blocks without the newlines between them, keeping code lines', () => {
    expect(markdownPasteContent('# A\n\n```\n\n\n```\n- b')).toEqual({
      inline: false,
      html: '<h1>A</h1><pre><code>\n</code></pre><ul><li><p>b</p></li></ul>',
    })
    expect(markdownPasteContent('**a**\n**b**')).toEqual({ inline: false, html: '<p><strong>a</strong></p><p><strong>b</strong></p>' })
  })
})

describe('markdownHref', () => {
  it.each(['https://example.com', 'HTTP://x', 'mailto:me@example.com'])('accepts %s', (url) => {
    expect(markdownHref(url)).toBe(url)
  })

  it.each(['https://', 'mailto:', 'javascript:alert(1)', '/relative', 'www.example.com', 'https://a b', 'ftp://x'])(
    'refuses %s',
    (url) => expect(markdownHref(url)).toBeNull(),
  )
})
