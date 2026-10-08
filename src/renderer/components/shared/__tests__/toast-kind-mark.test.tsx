import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ToastKindMark } from '../ToastKindMark'

describe('ToastKindMark', () => {
  it('names each kind and draws a different shape for it, not only a colour', () => {
    const shapes = new Set<string>()
    for (const [kind, label] of [
      ['error', 'Error'],
      ['success', 'Success'],
      ['info', 'Information'],
    ] as const) {
      const html = renderToStaticMarkup(<ToastKindMark kind={kind} />)
      expect(html).toContain('role="img"')
      expect(html).toContain(`aria-label="${label}"`)
      expect(html).toContain('aria-hidden="true"')
      shapes.add(html.match(/<svg[\s\S]*<\/svg>/)?.[0] ?? '')
    }
    expect(shapes.size).toBe(3)
  })
})
