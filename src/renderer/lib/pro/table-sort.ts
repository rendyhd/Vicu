// The task table's sort (plan 7.7.2): a click on a column sorts by it (again: the other way), a
// Shift-click makes it the second key. Values that are missing go last in both directions, and equal
// rows keep the list's own order.

export const TABLE_COLUMNS = ['title', 'project', 'due', 'start', 'estimate', 'priority', 'flag'] as const
export type TableColumn = (typeof TABLE_COLUMNS)[number]

export interface TableSortKey {
  column: TableColumn
  desc: boolean
}

export function nextSortKeys(keys: readonly TableSortKey[], column: TableColumn, shift: boolean): TableSortKey[] {
  const [first, second] = keys
  if (!shift || !first) {
    return first?.column === column ? [{ column, desc: !first.desc }] : [{ column, desc: false }]
  }
  if (first.column === column) return [{ column, desc: !first.desc }, ...(second ? [second] : [])]
  if (second?.column === column) return [first, { column, desc: !second.desc }]
  return [first, { column, desc: false }]
}

export type TableValue = string | number | null

export function sortTable<T>(rows: readonly T[], keys: readonly TableSortKey[], valueOf: (row: T, column: TableColumn) => TableValue): T[] {
  if (keys.length === 0) return [...rows]
  const indexed = rows.map((row, index) => ({ row, index }))
  indexed.sort((a, b) => {
    for (const key of keys) {
      const x = valueOf(a.row, key.column)
      const y = valueOf(b.row, key.column)
      if (x === y) continue
      if (x === null) return 1
      if (y === null) return -1
      const order = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { sensitivity: 'base', numeric: true })
      if (order !== 0) return key.desc ? -order : order
    }
    return a.index - b.index
  })
  return indexed.map(({ row }) => row)
}
