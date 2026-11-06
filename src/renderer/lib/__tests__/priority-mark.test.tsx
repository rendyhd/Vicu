import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PriorityMark } from '@/components/shared/PriorityMark'

describe('PriorityMark', () => {
  it('draws nothing for priority 0', () => {
    expect(renderToStaticMarkup(<PriorityMark priority={0} />)).toBe('')
  })

  it('names each level and uses the priority role class, all five', () => {
    const expected: [number, string, string][] = [
      [1, 'Low priority', 'text-priority-low'],
      [2, 'Medium priority', 'text-priority-medium'],
      [3, 'High priority', 'text-priority-high'],
      [4, 'Urgent priority', 'text-priority-urgent'],
      [5, 'Do now priority', 'text-priority-urgent'],
    ]
    for (const [priority, name, cls] of expected) {
      const html = renderToStaticMarkup(<PriorityMark priority={priority} />)
      expect(html).toContain(`aria-label="${name}"`)
      expect(html).toContain('role="img"')
      expect(html).toContain(cls)
    }
  })

  it('hides a decorative mark from assistive technology', () => {
    const html = renderToStaticMarkup(<PriorityMark priority={3} decorative />)
    expect(html).toContain('aria-hidden="true"')
    expect(html).not.toContain('aria-label')
  })
})
