import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ListSkeleton } from '../ListSkeleton'

describe('ListSkeleton', () => {
  it('keeps the page header and shows four placeholder rows by default, three on request', () => {
    const html = renderToStaticMarkup(<ListSkeleton title="Today" identity="today" subtitle="Thursday, 8 October" />)
    expect(html).toContain('Today')
    expect(html).toContain('Thursday, 8 October')
    expect(html.match(/data-skeleton-row/g)).toHaveLength(4)
    expect(renderToStaticMarkup(<ListSkeleton title="Tag" rows={3} />).match(/data-skeleton-row/g)).toHaveLength(3)
  })

  it('is a busy region named after the page, with the rows hidden from assistive technology', () => {
    const html = renderToStaticMarkup(<ListSkeleton title="Inbox" />)
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('role="status"')
    expect(html).toContain('aria-label="Loading Inbox"')
    expect(html).not.toContain('Loading...')
  })
})
