/**
 * How a Vikunja saved filter or project view becomes a custom list, and how importing it again
 * compares and updates that list (docs/cross-app-semantics-v1.md, sections 3.7 and 3.9). Android
 * has the same in `SavedFilterImport.kt`; both run the `savedFilterImport` vectors.
 */

import { CUSTOM_LIST_SORT_KEYS } from './custom-list-sort'
import { SERVER_ONLY_FIELDS, parseRule, validateRule, withoutTerms, writeRule, writeRuleValue } from './custom-list-rule'

/** The query of a saved filter (`filters`) or of a project view (`filter`). */
export interface SavedFilterQuery {
  filter?: string
  filter_include_nulls?: boolean
  sort_by?: string[] | null
  order_by?: string[] | null
  s?: string
}

/** A saved filter as `GET filters/{id}` returns it. */
export interface SavedFilterDto {
  id: number
  title?: string
  description?: string
  updated?: string
  filters?: SavedFilterQuery
}

/** A project view as `GET projects/{id}/views` returns it (section 3.9). */
export interface ProjectViewDto {
  id: number
  project_id?: number
  title?: string
  view_kind?: string
  position?: number
  filter?: SavedFilterQuery | null
  updated?: string
}

/** The project a view belongs to, as section 3.9 reads it. */
export interface ViewProject { id: number; title: string; archived: boolean }

/** A further sort key (section 3.6). */
export interface ListSortKey { sort_by: string; order_by: string }

/** A project view a list was imported from (section 3.9). */
export interface ProjectViewRef { project_id: number; view_id: number }

/**
 * What an import took from Vikunja (section 3.7, "The import base"): the source's `updated` and the
 * four parts. `rule`, `rule_include_nulls` and `then_by` are written only when set.
 */
export interface ImportBase {
  updated: string
  name: string
  rule?: string
  rule_include_nulls?: true
  sort_by: string
  order_by: string
  then_by?: ListSortKey[]
}

/** The list fields an import sets; everything else is a new list's default. */
export interface ImportedListFilter {
  include_done: true
  rule?: string
  rule_include_nulls?: true
  sort_by: string
  order_by: string
  then_by?: ListSortKey[]
  /** A view's own project (section 3.9). */
  project_ids?: number[]
  project_filter_mode?: 'include'
  add_to_project_id?: number
}

export interface ImportedList {
  id: string
  name: string
  icon: string
  saved_filter_id?: number
  project_view?: ProjectViewRef
  import_base: ImportBase
  filter: ImportedListFilter
}

export type ImportStatus = 'exact' | 'changed' | 'unreadable'
export type ImportReason = 'kanban_column' | 'other_field' | 'manual_order' | 'sort_key'

export interface ImportResult { list: ImportedList | null; status: ImportStatus; reasons: ImportReason[] }

/** The four parts an import takes from Vikunja (section 3.7). */
export type ImportPart = 'name' | 'rule' | 'include_nulls' | 'sort'
export const IMPORT_PARTS: readonly ImportPart[] = ['name', 'rule', 'include_nulls', 'sort']

/** Who changed a part, or a whole source, since the import. */
export type ImportChange = 'same' | 'vicu' | 'vikunja' | 'both' | 'differs'

/** A list compared with a new import of its source. */
export interface ImportComparison { parts: Record<ImportPart, ImportChange>; status: ImportChange }

/** A saved filter as the project read lists it, with its pseudo-project's `updated`. */
export interface SavedFilterRef { id: number; title: string; updated?: string }

/** What Settings and the lists need: the filters, the offers and the closed first-open notices. */
export interface SavedFilterState {
  known: SavedFilterRef[]
  /** Never imported and not put off with Not now on this device. */
  offer: SavedFilterRef[]
  /** Imported filters a read after a sync found changed in Vikunja, not answered or put off. */
  changed_offer: SavedFilterRef[]
  imported: number[]
  notice_closed: string[]
}

/** A list as the comparison reads it: the app's list or its synced value. */
export interface ComparableList {
  id: string
  name: string
  filter: {
    rule?: unknown
    rule_include_nulls?: unknown
    sort_by?: unknown
    order_by?: unknown
    then_by?: unknown
  }
  import_base?: unknown
}

