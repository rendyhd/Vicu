import { describe, expect, it } from 'vitest'
import { decideLink } from '../guards'

const PAGE = 'https://vicu.example.com/#/today'

describe('a link clicked in the web version', () => {
  it('stays in the app only for an address inside the page', () => {
    expect(decideLink('#/project/3', PAGE)).toEqual({ kind: 'app' })
    expect(decideLink('https://vicu.example.com/#/inbox', PAGE)).toEqual({ kind: 'app' })
  })

  it('opens a web or mail address outside the tab', () => {
    expect(decideLink('https://example.org/a?b=1', PAGE)).toEqual({ kind: 'external', url: 'https://example.org/a?b=1' })
    expect(decideLink('http://example.org/', PAGE)).toEqual({ kind: 'external', url: 'http://example.org/' })
    expect(decideLink('mailto:ana@example.org?subject=Hi&attach=/etc/passwd', PAGE)).toEqual({
      kind: 'external',
      url: 'mailto:ana@example.org?subject=Hi',
    })
  })

  it('never lets another page of this origin replace the app', () => {
    // The API and anything else served next to the app is not the app.
    expect(decideLink('/api/v1/info', PAGE).kind).toBe('external')
    expect(decideLink('https://vicu.example.com/other', PAGE).kind).toBe('external')
  })

  it('refuses every other scheme', () => {
    for (const href of ['obsidian://open?vault=a&file=b', 'javascript:alert(1)', 'file:///C:/x', 'data:text/html,<p>x', 'vicu://task/1', 'blob:https://vicu.example.com/1']) {
      expect(decideLink(href, PAGE), href).toEqual({ kind: 'block' })
    }
  })

  it('refuses an address that does not parse', () => {
    expect(decideLink('http://[', PAGE)).toEqual({ kind: 'block' })
  })
})
