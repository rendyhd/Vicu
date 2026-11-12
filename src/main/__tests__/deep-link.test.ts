import { describe, expect, it } from 'vitest'
import { deepLinkFromArgv, parseDeepLink, quickEntryText } from '../deep-link'

describe('vicu:// links', () => {
  it('reads a task link', () => {
    expect(parseDeepLink('vicu://task/42')).toEqual({ kind: 'task', id: 42 })
    expect(parseDeepLink('vicu:task/42')).toEqual({ kind: 'task', id: 42 })
    expect(parseDeepLink('vicu://task/0')).toBeNull()
    expect(parseDeepLink('vicu://task/abc')).toBeNull()
    expect(parseDeepLink('vicu://task/-3')).toBeNull()
  })

  it('reads an add link and cleans its text', () => {
    expect(parseDeepLink('vicu://add?title=Call%20Jan&project=Work%20stuff&due=tomorrow')).toEqual({
      kind: 'add', title: 'Call Jan', project: 'Work stuff', due: 'tomorrow',
    })
    expect(parseDeepLink('vicu://add?title=Two%0Alines')).toEqual({ kind: 'add', title: 'Two lines', project: null, due: null })
    expect(parseDeepLink('vicu://add?title=%20')).toBeNull()
    expect(parseDeepLink('vicu://add')).toBeNull()
  })

  it('reads a view link and ignores what it does not know', () => {
    expect(parseDeepLink('vicu://view/today')).toEqual({ kind: 'view', view: 'today' })
    expect(parseDeepLink('vicu://view/Flagged')).toEqual({ kind: 'view', view: 'flagged' })
    expect(parseDeepLink('vicu://view/settings')).toBeNull()
    expect(parseDeepLink('vicu://delete/5')).toBeNull()
    expect(parseDeepLink('https://example.com/task/5')).toBeNull()
    expect(parseDeepLink('not a link')).toBeNull()
  })

  it('finds the link among launch arguments', () => {
    expect(deepLinkFromArgv(['C:\Vicu\Vicu.exe', '--hidden', 'vicu://task/7'])).toEqual({ kind: 'task', id: 7 })
    expect(deepLinkFromArgv(['vicu', '--quick-entry'])).toBeNull()
  })

  it('builds the Quick Entry text in the syntax in use', () => {
    const link = { kind: 'add' as const, title: 'Send deck', project: 'Big launch', due: 'friday' }
    expect(quickEntryText(link, '#')).toBe('Send deck #"Big launch" friday')
    expect(quickEntryText({ ...link, project: 'Work', due: null }, '+')).toBe('Send deck +Work')
  })
})
