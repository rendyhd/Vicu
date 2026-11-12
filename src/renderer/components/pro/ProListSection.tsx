import { useId, useMemo } from 'react'
import { usePro } from '@/hooks/use-pro'
import { usePersonLabels } from '@/hooks/use-people'
import { useTasks } from '@/hooks/use-tasks'
import { useProjects } from '@/hooks/use-projects'
import { OPEN_TASKS_PARAMS } from '@/hooks/use-availability'
import { useCustomListContext } from '@/hooks/use-custom-list-context'
import { matchesCustomList } from '@/lib/custom-list-filter'
import { toLocalDate } from '@/lib/due-dates'
import type { CustomListFilter } from '@/lib/vikunja-types'
import { GROUP_BY_VALUES, ROW_FIELDS, hasProCondition, readGroupBy, readRowFields, type RowField } from '../../../shared/pro/list-conditions'

const SELECT = 'w-full rounded-control border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)]'
const LABEL = 'mb-1 block text-xs text-[var(--text-secondary)]'

const GROUP_LABELS: Record<(typeof GROUP_BY_VALUES)[number], string> = {
  none: 'No groups',
  project: 'Project',
  label: 'Label',
  person: 'Person',
  due: 'Due date',
  start: 'Start date',
  flagged: 'Flagged',
}

const FIELD_LABELS: Record<RowField, string> = {
  project: 'Project',
  labels: 'Labels',
  due: 'Due date',
  start: 'Start date',
  estimate: 'Estimate',
  flag: 'Flag',
  notes: 'Notes',
}

/** What a list shows without `row_fields`: the usual fields. */
const USUAL_FIELDS: RowField[] = ['project', 'labels', 'due', 'flag', 'notes']

export interface ListStarter {
  key: string
  name: string
  icon: string
  filter: Partial<CustomListFilter>
}

/** The starter lists (plan 7.7.1): a Pro list made from one button, then edited like any other. */
export const LIST_STARTERS: ListStarter[] = [
  { key: 'next', name: 'Next actions', icon: 'lightbulb', filter: { availability: 'available', group_by: 'project' } },
  { key: 'waiting', name: 'Waiting on', icon: 'bookmark', filter: { promise: 'theirs', group_by: 'person', sort_by: 'due_date' } },
  { key: 'quick', name: 'Quick wins', icon: 'auto_awesome', filter: { availability: 'available', estimate_max: 15, row_fields: ['project', 'due', 'estimate'] } },
  { key: 'flagged', name: 'Flagged by project', icon: 'flag', filter: { flagged: true, group_by: 'project' } },
]

/** Whether the editor shows the Pro section: Pro's power layer, or a list that already has a Pro key (3.8). */
export function useShowsProSection(filter: CustomListFilter): boolean {
  const power = usePro().layer('power')
  return power || hasProCondition(filter) || readGroupBy(filter.group_by) !== 'none' || readRowFields(filter.row_fields) !== null
}

/**
 * The Pro section of the list editor (cross-app semantics 3.8, plan 7.7.1): Show, Flagged, Estimate,
 * Project status, Promise, Person, Group by and Rows show, with a preview of the open tasks that
 * match the list as it is now.
 */
