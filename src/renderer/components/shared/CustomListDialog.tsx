import { useEffect, useId, useState } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Dialog } from '@/components/overlay/Dialog'
import { ListIconPicker } from '@/components/shared/ListIconPicker'
import { useProjects } from '@/hooks/use-projects'
import { useLabels } from '@/hooks/use-labels'
import { useSharedProjectIds } from '@/hooks/use-project-access'
import { DEFAULT_CUSTOM_LIST_ICON } from '@/lib/custom-list-icons'
import {
  ASSIGNED_VALUES,
  COMMENTS_VALUES,
  changedWithinDays,
  windowHonorsIncludeOverdue,
} from '@/lib/custom-list-filter'
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
  { value: 'done_at', label: 'Completed' },
  { value: 'position', label: 'Position' },
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

// "Changed" counts local days with today included (cross-app semantics 3.3); 0 is no condition.
const CHANGED_OPTIONS = [
  { value: 0, label: 'Any time' },
  { value: 1, label: 'Today' },
  { value: 3, label: 'In the last 3 days' },
  { value: 7, label: 'In the last 7 days' },
  { value: 30, label: 'In the last 30 days' },
] as const

const ASSIGNED_OPTIONS: ReadonlyArray<{ value: (typeof ASSIGNED_VALUES)[number] | ''; label: string }> = [
  { value: '', label: 'Any task' },
  { value: 'me', label: 'To me' },
  { value: 'others', label: 'To someone else' },
  { value: 'nobody', label: 'To nobody' },
]

const COMMENTS_OPTIONS: ReadonlyArray<{ value: (typeof COMMENTS_VALUES)[number] | ''; label: string }> = [
  { value: '', label: 'Any task' },
  { value: 'unread', label: 'Unread comments' },
  { value: 'any', label: 'Has comments' },
]

/** A value this version does not offer (from a newer app) stays selectable, so saving keeps it. */
function isOffered(value: string, options: ReadonlyArray<{ value: string }>): boolean {
  return options.some((option) => option.value === value)
}

const PRIORITY_OPTIONS = [
  { value: 0, label: 'None' },
  { value: 1, label: 'Low' },
  { value: 2, label: 'Medium' },
  { value: 3, label: 'High' },
  { value: 4, label: 'Urgent' },
]

const DEFAULT_FILTER: CustomListFilter = {
  project_ids: [],
  add_to_project_id: 0,
  sort_by: 'due_date',
  order_by: 'asc',
  due_date_filter: 'all',
}

