import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Info, X } from 'lucide-react'
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
import { ListStarters, ProListSection, useShowsProSection } from '@/components/pro/ProListSection'
import { ruleFromDisplay, ruleToDisplay, suggestRule, type Named } from '../../../shared/rule-editing'

interface CustomListDialogProps {
  open: boolean
  list?: CustomList | null
  onSave: (list: CustomList) => void
  onClose: () => void
}

const SORT_OPTIONS = [
  { value: 'due_date', label: 'Due date' },
  { value: 'start_date', label: 'Start date' },
  { value: 'end_date', label: 'End date' },
  { value: 'created', label: 'Created' },
  { value: 'updated', label: 'Updated' },
  { value: 'done_at', label: 'Completed' },
  { value: 'priority', label: 'Priority' },
  { value: 'percent_done', label: 'Progress' },
  { value: 'title', label: 'Title' },
  { value: 'done', label: 'Done' },
  { value: 'id', label: 'Order created' },
  { value: 'position', label: 'Position' },
] as const

/** The two orders of `sortBy`, named for the field ("Soonest first", "A to Z"); the same on Android. */
export function orderOptions(sortBy: string): Array<{ value: 'asc' | 'desc'; label: string }> {
  const [asc, desc] = (() => {
    switch (sortBy) {
      case 'due_date': case 'start_date': case 'end_date': return ['Soonest first', 'Latest first']
      case 'created': case 'updated': case 'done_at': case 'id': return ['Oldest first', 'Newest first']
      case 'priority': return ['Lowest first', 'Highest first']
      case 'percent_done': return ['Least done first', 'Most done first']
      case 'title': return ['A to Z', 'Z to A']
      case 'done': return ['Open first', 'Done first']
      default: return ['Ascending', 'Descending']
    }
  })()
  return [{ value: 'asc', label: asc }, { value: 'desc', label: desc }]
}

