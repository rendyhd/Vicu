import { useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { ArrowDown, ArrowUp, Flag } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useProjects } from '@/hooks/use-projects'
import { useProLedger } from '@/hooks/use-pro-ledger'
import { useDateFormat } from '@/hooks/use-date-format'
import { useSelectionStore } from '@/stores/selection-store'
import { formatLength } from '@/lib/planner-timeline'
import { nextSortKeys, sortTable, TABLE_COLUMNS, type TableColumn, type TableSortKey, type TableValue } from '@/lib/pro/table-sort'
import type { Task } from '@/lib/vikunja-types'
import { isNoDueDate, localDateOf } from '../../../shared/due-dates'
import { estimateOf } from '../../../shared/pro/ledger'
import { startDayOf } from '../../../shared/pro/start-dates'
import { formatWeekdayDate } from '../../../shared/date-display'

const HEADERS: Record<TableColumn, string> = {
  title: 'Task',
  project: 'Project',
  due: 'Due',
  start: 'Start',
  estimate: 'Estimate',
  priority: 'Priority',
  flag: 'Flag',
}

const PRIORITY = ['', 'Low', 'Medium', 'High', 'Urgent', 'Do now']

/**
 * The task table (plan 7.7.2): a list's tasks in sortable columns. A click on a header sorts by it,
 * a Shift-click adds it as the second key. Rows select like list rows (click, Mod-click, Shift-click,
 * Space), so the selection bar and its inspector work here; Enter or a double-click opens the task in
 * the list.
 */
export function TaskTable({ tasks, onOpen }: { tasks: readonly Task[]; onOpen: (task: Task) => void }) {
  const [keys, setKeys] = useState<TableSortKey[]>([])
  const { data: projects } = useProjects()
  const { ledger } = useProLedger()
  const fmt = useDateFormat()
  const selected = useSelectionStore((s) => s.selectedTaskIds)
  const anchor = useRef<number | null>(null)
  const [focused, setFocused] = useState<number | null>(null)
  const body = useRef<HTMLTableSectionElement>(null)
  const projectTitle = useMemo(() => new Map((projects?.flat ?? []).map((project) => [project.id, project.title])), [projects?.flat])

  const valueOf = (task: Task, column: TableColumn): TableValue => {
    switch (column) {
      case 'title': return task.title
      case 'project': return projectTitle.get(task.project_id) ?? null
      case 'due': return isNoDueDate(task.due_date) ? null : localDateOf(task.due_date)
      case 'start': return startDayOf(task)
      case 'estimate': return estimateOf(ledger, task.id)
      case 'priority': return task.priority ? task.priority : null
      case 'flag': return task.is_favorite ? 1 : null
    }
  }
  const rows = useMemo(() => sortTable(tasks, keys, valueOf), [tasks, keys, ledger, projectTitle])

  const show = (task: Task, column: TableColumn): string => {
    const value = valueOf(task, column)
    if (value === null) return ''
    switch (column) {
      case 'due':
      case 'start': return formatWeekdayDate(new Date(`${value}T12:00:00`), new Date(), fmt)
      case 'estimate': return formatLength(value as number)
      case 'priority': return PRIORITY[value as number] ?? String(value)
      case 'flag': return ''
      default: return String(value)
    }
  }

  const select = (task: Task, event: MouseEvent | KeyboardEvent) => {
    const store = useSelectionStore.getState()
    const mod = window.api.platform === 'darwin' ? event.metaKey : event.ctrlKey
    if (event.shiftKey && anchor.current !== null) {
      const ids = rows.map((row) => row.id)
      const from = ids.indexOf(anchor.current)
      const to = ids.indexOf(task.id)
      if (from >= 0 && to >= 0) store.setSelectedRange(ids.slice(Math.min(from, to), Math.max(from, to) + 1))
      return
    }
    anchor.current = task.id
    if (mod || event.type === 'keydown') store.toggleSelected(task.id)
    else store.selectOnly(task.id)
  }

  const focusRow = (id: number) => {
    setFocused(id)
    requestAnimationFrame(() => body.current?.querySelector<HTMLElement>(`[data-table-task-id="${id}"]`)?.focus())
  }

  const onKeyDown = (task: Task, index: number) => (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const next = rows[index + (event.key === 'ArrowDown' ? 1 : -1)]
      if (next) {
        if (event.shiftKey) select(next, event)
        focusRow(next.id)
      }
    } else if (event.key === ' ') {
      event.preventDefault()
      select(task, event)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      onOpen(task)
    }
  }

  const sortOf = (column: TableColumn) => {
    const index = keys.findIndex((key) => key.column === column)
    return index < 0 ? null : { index, desc: keys[index].desc }
  }

  return (
    <div className="overflow-x-auto px-4 pb-4" data-task-table>
      <table role="grid" aria-label="Tasks" aria-multiselectable="true" className="w-full border-collapse text-meta">
        <thead>
          <tr className="border-b border-border text-left text-text-secondary">
            {TABLE_COLUMNS.map((column) => {
              const sort = sortOf(column)
              return (
                <th key={column} scope="col" aria-sort={sort?.index === 0 ? (sort.desc ? 'descending' : 'ascending') : 'none'} className={cn('py-1.5 pr-3 font-medium', column === 'title' && 'w-full')}>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-control px-1 hover:bg-bg-hover hover:text-text"
                    title="Click to sort, Shift-click for a second key"
                    onClick={(event) => setKeys((current) => nextSortKeys(current, column, event.shiftKey))}
                  >
                    {HEADERS[column]}
                    {sort && (sort.desc ? <ArrowDown className="h-3 w-3" aria-hidden /> : <ArrowUp className="h-3 w-3" aria-hidden />)}
                    {sort?.index === 1 && <span className="text-caption" aria-label="second key">2</span>}
                  </button>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody ref={body}>
          {rows.map((task, index) => {
            const isSelected = selected.has(task.id)
            return (
              <tr
                key={task.id}
                data-table-task-id={task.id}
                aria-selected={isSelected}
                tabIndex={(focused ?? rows[0]?.id) === task.id ? 0 : -1}
                onFocus={() => setFocused(task.id)}
                onClick={(event) => select(task, event)}
                onDoubleClick={() => onOpen(task)}
                onKeyDown={onKeyDown(task, index)}
                className={cn('cursor-default border-b border-border text-text', isSelected ? 'bg-bg-selected' : 'hover:bg-bg-hover', task.done && 'text-text-secondary line-through')}
              >
                {TABLE_COLUMNS.map((column) => (
                  <td key={column} className={cn('py-1.5 pr-3', column === 'title' ? 'max-w-0 truncate' : 'whitespace-nowrap text-text-secondary')}>
                    {column === 'flag'
                      ? task.is_favorite && <Flag role="img" aria-label="Flagged" className="h-3 w-3 fill-accent-orange text-accent-orange" />
                      : show(task, column)}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
