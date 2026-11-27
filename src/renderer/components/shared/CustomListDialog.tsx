import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Info, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/cn'
import { t, type TranslationKey } from '../../../shared/i18n'
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

// The label is read when it is shown (a getter), so it follows the language.
function sortOption(value: string, key: TranslationKey): { value: string; readonly label: string } {
  return { value, get label() { return t(key) } }
}

export const SORT_OPTIONS = [
  sortOption('due_date', 'customLists.sort.dueDate'),
  sortOption('start_date', 'customLists.sort.startDate'),
  sortOption('end_date', 'customLists.sort.endDate'),
  sortOption('created', 'customLists.sort.created'),
  sortOption('updated', 'customLists.sort.updated'),
  sortOption('done_at', 'customLists.sort.doneAt'),
  sortOption('priority', 'customLists.sort.priority'),
  sortOption('percent_done', 'customLists.sort.percentDone'),
  sortOption('title', 'customLists.sort.title'),
  sortOption('done', 'customLists.sort.done'),
  sortOption('id', 'customLists.sort.id'),
  sortOption('position', 'customLists.sort.position'),
]

/** The two orders of `sortBy`, named for the field ("Soonest first", "A to Z"); the same on Android. */
export function orderOptions(sortBy: string): Array<{ value: 'asc' | 'desc'; label: string }> {
  const [asc, desc] = ((): [string, string] => {
    switch (sortBy) {
      case 'due_date': case 'start_date': case 'end_date': return [t('customLists.order.soonestFirst'), t('customLists.order.latestFirst')]
      case 'created': case 'updated': case 'done_at': case 'id': return [t('customLists.order.oldestFirst'), t('customLists.order.newestFirst')]
      case 'priority': return [t('customLists.order.lowestFirst'), t('customLists.order.highestFirst')]
      case 'percent_done': return [t('customLists.order.leastDoneFirst'), t('customLists.order.mostDoneFirst')]
      case 'title': return [t('customLists.order.aToZ'), t('customLists.order.zToA')]
      case 'done': return [t('customLists.order.openFirst'), t('customLists.order.doneFirst')]
      default: return [t('customLists.order.ascending'), t('customLists.order.descending')]
    }
  })()
  return [{ value: 'asc', label: asc }, { value: 'desc', label: desc }]
}

const SELECT_CLASS = 'w-full rounded-control border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)]'

const DUE_DATE_OPTIONS = [
  { value: 'all', labelKey: 'customLists.dialog.dueAll' },
  { value: 'overdue', labelKey: 'customLists.dialog.dueOverdue' },
  { value: 'today', labelKey: 'customLists.dialog.dueToday' },
  { value: 'this_week', labelKey: 'customLists.dialog.dueThisWeek' },
  { value: 'this_month', labelKey: 'customLists.dialog.dueThisMonth' },
  { value: 'has_due_date', labelKey: 'customLists.dialog.dueHasDate' },
  { value: 'no_due_date', labelKey: 'customLists.dialog.dueNoDate' },
] as const satisfies ReadonlyArray<{ value: string; labelKey: TranslationKey }>

// "Changed" counts local days with today included (cross-app semantics 3.3); 0 is no condition.
const CHANGED_OPTIONS = [0, 1, 3, 7, 30] as const

function changedLabel(days: number): string {
  if (days === 0) return t('customLists.dialog.changedAnyTime')
  if (days === 1) return t('customLists.dialog.changedToday')
  return t('customLists.dialog.changedLastDays', { count: days })
}

const ASSIGNED_OPTIONS: ReadonlyArray<{ value: (typeof ASSIGNED_VALUES)[number] | ''; labelKey: TranslationKey }> = [
  { value: '', labelKey: 'customLists.dialog.assignedAny' },
  { value: 'me', labelKey: 'customLists.dialog.assignedMe' },
  { value: 'others', labelKey: 'customLists.dialog.assignedOthers' },
  { value: 'nobody', labelKey: 'customLists.dialog.assignedNobody' },
]