/** One row of the review sheet: a saved filter or a project view, and what importing it does. */
export interface SavedFilterPreview {
  /** `filter:<id>` or `view:<id>`. */
  key: string
  title: string
  rule: string
  result: ImportResult
  imported_before: boolean
  filter_id?: number
  /** The view's project, for a project view. */
  view?: ViewProject
  /** The list that holds this source already, and how it compares with a new import of it. */
  existing?: ComparableList
  comparison?: ImportComparison
}

/** Overwrite or Skip for one source that has a list (section 3.7). */
export type ImportAnswer = 'overwrite' | 'skip'

/** What an import or a set of answers did, for the toast. */
export interface SavedFilterImportOutcome {
  count: number
  list_id: string | null
  updated?: number
  skipped?: number
  /** Present when the change can be undone (answers were given). */
  undo_id?: string
}

/** The icon an imported list gets. */
export const IMPORTED_LIST_ICON = 'filter_list'

const REASON_ORDER: ImportReason[] = ['kanban_column', 'other_field', 'manual_order', 'sort_key']

/** The saved filter a pseudo-project stands for, or null for a real project or Favorites (-1). */
export function savedFilterIdOf(projectId: number): number | null {
  return projectId <= -2 ? -projectId - 1 : null
}

/** What `query` imports as, under `name`, with the source's `updated`. */
function convertQuery(query: SavedFilterQuery, name: string, updated: string, listId: string): ImportResult {
  const reasons = new Set<ImportReason>()
  let text = (query.filter ?? '').trim()
  if (text === '' && query.s && query.s.trim() !== '') {
    const value = writeRuleValue(query.s, false)
    text = `title like ${value} || description like ${value}`
  }

  let rule = text
  const parsed = parseRule(text)
  if (!parsed.ok) return { list: null, status: 'unreadable', reasons: [] }
  const stripped = withoutTerms(parsed.root, SERVER_ONLY_FIELDS)
  if (stripped) {
    if (stripped.removed.has('bucket_id')) reasons.add('kanban_column')
    if (stripped.removed.has('position') || stripped.removed.has('uid')) reasons.add('other_field')
    rule = writeRule(stripped.root)
  }
  if (validateRule(rule) !== null) return { list: null, status: 'unreadable', reasons: [] }

  const keys: ListSortKey[] = []
  ;(query.sort_by ?? []).forEach((key, index) => {
    const order = query.order_by?.[index] === 'desc' ? 'desc' : 'asc'
    if (key === 'position') reasons.add('manual_order')
    else if (!(CUSTOM_LIST_SORT_KEYS as readonly string[]).includes(key)) reasons.add('sort_key')
    else keys.push({ sort_by: key, order_by: order })
  })

  const first = keys[0] ?? { sort_by: 'due_date', order_by: 'asc' }
  const ruleText = rule.trim() !== '' ? rule : undefined
  const listFilter: ImportedListFilter = { include_done: true, sort_by: first.sort_by, order_by: first.order_by }
  const base: ImportBase = { updated, name, sort_by: first.sort_by, order_by: first.order_by }
  if (ruleText !== undefined) {
    listFilter.rule = ruleText
    base.rule = ruleText
  }
  if (query.filter_include_nulls) {
    listFilter.rule_include_nulls = true
    base.rule_include_nulls = true
  }
  if (keys.length > 1) {
    listFilter.then_by = keys.slice(1)
    base.then_by = keys.slice(1).map((key) => ({ ...key }))
  }

  const ordered = REASON_ORDER.filter((reason) => reasons.has(reason))
  return {
    list: { id: listId, name, icon: IMPORTED_LIST_ICON, import_base: base, filter: listFilter },
    status: ordered.length === 0 ? 'exact' : 'changed',
    reasons: ordered,
  }
}

