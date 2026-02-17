import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useProjects } from '@/hooks/use-projects'
import { useLabels } from '@/hooks/use-labels'
import type { CustomList, CustomListFilter } from '@/lib/vikunja-types'

interface CustomListDialogProps {
  open: boolean
  list?: CustomList | null
  onSave: (list: CustomList) => void
  onClose: () => void
}

const SORT_OPTIONS = [
  { value: 'due_date', label: 'Due Date' },
  { value: 'priority', label: 'Priority' },
  { value: 'created', label: 'Created' },
  { value: 'updated', label: 'Updated' },
  { value: 'title', label: 'Title' },
] as const

const DUE_DATE_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'today', label: 'Today' },
  { value: 'this_week', label: 'This Week' },
  { value: 'this_month', label: 'This Month' },
  { value: 'has_due_date', label: 'Has Due Date' },
  { value: 'no_due_date', label: 'No Due Date' },
] as const

const PRIORITY_OPTIONS = [
  { value: 0, label: 'None' },
  { value: 1, label: 'Low' },
  { value: 2, label: 'Medium' },
  { value: 3, label: 'High' },
  { value: 4, label: 'Urgent' },
]

const DEFAULT_FILTER: CustomListFilter = {
  project_ids: [],
  sort_by: 'due_date',
  order_by: 'asc',
  due_date_filter: 'all',
}

