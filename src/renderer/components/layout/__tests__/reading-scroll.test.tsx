import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ReadingScroll } from '../ReadingScroll'

describe('ReadingScroll width', () => {
  it('uses the reading column by default', () => {
    expect(renderToStaticMarkup(<ReadingScroll>Tasks</ReadingScroll>)).toContain('max-w-reading')
  })

  it('leaves the reading-column limit off in wide mode', () => {
    const html = renderToStaticMarkup(<ReadingScroll wide>Planner</ReadingScroll>)

    expect(html).not.toContain('max-w-reading')
    expect(html).toContain('w-full')
  })
})