/** `filter` as a custom list with the id `listId`. */
export function convertSavedFilter(filter: SavedFilterDto, listId: string): ImportResult {
  const name = (filter.title ?? '').trim() || `Saved filter ${filter.id}`
  const result = convertQuery(filter.filters ?? {}, name, filter.updated ?? '', listId)
  if (!result.list) return result
  const { id, name: listName, icon, import_base: base, filter: listFilter } = result.list
  return { ...result, list: { id, name: listName, icon, saved_filter_id: filter.id, import_base: base, filter: listFilter } }
}

/** Whether the review sheet offers `view` of `project` (section 3.9). */
export function isViewOffered(project: ViewProject, view: ProjectViewDto): boolean {
  if (project.id < 1 || project.archived) return false
  const query = view.filter ?? {}
  const plain = (query.s ?? '') === '' && (query.sort_by ?? []).length === 0 && query.filter_include_nulls !== true
  const text = query.filter ?? ''
  switch (view.view_kind) {
    case 'list': return !(plain && text.trim() === 'done = false')
    case 'table':
    case 'gantt': return !(plain && text === '')
    default: return false
  }
}

/** The name a view's list gets: the project's title, `: ` and the view's title (section 3.9). */
export function viewListName(project: ViewProject, view: ProjectViewDto): string {
  return `${project.title.trim()}: ${(view.title ?? '').trim()}`
}

/** `view` of `project` as a custom list with the id `listId` (section 3.9). */
export function convertProjectView(project: ViewProject, view: ProjectViewDto, listId: string): ImportResult {
  const result = convertQuery(view.filter ?? {}, viewListName(project, view), view.updated ?? '', listId)
  if (!result.list) return result
  const { id, name, icon, import_base: base, filter: listFilter } = result.list
  return {
    ...result,
    list: {
      id,
      name,
      icon,
      project_view: { project_id: project.id, view_id: view.id },
      import_base: base,
      filter: { ...listFilter, project_ids: [project.id], project_filter_mode: 'include', add_to_project_id: project.id },
    },
  }
}

// ---- Importing again (section 3.7) ----

const order = (value: unknown): string => (value === 'desc' ? 'desc' : 'asc')

function thenByOf(value: unknown): ListSortKey[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((entry): entry is { sort_by: string; order_by?: unknown } =>
      typeof entry === 'object' && entry !== null && typeof (entry as { sort_by?: unknown }).sort_by === 'string')
    .map((entry) => ({ sort_by: entry.sort_by, order_by: order(entry.order_by) }))
}

const sortValue = (sortBy: unknown, orderBy: unknown, thenBy: unknown): string =>
  JSON.stringify([typeof sortBy === 'string' && sortBy !== '' ? sortBy : 'due_date', order(orderBy), thenByOf(thenBy)])

const ruleValue = (rule: unknown): string | null => (typeof rule === 'string' && rule.trim() !== '' ? rule : null)

/** The base of `list`, or null for a list without one (or one this version cannot read). */
export function importBaseOf(list: { import_base?: unknown }): ImportBase | null {
  const raw = list.import_base
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  const base: ImportBase = {
    updated: typeof value.updated === 'string' ? value.updated : '',
    name: typeof value.name === 'string' ? value.name.trim() : '',
    sort_by: typeof value.sort_by === 'string' && value.sort_by !== '' ? value.sort_by : 'due_date',
    order_by: order(value.order_by),
  }
  const rule = ruleValue(value.rule)
  if (rule !== null) base.rule = rule
  if (value.rule_include_nulls === true) base.rule_include_nulls = true
  const thenBy = thenByOf(value.then_by)
  if (thenBy.length > 0) base.then_by = thenBy
  return base
}

/** A part's value on a list, as a string the comparison can test for equality. */
function partValue(list: ComparableList, part: ImportPart): string {
  switch (part) {
    case 'name': return JSON.stringify(list.name.trim())
    case 'rule': return JSON.stringify(ruleValue(list.filter.rule))
    case 'include_nulls': return JSON.stringify(list.filter.rule_include_nulls === true)
    case 'sort': return sortValue(list.filter.sort_by, list.filter.order_by, list.filter.then_by)
  }
}