export function ProListSection({ filter, onChange }: { filter: CustomListFilter; onChange: (update: (filter: CustomListFilter) => CustomListFilter) => void }) {
  const id = useId()
  const people = usePersonLabels()
  const set = (patch: Partial<CustomListFilter>) => onChange((f) => {
    const next: CustomListFilter = { ...f, ...patch }
    // Written only when set (3.8).
    for (const [key, value] of Object.entries(patch)) if (value === undefined) delete (next as Record<string, unknown>)[key]
    return next
  })
  const fields = readRowFields(filter.row_fields)
  const shownFields = fields ?? USUAL_FIELDS
  const toggleField = (field: RowField, on: boolean) => {
    const next = ROW_FIELDS.filter((value) => (value === field ? on : shownFields.includes(value)))
    set({ row_fields: next })
  }
  const flagged = typeof filter.flagged === 'boolean' ? String(filter.flagged) : ''
  const selectedPeople = Array.isArray(filter.person) ? filter.person : []

  return (
    <fieldset className="space-y-3" data-pro-list-section>
      <legend className="mb-1 text-xs text-[var(--text-secondary)]">Pro</legend>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={`${id}-show`} className={LABEL}>Show</label>
          <select id={`${id}-show`} className={SELECT} value={filter.availability ?? ''} onChange={(e) => set({ availability: e.target.value || undefined })}>
            <option value="">Every task</option>
            <option value="available">Available now</option>
            <option value="remaining">Remaining (open)</option>
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-flagged`} className={LABEL}>Flagged</label>
          <select id={`${id}-flagged`} className={SELECT} value={flagged} onChange={(e) => set({ flagged: e.target.value === '' ? undefined : e.target.value === 'true' })}>
            <option value="">Any</option>
            <option value="true">Flagged</option>
            <option value="false">Not flagged</option>
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-estimate`} className={LABEL}>Estimate at most (minutes)</label>
          <input
            id={`${id}-estimate`}
            type="number"
            min={1}
            step={5}
            className={SELECT}
            value={filter.estimate_max ?? ''}
            onChange={(e) => {
              const minutes = Number(e.target.value)
              set({ estimate_max: e.target.value && Number.isInteger(minutes) && minutes >= 1 ? minutes : undefined })
            }}
          />
        </div>
        <div>
          <label htmlFor={`${id}-status`} className={LABEL}>Project status</label>
          <select id={`${id}-status`} className={SELECT} value={filter.project_status ?? ''} onChange={(e) => set({ project_status: e.target.value || undefined })}>
            <option value="">Any</option>
            <option value="active">Active</option>
            <option value="on_hold">On hold</option>
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-promise`} className={LABEL}>Promise</label>
          <select id={`${id}-promise`} className={SELECT} value={filter.promise ?? ''} onChange={(e) => set({ promise: e.target.value || undefined })}>
            <option value="">Any task</option>
            <option value="theirs">Promised to me</option>
            <option value="mine">I promised</option>
            <option value="any">Either</option>
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-group`} className={LABEL}>Group by</label>
          <select id={`${id}-group`} className={SELECT} value={readGroupBy(filter.group_by)} onChange={(e) => set({ group_by: e.target.value === 'none' ? undefined : e.target.value })}>
            {GROUP_BY_VALUES.map((value) => <option key={value} value={value}>{GROUP_LABELS[value]}</option>)}
          </select>
        </div>
      </div>
      {people.size > 0 && (
        <div>
          <span className={LABEL}>People</span>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {[...people.values()].map((label) => (
              <label key={label.id} className="flex cursor-pointer items-center gap-1.5 text-xs text-[var(--text-primary)]">
                <input
                  type="checkbox"
                  className="accent-accent-blue"
                  checked={selectedPeople.includes(label.id)}
                  onChange={(e) => {
                    const next = e.target.checked ? [...selectedPeople, label.id] : selectedPeople.filter((value) => value !== label.id)
                    set({ person: next.length ? next : undefined })
                  }}
                />
                {label.title}
              </label>
            ))}
          </div>
        </div>
      )}
      <div>
        <span className={LABEL}>Rows show</span>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {ROW_FIELDS.map((field) => (
            <label key={field} className="flex cursor-pointer items-center gap-1.5 text-xs text-[var(--text-primary)]">
              <input type="checkbox" className="accent-accent-blue" checked={shownFields.includes(field)} onChange={(e) => toggleField(field, e.target.checked)} />
              {FIELD_LABELS[field]}
            </label>
          ))}
          {fields && (
            <button type="button" className="text-xs text-accent-blue hover:underline" onClick={() => set({ row_fields: undefined })}>
              Usual fields
            </button>
          )}
        </div>
      </div>
      <ListPreview filter={filter} />
    </fieldset>
  )
}

/** The open tasks that match the list as it is edited: a count and the first few titles. */
function ListPreview({ filter }: { filter: CustomListFilter }) {
  const { data: tasks = [] } = useTasks(OPEN_TASKS_PARAMS)
  const { data: projects } = useProjects()
  const context = useCustomListContext()
  const matching = useMemo(() => {
    const active = new Set((projects?.flat ?? []).map((project) => project.id))
    const today = toLocalDate(new Date())
    return tasks.filter((task) => active.has(task.project_id) && matchesCustomList(task, filter, today, context))
  }, [tasks, projects?.flat, filter, context])
  return (
    <div className="rounded-control bg-[var(--bg-hover)] px-3 py-2 text-xs text-[var(--text-secondary)]" aria-live="polite" data-pro-list-preview>
      <p className="font-medium text-[var(--text-primary)]">
        {matching.length === 1 ? '1 open task matches' : `${matching.length} open tasks match`}
      </p>
      {matching.slice(0, 4).map((task) => <p key={task.id} className="truncate">{task.title}</p>)}
    </div>
  )
}

/** The starter buttons, offered on a new list while Pro's power layer is on. */
export function ListStarters({ onPick }: { onPick: (starter: ListStarter) => void }) {
  const power = usePro().layer('power')
  if (!power) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-pro-list-starters>
      <span className="text-xs text-[var(--text-secondary)]">Start from</span>
      {LIST_STARTERS.map((starter) => (
        <button
          key={starter.key}
          type="button"
          onClick={() => onPick(starter)}
          className="rounded-chip border border-[var(--border-color)] px-2 py-0.5 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
        >
          {starter.name}
        </button>
      ))}
    </div>
  )
}