const COMMENTS_OPTIONS: ReadonlyArray<{ value: (typeof COMMENTS_VALUES)[number] | ''; labelKey: TranslationKey }> = [
  { value: '', labelKey: 'customLists.dialog.commentsAny' },
  { value: 'unread', labelKey: 'customLists.dialog.commentsUnread' },
  { value: 'any', labelKey: 'customLists.dialog.commentsHas' },
]

/** A value this version does not offer (from a newer app) stays selectable, so saving keeps it. */
function isOffered(value: string, options: ReadonlyArray<{ value: string }>): boolean {
  return options.some((option) => option.value === value)
}

const PRIORITY_OPTIONS: ReadonlyArray<{ value: number; labelKey: TranslationKey }> = [
  { value: 0, labelKey: 'customLists.dialog.priorityNone' },
  { value: 1, labelKey: 'customLists.dialog.priorityLow' },
  { value: 2, labelKey: 'customLists.dialog.priorityMedium' },
  { value: 3, labelKey: 'customLists.dialog.priorityHigh' },
  { value: 4, labelKey: 'customLists.dialog.priorityUrgent' },
]

const DEFAULT_FILTER: CustomListFilter = {
  project_ids: [],
  add_to_project_id: 0,
  sort_by: 'due_date',
  order_by: 'asc',
  due_date_filter: 'all',
}

