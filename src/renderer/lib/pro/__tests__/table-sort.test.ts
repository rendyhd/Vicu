import { describe, expect, it } from 'vitest'
import { nextSortKeys, sortTable, type TableColumn } from '../table-sort'

describe('nextSortKeys', () => {
  it('sorts by a clicked column, then the other way', () => {
    const once = nextSortKeys([], 'due', false)
    expect(once).toEqual([{ column: 'due', desc: false }])
    expect(nextSortKeys(once, 'due', false)).toEqual([{ column: 'due', desc: true }])
    expect(nextSortKeys([{ column: 'due', desc: true }, { column: 'title', desc: false }], 'project', false)).toEqual([{ column: 'project', desc: false }])
  })

  it('makes a Shift-clicked column the second key', () => {
    const keys = nextSortKeys([{ column: 'due', desc: false }], 'project', true)
    expect(keys).toEqual([{ column: 'due', desc: false }, { column: 'project', desc: false }])
    expect(nextSortKeys(keys, 'project', true)).toEqual([{ column: 'due', desc: false }, { column: 'project', desc: true }])
    expect(nextSortKeys(keys, 'title', true)).toEqual([{ column: 'due', desc: false }, { column: 'title', desc: false }])
  })
})

describe('sortTable', () => {
  const rows = [
    { id: 1, due: '2026-11-20', project: 'B' },
    { id: 2, due: null, project: 'A' },
    { id: 3, due: '2026-11-13', project: 'B' },
    { id: 4, due: '2026-11-13', project: 'A' },
  ]
  const valueOf = (row: (typeof rows)[number], column: TableColumn) => (column === 'due' ? row.due : column === 'project' ? row.project : null)

  it('puts missing values last both ways and keeps ties in order', () => {
    expect(sortTable(rows, [{ column: 'due', desc: false }], valueOf).map((row) => row.id)).toEqual([3, 4, 1, 2])
    expect(sortTable(rows, [{ column: 'due', desc: true }], valueOf).map((row) => row.id)).toEqual([1, 3, 4, 2])
  })

  it('uses the second key for ties', () => {
    expect(sortTable(rows, [{ column: 'due', desc: false }, { column: 'project', desc: false }], valueOf).map((row) => row.id)).toEqual([4, 3, 1, 2])
  })
})