function baseValue(base: ImportBase, part: ImportPart): string {
  switch (part) {
    case 'name': return JSON.stringify(base.name.trim())
    case 'rule': return JSON.stringify(ruleValue(base.rule))
    case 'include_nulls': return JSON.stringify(base.rule_include_nulls === true)
    case 'sort': return sortValue(base.sort_by, base.order_by, base.then_by)
  }
}

/** Compares `list` with `fresh`, a new import of its source (section 3.7, "Importing again"). */
export function compareImport(list: ComparableList, fresh: ComparableList): ImportComparison {
  const base = importBaseOf(list)
  const parts = {} as Record<ImportPart, ImportChange>
  for (const part of IMPORT_PARTS) {
    const mine = partValue(list, part)
    const theirs = partValue(fresh, part)
    if (mine === theirs) parts[part] = 'same'
    else if (base === null) parts[part] = 'differs'
    else if (theirs === baseValue(base, part)) parts[part] = 'vicu'
    else if (mine === baseValue(base, part)) parts[part] = 'vikunja'
    else parts[part] = 'both'
  }
  const states = IMPORT_PARTS.map((part) => parts[part])
  const has = (change: ImportChange) => states.includes(change)
  const status: ImportChange = states.every((state) => state === 'same')
    ? 'same'
    : has('differs')
      ? 'differs'
      : has('both') || (has('vikunja') && has('vicu'))
        ? 'both'
        : has('vikunja')
          ? 'vikunja'
          : 'vicu'
  return { parts, status }
}

/** The parts of `comparison` that are not `same`, in the contract's order. */
export function changedParts(comparison: ImportComparison): ImportPart[] {
  return IMPORT_PARTS.filter((part) => comparison.parts[part] !== 'same')
}

function withBase(fresh: ComparableList): { import_base?: ImportBase } {
  const base = importBaseOf(fresh)
  return base ? { import_base: base } : {}
}

/** Overwrite: the four parts and the base from `fresh`; everything else of `list` is kept. */
export function overwriteImport<T extends ComparableList>(list: T, fresh: ComparableList): T {
  const { rule: _rule, rule_include_nulls: _nulls, sort_by: _sortBy, order_by: _orderBy, then_by: _thenBy, ...filter } = list.filter
  const rule = ruleValue(fresh.filter.rule)
  const thenBy = thenByOf(fresh.filter.then_by)
  const { import_base: _base, ...rest } = list
  return {
    ...rest,
    name: fresh.name,
    filter: {
      ...filter,
      sort_by: typeof fresh.filter.sort_by === 'string' && fresh.filter.sort_by !== '' ? fresh.filter.sort_by : 'due_date',
      order_by: order(fresh.filter.order_by),
      ...(rule !== null ? { rule } : {}),
      ...(fresh.filter.rule_include_nulls === true ? { rule_include_nulls: true } : {}),
      ...(thenBy.length > 0 ? { then_by: thenBy } : {}),
    },
    ...withBase(fresh),
  } as T
}

/** Skip: `list` as it is, with the base of `fresh`, so the same change is not offered again. */
export function skipImport<T extends ComparableList>(list: T, fresh: ComparableList): T {
  const { import_base: _base, ...rest } = list
  return { ...rest, ...withBase(fresh) } as T
}

/** Whether the review sheet ticks a source with this status at first; `same` cannot be ticked. */
export function startsTicked(status: ImportChange): boolean {
  return status === 'vikunja' || status === 'both' || status === 'differs'
}

/** "Imported 2 lists, updated 1 list, skipped 1": what an import or a set of answers did. */
export function importOutcomeText(outcome: SavedFilterImportOutcome): string {
  const lists = (n: number) => (n === 1 ? '1 list' : `${n} lists`)
  const parts: string[] = []
  if (outcome.count > 0) parts.push(`imported ${lists(outcome.count)}`)
  if ((outcome.updated ?? 0) > 0) parts.push(`updated ${lists(outcome.updated ?? 0)}`)
  if ((outcome.skipped ?? 0) > 0) parts.push(`skipped ${outcome.skipped}`)
  const text = parts.join(', ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}
