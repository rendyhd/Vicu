import { useId, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { t as translate, type TranslationKey } from '../../../shared/i18n'
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

const GROUP_LABELS: Record<(typeof GROUP_BY_VALUES)[number], TranslationKey> = {
  none: 'pro.listSection.noGroups',
  project: 'pro.listSection.project',
  label: 'pro.listSection.label',
  person: 'pro.listSection.person',
  due: 'pro.listSection.due',
  start: 'pro.listSection.start',
  flagged: 'pro.listSection.flagged',
}

const FIELD_LABELS: Record<RowField, TranslationKey> = {
  project: 'pro.listSection.project',
  labels: 'pro.listSection.labels',
  due: 'pro.listSection.due',
  start: 'pro.listSection.start',
  estimate: 'pro.listSection.estimate',
  flag: 'pro.listSection.flag',
  notes: 'pro.listSection.notes',
}

/** What a list shows without `row_fields`: the usual fields. */
const USUAL_FIELDS: RowField[] = ['project', 'labels', 'due', 'flag', 'notes']

export interface ListStarter {
  key: string
  name: string
  icon: string
  filter: Partial<CustomListFilter>
}

/**
 * The starter lists (plan 7.7.1): a Pro list made from one button, then edited like any other.
 * `name` is read when it is shown or used, so it follows the language.
 */
export const LIST_STARTERS: ListStarter[] = [
  { key: 'next', get name() { return translate('pro.listSection.starters.next') }, icon: 'lightbulb', filter: { availability: 'available', group_by: 'project' } },
  { key: 'waiting', get name() { return translate('pro.listSection.starters.waiting') }, icon: 'bookmark', filter: { promise: 'theirs', group_by: 'person', sort_by: 'due_date' } },
  { key: 'quick', get name() { return translate('pro.listSection.starters.quick') }, icon: 'auto_awesome', filter: { availability: 'available', estimate_max: 15, row_fields: ['project', 'due', 'estimate'] } },
  { key: 'flagged', get name() { return translate('pro.listSection.starters.flagged') }, icon: 'flag', filter: { flagged: true, group_by: 'project' } },
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
  const { t } = useTranslation()
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
      <legend className="mb-1 text-xs text-[var(--text-secondary)]">{t('pro.listSection.pro')}</legend>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={`${id}-show`} className={LABEL}>{t('pro.listSection.show')}</label>
          <select id={`${id}-show`} className={SELECT} value={filter.availability ?? ''} onChange={(e) => set({ availability: e.target.value || undefined })}>
            <option value="">{t('pro.listSection.everyTask')}</option>
            <option value="available">{t('pro.listSection.availableNow')}</option>
            <option value="remaining">{t('pro.listSection.remaining')}</option>
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-flagged`} className={LABEL}>{t('pro.listSection.flagged')}</label>
          <select id={`${id}-flagged`} className={SELECT} value={flagged} onChange={(e) => set({ flagged: e.target.value === '' ? undefined : e.target.value === 'true' })}>
            <option value="">{t('pro.listSection.any')}</option>
            <option value="true">{t('pro.listSection.flagged')}</option>
            <option value="false">{t('pro.listSection.notFlagged')}</option>
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-estimate`} className={LABEL}>{t('pro.listSection.estimateMax')}</label>
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
          <label htmlFor={`${id}-status`} className={LABEL}>{t('pro.listSection.projectStatus')}</label>
          <select id={`${id}-status`} className={SELECT} value={filter.project_status ?? ''} onChange={(e) => set({ project_status: e.target.value || undefined })}>
            <option value="">{t('pro.listSection.any')}</option>
            <option value="active">{t('pro.listSection.active')}</option>
            <option value="on_hold">{t('pro.listSection.onHold')}</option>
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-promise`} className={LABEL}>{t('pro.listSection.promise')}</label>
          <select id={`${id}-promise`} className={SELECT} value={filter.promise ?? ''} onChange={(e) => set({ promise: e.target.value || undefined })}>
            <option value="">{t('pro.listSection.anyTask')}</option>
            <option value="theirs">{t('pro.listSection.promisedToMe')}</option>
            <option value="mine">{t('pro.listSection.iPromised')}</option>
            <option value="any">{t('pro.listSection.either')}</option>
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-group`} className={LABEL}>{t('pro.listSection.groupBy')}</label>
          <select id={`${id}-group`} className={SELECT} value={readGroupBy(filter.group_by)} onChange={(e) => set({ group_by: e.target.value === 'none' ? undefined : e.target.value })}>
            {GROUP_BY_VALUES.map((value) => <option key={value} value={value}>{t(GROUP_LABELS[value])}</option>)}
          </select>
        </div>
      </div>
      {people.size > 0 && (
        <div>
          <span className={LABEL}>{t('pro.listSection.people')}</span>
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
        <span className={LABEL}>{t('pro.listSection.rowsShow')}</span>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {ROW_FIELDS.map((field) => (
            <label key={field} className="flex cursor-pointer items-center gap-1.5 text-xs text-[var(--text-primary)]">
              <input type="checkbox" className="accent-accent-blue" checked={shownFields.includes(field)} onChange={(e) => toggleField(field, e.target.checked)} />
              {t(FIELD_LABELS[field])}
            </label>
          ))}
          {fields && (
            <button type="button" className="text-xs text-accent-blue hover:underline" onClick={() => set({ row_fields: undefined })}>
              {t('pro.listSection.usualFields')}
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
  const { t } = useTranslation()
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
        {t('pro.listSection.matches', { count: matching.length })}
      </p>
      {matching.slice(0, 4).map((task) => <p key={task.id} className="truncate">{task.title}</p>)}
    </div>
  )
}

/** The starter buttons, offered on a new list while Pro's power layer is on. */
export function ListStarters({ onPick }: { onPick: (starter: ListStarter) => void }) {
  const { t } = useTranslation()
  const power = usePro().layer('power')
  if (!power) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-pro-list-starters>
      <span className="text-xs text-[var(--text-secondary)]">{t('pro.listSection.startFrom')}</span>
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
