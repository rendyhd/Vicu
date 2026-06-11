import { describe, it, expect } from 'vitest'
import { applyCustomListTaskFilter } from '../custom-list-filter'

const tasks = [
  { id: 1, project_id: 10, priority: 0, labels: [{ id: 100 }] },
  { id: 2, project_id: 20, priority: 5, labels: [] },
  { id: 3, project_id: 10, priority: 3, labels: [{ id: 200 }] },
]

describe('applyCustomListTaskFilter', () => {
  it('passes everything through with an empty filter', () => {
    expect(applyCustomListTaskFilter(tasks, {})).toHaveLength(3)
  })

  it('removes excluded projects in exclude mode', () => {
    const out = applyCustomListTaskFilter(tasks, { project_filter_mode: 'exclude', project_ids: [10] })
    expect(out.map((t) => t.id)).toEqual([2])
  })

  it('keeps only matching priorities', () => {
    const out = applyCustomListTaskFilter(tasks, { priority_filter: [3, 5] })
    expect(out.map((t) => t.id)).toEqual([2, 3])
  })

  it('keeps only tasks bearing one of the label ids', () => {
    const out = applyCustomListTaskFilter(tasks, { label_ids: [100] })
    expect(out.map((t) => t.id)).toEqual([1])
  })

  it('treats include mode project_ids as a server-side concern (no client filtering)', () => {
    const out = applyCustomListTaskFilter(tasks, { project_filter_mode: 'include', project_ids: [10] })
    expect(out).toHaveLength(3)
  })
})
