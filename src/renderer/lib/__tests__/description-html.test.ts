import { describe, expect, it } from 'vitest'
import {
  hasRichDescriptionBody,
  isAllowedDescriptionUrl,
  normalizeEditableLink,
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