export function CustomListDialog({ open, list, onSave, onClose }: CustomListDialogProps) {
  const { t } = useTranslation()
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
    // What the editor does not show (where the list was imported from, its import base, fields
    // from a newer app) stays as it was (cross-app semantics 3 and 3.7).
    const { id: _id, name: _name, icon: _icon, filter: _filter, ...kept }: Partial<CustomList> = list ?? {}
    onSave({
      ...kept,
      id: list?.id ?? crypto.randomUUID(),
      name: trimmed,
      icon,
      filter: {
        ...rest,
        ...(savedRule.rule ? { rule: savedRule.rule } : {}),
        ...(savedRule.rule && includeNulls ? { rule_include_nulls: true } : {}),
      },
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
          {list ? t('customLists.dialog.editTitle') : t('customLists.dialog.newTitle')}
        </h2>
        <button
          type="button"
          aria-label={t('customLists.dialog.close')}
          onClick={onClose}
          className="rounded-control p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-4 p-5">
        {(typeof list?.saved_filter_id === 'number' || list?.project_view) && (
          <p className="flex gap-2 rounded-control bg-[var(--bg-secondary)] px-3 py-2 text-xs text-[var(--text-secondary)]">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-blue" aria-hidden />
            {list?.project_view
              ? t('customLists.dialog.importedFromView')
              : t('customLists.dialog.importedFromFilter')}
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
          <label htmlFor={`${titleId}-name`} className="mb-1 block text-xs text-[var(--text-secondary)]">{t('customLists.dialog.name')}</label>
          <input
            id={`${titleId}-name`}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('customLists.dialog.namePlaceholder')}
            data-autofocus
            className="w-full rounded-control border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave()
            }}
          />
        </div>

        <div>
          <span id={`${titleId}-icon`} className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">{t('customLists.dialog.icon')}</span>
          <ListIconPicker value={icon} onChange={setIcon} labelledBy={`${titleId}-icon`} allowNone />
        </div>

        {/* Sort + Order, then a further key (section 3.6) */}
        <div className="flex gap-3">
          <div className="flex-1">
            <label htmlFor={`${titleId}-sort`} className="mb-1 block text-xs text-[var(--text-secondary)]">{t('customLists.dialog.sortBy')}</label>
            <select id={`${titleId}-sort`} value={filter.sort_by} onChange={(e) => setSortBy(e.target.value)} className={SELECT_CLASS}>
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
              {!isOffered(filter.sort_by, SORT_OPTIONS) && <option value={filter.sort_by}>{t('customLists.dialog.newerVersion')}</option>}
            </select>
          </div>
          <div className="flex-1">
            <label htmlFor={`${titleId}-order`} className="mb-1 block text-xs text-[var(--text-secondary)]">{t('customLists.dialog.order')}</label>
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
            <label htmlFor={`${titleId}-then`} className="mb-1 block text-xs text-[var(--text-secondary)]">{t('customLists.dialog.thenBy')}</label>
            <select
              id={`${titleId}-then`}
              value={thenBy?.sort_by ?? ''}
              onChange={(e) => setThenBy(e.target.value, thenBy?.order_by ?? 'asc')}
              className={SELECT_CLASS}
            >
              <option value="">{t('customLists.dialog.thenNone')}</option>
              {thenByOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
              {thenBy && !isOffered(thenBy.sort_by, thenByOptions) && (
                <option value={thenBy.sort_by}>{t('customLists.dialog.newerVersion')}</option>
              )}
            </select>
          </div>
          <div className="flex-1">
            {thenBy && (
              <>
                <label htmlFor={`${titleId}-then-order`} className="mb-1 block text-xs text-[var(--text-secondary)]">{t('customLists.dialog.thenOrder')}</label>
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
          <label htmlFor={`${titleId}-due`} className="mb-1 block text-xs text-[var(--text-secondary)]">{t('customLists.dialog.dueDate')}</label>
          <select
            id={`${titleId}-due`}
            value={filter.due_date_filter}
            onChange={(e) => setFilter((f) => ({ ...f, due_date_filter: e.target.value as CustomListFilter['due_date_filter'] }))}
            className="w-full rounded-control border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)]"
          >
            {DUE_DATE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{t(o.labelKey)}</option>
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
              {t('customLists.dialog.includeOverdue')}
            </label>
          )}
        </div>

        {/* Changed */}
        <div>
          <label htmlFor={`${titleId}-changed`} className="mb-1 block text-xs text-[var(--text-secondary)]">{t('customLists.dialog.changed')}</label>
          <select
            id={`${titleId}-changed`}
            value={changedDays ?? 0}
            onChange={(e) => {
              const days = Number(e.target.value)
              setFilter((f) => ({ ...f, changed_within_days: days > 0 ? days : undefined }))
            }}
            className="w-full rounded-control border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)]"
          >
            {CHANGED_OPTIONS.map((days) => (
              <option key={days} value={days}>{changedLabel(days)}</option>
            ))}
            {changedDays !== null && !CHANGED_OPTIONS.some((days) => days === changedDays) && (
              <option value={changedDays}>{changedLabel(changedDays)}</option>
            )}
          </select>
        </div>

        {/* Projects */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="text-xs text-[var(--text-secondary)]">
              {filter.project_ids.length === 0
                ? ((filter.project_filter_mode ?? 'include') === 'include'
                  ? t('customLists.dialog.projectsAll')
                  : t('customLists.dialog.projectsNoneExcluded'))
                : (filter.project_filter_mode ?? 'include') === 'exclude'
                  ? t('customLists.dialog.projectsExcluded', { count: filter.project_ids.length })
                  : t('customLists.dialog.projects')}
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
                  {mode === 'include' ? t('customLists.dialog.modeInclude') : t('customLists.dialog.modeExclude')}
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
              <p className="px-2 py-1 text-xs text-[var(--text-secondary)]">{t('customLists.dialog.noProjects')}</p>
            )}
          </div>
        </div>

        {/* New-task destination */}
        <div>
          <label htmlFor={`${titleId}-destination`} className="mb-1 block text-xs text-[var(--text-secondary)]">{t('customLists.dialog.addTasksTo')}</label>
          <select
            id={`${titleId}-destination`}
            value={filter.add_to_project_id ?? 0}
            onChange={(e) => setFilter((current) => ({ ...current, add_to_project_id: Number(e.target.value) }))}
            className="w-full rounded-control border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)]"
          >
            <option value={0}>{t('customLists.dialog.inbox')}</option>
            {allProjects.map((project) => (
              <option key={project.id} value={project.id}>{project.title}</option>
            ))}
            {(filter.add_to_project_id ?? 0) > 0 && !allProjects.some((project) => project.id === filter.add_to_project_id) && (
              <option value={filter.add_to_project_id}>{t('customLists.dialog.unavailableProject')}</option>
            )}
          </select>
        </div>

        {/* Priority */}
        <div>
          <label className="mb-1 block text-xs text-[var(--text-secondary)]">
            {filter.priority_filter?.length ? t('customLists.dialog.priority') : t('customLists.dialog.priorityAny')}
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
                {t(p.labelKey)}
              </button>
            ))}
          </div>
        </div>

        {/* Labels */}
        {labels && labels.length > 0 && (
          <div>
            <label className="mb-1 block text-xs text-[var(--text-secondary)]">
              {filter.label_ids?.length ? t('customLists.dialog.labels') : t('customLists.dialog.labelsAny')}
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
            <legend className="mb-1 text-xs text-[var(--text-secondary)]">{t('customLists.dialog.sharedProjects')}</legend>
            <div className="flex gap-3">
              <div className="flex-1">
                <label htmlFor={`${titleId}-assigned`} className="mb-1 block text-xs text-[var(--text-secondary)]">{t('customLists.dialog.assigned')}</label>
                <select
                  id={`${titleId}-assigned`}
                  value={assigned}
                  onChange={(e) => setFilter((f) => ({ ...f, assigned: e.target.value || undefined }))}
                  className="w-full rounded-control border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)]"
                >
                  {ASSIGNED_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{t(o.labelKey)}</option>
                  ))}
                  {!isOffered(assigned, ASSIGNED_OPTIONS) && <option value={assigned}>{t('customLists.dialog.newerVersion')}</option>}
                </select>
              </div>
              <div className="flex-1">
                <label htmlFor={`${titleId}-comments`} className="mb-1 block text-xs text-[var(--text-secondary)]">{t('customLists.dialog.comments')}</label>
                <select
                  id={`${titleId}-comments`}
                  value={comments}
                  onChange={(e) => setFilter((f) => ({ ...f, comments: e.target.value || undefined }))}
                  className="w-full rounded-control border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)]"
                >
                  {COMMENTS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{t(o.labelKey)}</option>
                  ))}
                  {!isOffered(comments, COMMENTS_OPTIONS) && <option value={comments}>{t('customLists.dialog.newerVersion')}</option>}
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
              {t('customLists.dialog.sharedOnly')}
            </label>
            <p className="text-xs text-[var(--text-secondary)]">
              {t('customLists.dialog.sharedNote')}
            </p>
          </fieldset>
        )}

        {showsPro && <ProListSection filter={filter} onChange={setFilter} />}

        {/* Rule (section 3.5) */}
        <div>
          <label htmlFor={`${titleId}-rule`} className="mb-1 block text-xs text-[var(--text-secondary)]">{t('customLists.dialog.rule')}</label>
          <textarea
            id={`${titleId}-rule`}
            ref={ruleInput}
            rows={2}
            value={ruleText}
            spellCheck={false}
            // i18n-ignore: Vikunja filter syntax, the same in every language
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
            <div className="mt-1 flex flex-wrap gap-1" role="group" aria-label={t('customLists.dialog.suggestions')}>
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
            {ruleProblem ?? t('customLists.dialog.ruleHelp')}
          </p>
          {ruleText.trim() !== '' && (
            <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-[var(--text-primary)]">
              <input
                type="checkbox"
                checked={filter.rule_include_nulls === true}
                onChange={(e) => setFilter((f) => ({ ...f, rule_include_nulls: e.target.checked || undefined }))}
                className="accent-accent-blue"
              />
              {t('customLists.dialog.ruleIncludeNulls')}
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
          {t('customLists.dialog.includeDone')}
        </label>

        {/* Include today from all projects */}
        <label className="flex cursor-pointer items-center gap-2 text-xs text-[var(--text-primary)]">
          <input
            type="checkbox"
            checked={filter.include_today_all_projects ?? false}
            onChange={(e) => setFilter((f) => ({ ...f, include_today_all_projects: e.target.checked || undefined }))}
            className="accent-accent-blue"
          />
          {t('customLists.dialog.includeTodayAll')}
        </label>
      </div>

      {/* Footer */}
      <div className="flex justify-end gap-2 border-t border-[var(--border-color)] px-5 py-3">
        <button
          type="button"
          onClick={onClose}
          className="rounded-control border border-[var(--border-color)] px-4 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)]"
        >
          {t('customLists.dialog.cancel')}
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
          {list ? t('customLists.dialog.save') : t('customLists.dialog.create')}
        </button>
      </div>
    </Dialog>
  )
}