const SELECT_CLASS = 'w-full rounded-control border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)]'

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
  // Pro (3.8): the section shows with the power layer, or for a list that has a Pro key on any device.
  const showsPro = useShowsProSection(filter)
  const [ruleText, setRuleText] = useState('')
  const [ruleCursor, setRuleCursor] = useState(0)
  const [ruleFocused, setRuleFocused] = useState(false)
  const ruleTouched = useRef(false)
  const ruleInput = useRef<HTMLTextAreaElement>(null)

  const namedLabels = useMemo<Named[]>(() => (labels ?? []).map((label) => ({ id: label.id, name: label.title })), [labels])
  const namedProjects = useMemo<Named[]>(
    () => (projectData?.flat ?? []).map((project) => ({ id: project.id, name: project.title })),
    [projectData],
  )

  useEffect(() => {
    ruleTouched.current = false
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

  // The rule is shown with names; labels and projects may arrive after the dialog opened.
  useEffect(() => {
    if (ruleTouched.current) return
    setRuleText(ruleToDisplay(list?.filter.rule, namedLabels, namedProjects))
  }, [list, open, namedLabels, namedProjects])

  if (!open) return null

  const savedRule = ruleFromDisplay(ruleText, namedLabels, namedProjects)
  const ruleProblem = 'problem' in savedRule ? savedRule.problem : null
  // Suggestions only while the rule is being written, as on Android.
  const suggestions = ruleFocused ? suggestRule(ruleText, ruleCursor, namedLabels, namedProjects) : []

  const handleSave = () => {
    const trimmed = name.trim()
    if (!trimmed || 'problem' in savedRule) return
    const { rule: _rule, rule_include_nulls: includeNulls, ...rest } = filter
    onSave({
      id: list?.id ?? crypto.randomUUID(),
      name: trimmed,
      icon,
      filter: {
        ...rest,
        ...(savedRule.rule ? { rule: savedRule.rule } : {}),
        ...(savedRule.rule && includeNulls ? { rule_include_nulls: true } : {}),
      },
      ...(typeof list?.saved_filter_id === 'number' ? { saved_filter_id: list.saved_filter_id } : {}),
    })
  }

  const editRule = (text: string, cursor: number) => {
    ruleTouched.current = true
    setRuleText(text)
    setRuleCursor(cursor)
  }

  const applySuggestion = (start: number, end: number, insert: string) => {
    const text = ruleText.slice(0, start) + insert + ruleText.slice(end)
    const cursor = start + insert.length
    editRule(text, cursor)
    requestAnimationFrame(() => {
      const input = ruleInput.current
      if (!input) return
      input.focus()
      input.setSelectionRange(cursor, cursor)
    })
  }

  const thenBy = filter.then_by?.[0]
  const setSortBy = (sortBy: string) =>
    setFilter((f) => ({
      ...f,
      sort_by: sortBy,
      // A further key equal to the first adds nothing.
      then_by: f.then_by?.[0]?.sort_by === sortBy ? undefined : f.then_by,
    }))
  const setThenBy = (sortBy: string, orderBy: string) =>
    setFilter((f) => ({
      ...f,
      // Further keys an import brought (section 3.6) stay after the one the editor shows.
      then_by: sortBy === '' ? undefined : [{ sort_by: sortBy, order_by: orderBy }, ...(f.then_by?.slice(1) ?? [])],
    }))
  const thenByOptions = SORT_OPTIONS.filter((option) => option.value !== filter.sort_by)

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
        {typeof list?.saved_filter_id === 'number' && (
          <p className="flex gap-2 rounded-control bg-[var(--bg-secondary)] px-3 py-2 text-xs text-[var(--text-secondary)]">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-blue" aria-hidden />
            Imported from a Vikunja saved filter. Changes here stay in Vicu and won't update the saved filter on your server.
          </p>
        )}

        {!list && (
          <ListStarters
            onPick={(starter) => {
              setName(starter.name)
              setIcon(starter.icon)
              setFilter({ ...DEFAULT_FILTER, ...starter.filter })
            }}
          />
        )}

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

        {/* Sort + Order, then a further key (section 3.6) */}
        <div className="flex gap-3">
          <div className="flex-1">
            <label htmlFor={`${titleId}-sort`} className="mb-1 block text-xs text-[var(--text-secondary)]">Sort by</label>
            <select id={`${titleId}-sort`} value={filter.sort_by} onChange={(e) => setSortBy(e.target.value)} className={SELECT_CLASS}>
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
              {!isOffered(filter.sort_by, SORT_OPTIONS) && <option value={filter.sort_by}>Set by a newer version</option>}
            </select>
          </div>
          <div className="flex-1">
            <label htmlFor={`${titleId}-order`} className="mb-1 block text-xs text-[var(--text-secondary)]">Order</label>
            <select
              id={`${titleId}-order`}
              value={filter.order_by}
              onChange={(e) => setFilter((f) => ({ ...f, order_by: e.target.value as 'asc' | 'desc' }))}
              className={SELECT_CLASS}
            >
              {orderOptions(filter.sort_by).map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex gap-3">
          <div className="flex-1">
            <label htmlFor={`${titleId}-then`} className="mb-1 block text-xs text-[var(--text-secondary)]">Then by</label>
            <select
              id={`${titleId}-then`}
              value={thenBy?.sort_by ?? ''}
              onChange={(e) => setThenBy(e.target.value, thenBy?.order_by ?? 'asc')}
              className={SELECT_CLASS}
            >
              <option value="">None</option>
              {thenByOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
              {thenBy && !isOffered(thenBy.sort_by, thenByOptions) && (
                <option value={thenBy.sort_by}>Set by a newer version</option>
              )}
            </select>
          </div>
          <div className="flex-1">
            {thenBy && (
              <>
                <label htmlFor={`${titleId}-then-order`} className="mb-1 block text-xs text-[var(--text-secondary)]">Then order</label>
                <select
                  id={`${titleId}-then-order`}
                  value={thenBy.order_by}
                  onChange={(e) => setThenBy(thenBy.sort_by, e.target.value)}
                  className={SELECT_CLASS}
                >
                  {orderOptions(thenBy.sort_by).map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </>
            )}
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
              Assigned and unread comments only match tasks in projects someone else can see.
            </p>
          </fieldset>
        )}

        {showsPro && <ProListSection filter={filter} onChange={setFilter} />}

        {/* Rule (section 3.5) */}
        <div>
          <label htmlFor={`${titleId}-rule`} className="mb-1 block text-xs text-[var(--text-secondary)]">Rule</label>
          <textarea
            id={`${titleId}-rule`}
            ref={ruleInput}
            rows={2}
            value={ruleText}
            spellCheck={false}
            placeholder="done = false && priority > 2"
            aria-describedby={`${titleId}-rule-help`}
            aria-invalid={ruleProblem !== null}
            onChange={(e) => editRule(e.target.value, e.target.selectionStart)}
            onSelect={(e) => setRuleCursor(e.currentTarget.selectionStart)}
            onFocus={(e) => {
              setRuleFocused(true)
              setRuleCursor(e.currentTarget.selectionStart)
            }}
            onBlur={() => setRuleFocused(false)}
            className={cn(
              'w-full resize-y rounded-control border bg-[var(--bg-secondary)] px-3 py-2 font-mono text-xs text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]',
              ruleProblem ? 'border-danger' : 'border-[var(--border-color)]',
            )}
          />
          {suggestions.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1" role="group" aria-label="Suggestions">
              {suggestions.map((suggestion) => (
                <button
                  key={`${suggestion.label}-${suggestion.start}`}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => applySuggestion(suggestion.start, suggestion.end, suggestion.insert)}
                  className="rounded-control border border-[var(--border-color)] px-2 py-0.5 font-mono text-caption text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                >
                  {suggestion.label}
                </button>
              ))}
            </div>
          )}
          <p id={`${titleId}-rule-help`} className={cn('mt-1 text-xs', ruleProblem ? 'text-danger' : 'text-[var(--text-secondary)]')}>
            {ruleProblem ?? "Tasks must also match this. It is written as in Vikunja's saved filters."}
          </p>
          {ruleText.trim() !== '' && (
            <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-[var(--text-primary)]">
              <input
                type="checkbox"
                checked={filter.rule_include_nulls === true}
                onChange={(e) => setFilter((f) => ({ ...f, rule_include_nulls: e.target.checked || undefined }))}
                className="accent-accent-blue"
              />
              Include tasks without a value
            </label>
          )}
        </div>

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
          disabled={!name.trim() || ruleProblem !== null}
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