export function CustomListDialog({ open, list, onSave, onClose }: CustomListDialogProps) {
  const [name, setName] = useState('')
  const [filter, setFilter] = useState<CustomListFilter>(DEFAULT_FILTER)
  const { data: projectData } = useProjects()
  const { data: labels } = useLabels()

  useEffect(() => {
    if (list) {
      setName(list.name)
      setFilter({ ...DEFAULT_FILTER, ...list.filter })
    } else {
      setName('')
      setFilter(DEFAULT_FILTER)
    }
  }, [list, open])

  if (!open) return null

  const handleSave = () => {
    const trimmed = name.trim()
    if (!trimmed) return

    onSave({
      id: list?.id ?? crypto.randomUUID(),
      name: trimmed,
      filter,
    })
  }

  const toggleProjectId = (id: number) => {
    setFilter((prev) => {
      const ids = prev.project_ids.includes(id)
        ? prev.project_ids.filter((p) => p !== id)
        : [...prev.project_ids, id]
      return { ...prev, project_ids: ids }
    })
  }

  const togglePriority = (val: number) => {
    setFilter((prev) => {
      const current = prev.priority_filter ?? []
      const next = current.includes(val)
        ? current.filter((p) => p !== val)
        : [...current, val]
      return { ...prev, priority_filter: next.length > 0 ? next : undefined }
    })
  }

  const toggleLabel = (id: number) => {
    setFilter((prev) => {
      const current = prev.label_ids ?? []
      const next = current.includes(id)
        ? current.filter((l) => l !== id)
        : [...current, id]
      return { ...prev, label_ids: next.length > 0 ? next : undefined }
    })
  }

  const allProjects = projectData?.flat ?? []

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-[440px] max-h-[80vh] overflow-y-auto rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border-color)] px-5 py-3">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">
            {list ? 'Edit List' : 'New List'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {/* Name */}
          <div>
            <label className="mb-1 block text-xs text-[var(--text-secondary)]">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My List"
              autoFocus
              className="w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:border-accent-blue focus:outline-none"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSave()
              }}
            />
          </div>

          {/* Sort + Order */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="mb-1 block text-xs text-[var(--text-secondary)]">Sort By</label>
              <select
                value={filter.sort_by}
                onChange={(e) => setFilter((f) => ({ ...f, sort_by: e.target.value as CustomListFilter['sort_by'] }))}
                className="w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-accent-blue focus:outline-none"
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <label className="mb-1 block text-xs text-[var(--text-secondary)]">Order</label>
              <select
                value={filter.order_by}
                onChange={(e) => setFilter((f) => ({ ...f, order_by: e.target.value as 'asc' | 'desc' }))}
                className="w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-accent-blue focus:outline-none"
              >
                <option value="asc">Ascending</option>
                <option value="desc">Descending</option>
              </select>
            </div>
          </div>

          {/* Due Date Filter */}
          <div>
            <label className="mb-1 block text-xs text-[var(--text-secondary)]">Due Date</label>
            <select
              value={filter.due_date_filter}
              onChange={(e) => setFilter((f) => ({ ...f, due_date_filter: e.target.value as CustomListFilter['due_date_filter'] }))}
              className="w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-accent-blue focus:outline-none"
            >
              {DUE_DATE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* Projects */}
          <div>
            <label className="mb-1 block text-xs text-[var(--text-secondary)]">
              Projects {filter.project_ids.length === 0 && <span className="text-[var(--text-secondary)]">(all)</span>}
            </label>
            <div className="max-h-32 overflow-y-auto rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] p-2">
              {allProjects.map((p) => (
                <label
                  key={p.id}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                >
                  <input
                    type="checkbox"
                    checked={filter.project_ids.includes(p.id)}
                    onChange={() => toggleProjectId(p.id)}
                    className="accent-accent-blue"
                  />
                  {p.title}
                </label>
              ))}
              {allProjects.length === 0 && (
                <p className="px-2 py-1 text-xs text-[var(--text-secondary)]">No projects found</p>
              )}
            </div>
          </div>

          {/* Priority */}
          <div>
            <label className="mb-1 block text-xs text-[var(--text-secondary)]">
              Priority {!filter.priority_filter?.length && <span className="text-[var(--text-secondary)]">(any)</span>}
            </label>
            <div className="flex flex-wrap gap-2">
              {PRIORITY_OPTIONS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => togglePriority(p.value)}
                  className={cn(
                    'rounded-md border px-3 py-1 text-xs font-medium transition-colors',
                    filter.priority_filter?.includes(p.value)
                      ? 'border-accent-blue bg-accent-blue/10 text-accent-blue'
                      : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:border-[var(--text-secondary)]'
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Labels */}
          {labels && labels.length > 0 && (
            <div>
              <label className="mb-1 block text-xs text-[var(--text-secondary)]">
                Labels {!filter.label_ids?.length && <span className="text-[var(--text-secondary)]">(any)</span>}
              </label>
              <div className="max-h-32 overflow-y-auto rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] p-2">
                {labels.map((l) => (
                  <label
                    key={l.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                  >
                    <input
                      type="checkbox"
                      checked={filter.label_ids?.includes(l.id) ?? false}
                      onChange={() => toggleLabel(l.id)}
                      className="accent-accent-blue"
                    />
                    {l.title}
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Include Done */}
          <label className="flex cursor-pointer items-center gap-2 text-xs text-[var(--text-primary)]">
            <input
              type="checkbox"
              checked={filter.include_done ?? false}
              onChange={(e) => setFilter((f) => ({ ...f, include_done: e.target.checked || undefined }))}
              className="accent-accent-blue"
            />
            Include completed tasks
          </label>

          {/* Include today from all projects */}
          <label className="flex cursor-pointer items-center gap-2 text-xs text-[var(--text-primary)]">
            <input
              type="checkbox"
              checked={filter.include_today_all_projects ?? false}
              onChange={(e) => setFilter((f) => ({ ...f, include_today_all_projects: e.target.checked || undefined }))}
              className="accent-accent-blue"
            />
            Include tasks due today from all projects
          </label>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-[var(--border-color)] px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-[var(--border-color)] px-4 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!name.trim()}
            className={cn(
              'rounded-md px-4 py-1.5 text-xs font-medium transition-colors',
              'bg-accent-blue text-white hover:bg-accent-blue/90',
              'disabled:cursor-not-allowed disabled:opacity-50'
            )}
          >
            {list ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}