export function CustomListDialog({ open, list, onSave, onClose }: CustomListDialogProps) {
  const titleId = useId()
  const [name, setName] = useState('')
  const [icon, setIcon] = useState(DEFAULT_CUSTOM_LIST_ICON)
  const [filter, setFilter] = useState<CustomListFilter>(DEFAULT_FILTER)
  const { data: projectData } = useProjects()
  const { data: labels } = useLabels()
  const sharedProjectIds = useSharedProjectIds()

  useEffect(() => {
    if (list) {
      setName(list.name)
      setIcon(list.icon || DEFAULT_CUSTOM_LIST_ICON)
      setFilter({ ...DEFAULT_FILTER, ...list.filter })
    } else {
      setName('')
      setIcon(DEFAULT_CUSTOM_LIST_ICON)
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
      icon,
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
  const changedDays = changedWithinDays(filter)
  const assigned = typeof filter.assigned === 'string' ? filter.assigned : ''
  const comments = typeof filter.comments === 'string' ? filter.comments : ''
  // The collaboration conditions only mean something once a project is shared; a list that
  // already has one (synced from another device) shows them so they can be changed.
  const showCollaboration = sharedProjectIds.size > 0 || assigned !== '' || comments !== '' || filter.shared_only === true

  return (
    <Dialog open onClose={onClose} labelledBy={titleId} className="w-[440px]">
      <div className="flex items-center justify-between border-b border-[var(--border-color)] px-5 py-3">
        <h2 id={titleId} className="text-sm font-semibold text-[var(--text-primary)]">
          {list ? 'Edit List' : 'New List'}
        </h2>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="rounded-control p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-4 p-5">
        {/* Name */}
        <div>
          <label htmlFor={`${titleId}-name`} className="mb-1 block text-xs text-[var(--text-secondary)]">Name</label>
          <input
            id={`${titleId}-name`}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My List"
            data-autofocus
            className="w-full rounded-control border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave()
            }}
          />
        </div>

        <div>
          <span id={`${titleId}-icon`} className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">Icon</span>
          <ListIconPicker value={icon} onChange={setIcon} labelledBy={`${titleId}-icon`} allowNone />
        </div>

        {/* Sort + Order */}
        <div className="flex gap-3">
          <div className="flex-1">
            <label htmlFor={`${titleId}-sort`} className="mb-1 block text-xs text-[var(--text-secondary)]">Sort By</label>
            <select
              id={`${titleId}-sort`}
              value={filter.sort_by}
              onChange={(e) => setFilter((f) => ({ ...f, sort_by: e.target.value }))}
              className="w-full rounded-control border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)]"
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className="flex-1">
            <label htmlFor={`${titleId}-order`} className="mb-1 block text-xs text-[var(--text-secondary)]">Order</label>
            <select
              id={`${titleId}-order`}
              value={filter.order_by}
              onChange={(e) => setFilter((f) => ({ ...f, order_by: e.target.value as 'asc' | 'desc' }))}
              className="w-full rounded-control border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)]"
            >
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </select>
          </div>
        </div>

        {/* Due Date Filter */}
        <div>
          <label htmlFor={`${titleId}-due`} className="mb-1 block text-xs text-[var(--text-secondary)]">Due Date</label>
          <select
            id={`${titleId}-due`}
            value={filter.due_date_filter}
            onChange={(e) => setFilter((f) => ({ ...f, due_date_filter: e.target.value as CustomListFilter['due_date_filter'] }))}
            className="w-full rounded-control border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)]"
          >
            {DUE_DATE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          {windowHonorsIncludeOverdue(filter.due_date_filter) && (
            <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-[var(--text-primary)]">
              <input
                type="checkbox"
                checked={filter.include_overdue !== false}
                onChange={(e) => setFilter((f) => ({ ...f, include_overdue: e.target.checked ? undefined : false }))}
                className="accent-accent-blue"
              />
              Include overdue tasks
            </label>
          )}
        </div>

        {/* Changed */}
        <div>
          <label htmlFor={`${titleId}-changed`} className="mb-1 block text-xs text-[var(--text-secondary)]">Changed</label>
          <select
            id={`${titleId}-changed`}
            value={changedDays ?? 0}
            onChange={(e) => {
              const days = Number(e.target.value)
              setFilter((f) => ({ ...f, changed_within_days: days > 0 ? days : undefined }))
            }}
            className="w-full rounded-control border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)]"
          >
            {CHANGED_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
            {changedDays !== null && !CHANGED_OPTIONS.some((o) => o.value === changedDays) && (
              <option value={changedDays}>In the last {changedDays} days</option>
            )}
          </select>
        </div>

        {/* Projects */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="text-xs text-[var(--text-secondary)]">
              Projects{' '}
              {filter.project_ids.length === 0 && (
                <span className="text-[var(--text-secondary)]">
                  {(filter.project_filter_mode ?? 'include') === 'include' ? '(all)' : '(none excluded)'}
                </span>
              )}
              {filter.project_ids.length > 0 && (filter.project_filter_mode ?? 'include') === 'exclude' && (
                <span className="text-[var(--text-secondary)]">({filter.project_ids.length} excluded)</span>
              )}
            </label>
            <div className="flex overflow-hidden rounded-control border border-[var(--border-color)]">
              {(['include', 'exclude'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setFilter((f) => ({ ...f, project_filter_mode: mode, project_ids: [] }))}
                  className={cn(
                    'px-2.5 py-0.5 text-caption font-medium capitalize transition-colors',
                    (filter.project_filter_mode ?? 'include') === mode
                      ? 'bg-accent-fill text-on-accent'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                  )}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>
          <div className="max-h-32 overflow-y-auto rounded-control border border-[var(--border-color)] bg-[var(--bg-secondary)] p-2">
            {allProjects.map((p) => (
              <label
                key={p.id}
                className="flex cursor-pointer items-center gap-2 rounded-control px-2 py-1 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
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

        {/* New-task destination */}
        <div>
          <label htmlFor={`${titleId}-destination`} className="mb-1 block text-xs text-[var(--text-secondary)]">Add tasks to</label>
          <select
            id={`${titleId}-destination`}
            value={filter.add_to_project_id ?? 0}
            onChange={(e) => setFilter((current) => ({ ...current, add_to_project_id: Number(e.target.value) }))}
            className="w-full rounded-control border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)]"
          >
            <option value={0}>Inbox</option>
            {allProjects.map((project) => (
              <option key={project.id} value={project.id}>{project.title}</option>
            ))}
            {(filter.add_to_project_id ?? 0) > 0 && !allProjects.some((project) => project.id === filter.add_to_project_id) && (
              <option value={filter.add_to_project_id}>Unavailable project (uses Inbox)</option>
            )}
          </select>
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
                  'rounded-control border px-3 py-1 text-xs font-medium transition-colors',
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
            <div className="max-h-32 overflow-y-auto rounded-control border border-[var(--border-color)] bg-[var(--bg-secondary)] p-2">
              {labels.map((l) => (
                <label
                  key={l.id}
                  className="flex cursor-pointer items-center gap-2 rounded-control px-2 py-1 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
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

        {/* Collaboration */}
        {showCollaboration && (
          <fieldset className="space-y-2">
            <legend className="mb-1 text-xs text-[var(--text-secondary)]">Shared projects</legend>
            <div className="flex gap-3">
              <div className="flex-1">
                <label htmlFor={`${titleId}-assigned`} className="mb-1 block text-xs text-[var(--text-secondary)]">Assigned</label>
                <select
                  id={`${titleId}-assigned`}
                  value={assigned}
                  onChange={(e) => setFilter((f) => ({ ...f, assigned: e.target.value || undefined }))}
                  className="w-full rounded-control border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)]"
                >
                  {ASSIGNED_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                  {!isOffered(assigned, ASSIGNED_OPTIONS) && <option value={assigned}>Set by a newer version</option>}
                </select>
              </div>
              <div className="flex-1">
                <label htmlFor={`${titleId}-comments`} className="mb-1 block text-xs text-[var(--text-secondary)]">Comments</label>
                <select
                  id={`${titleId}-comments`}
                  value={comments}
                  onChange={(e) => setFilter((f) => ({ ...f, comments: e.target.value || undefined }))}
                  className="w-full rounded-control border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)]"
                >
                  {COMMENTS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                  {!isOffered(comments, COMMENTS_OPTIONS) && <option value={comments}>Set by a newer version</option>}
                </select>
              </div>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-[var(--text-primary)]">
              <input
                type="checkbox"
                checked={filter.shared_only === true}
                onChange={(e) => setFilter((f) => ({ ...f, shared_only: e.target.checked || undefined }))}
                className="accent-accent-blue"
              />
              Only tasks in shared projects
            </label>
            <p className="text-xs text-[var(--text-secondary)]">
              Assigned and Comments only match tasks in projects someone else can see.
            </p>
          </fieldset>
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
          className="rounded-control border border-[var(--border-color)] px-4 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)]"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={!name.trim()}
          className={cn(
            'rounded-control px-4 py-1.5 text-xs font-medium transition-colors',
            'bg-accent-fill text-on-accent hover:bg-accent-fill/90',
            'disabled:cursor-not-allowed disabled:opacity-50'
          )}
        >
          {list ? 'Save' : 'Create'}
        </button>
      </div>
    </Dialog>
  )
}
