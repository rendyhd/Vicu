/**
 * How a Vikunja saved filter becomes a custom list (docs/cross-app-semantics-v1.md, section 3.7).
 * Android has the same in `SavedFilterImport.kt`; both run the `savedFilterImport` vectors.
 */

import { CUSTOM_LIST_SORT_KEYS } from './custom-list-sort'
import { SERVER_ONLY_FIELDS, parseRule, validateRule, withoutTerms, writeRule, writeRuleValue } from './custom-list-rule'

/** A saved filter as `GET filters/{id}` returns it. */
export interface SavedFilterDto {
  id: number
  title?: string
  description?: string
  filters?: {
    filter?: string
    filter_include_nulls?: boolean
    sort_by?: string[] | null
    order_by?: string[] | null
    s?: string
  }
}

/** A further sort key (section 3.6). */
export interface ListSortKey { sort_by: string; order_by: string }

/** The list fields an import sets; everything else is a new list's default. */
export interface ImportedListFilter {
  include_done: true
  rule?: string
  rule_include_nulls?: true
  sort_by?: string
  order_by?: string
  then_by?: ListSortKey[]
}

export interface ImportedList {
  id: string
  name: string
  icon: string
  saved_filter_id: number
  filter: ImportedListFilter
}

export type ImportStatus = 'exact' | 'changed' | 'unreadable'
export type ImportReason = 'kanban_column' | 'other_field' | 'manual_order' | 'sort_key'

export interface ImportResult { list: ImportedList | null; status: ImportStatus; reasons: ImportReason[] }

/** A saved filter as the project read lists it. */
export interface SavedFilterRef { id: number; title: string }

/** What Settings and the lists need: the filters, the offer and the closed first-open notices. */
export interface SavedFilterState {
  known: SavedFilterRef[]
  /** Never imported and not put off with Not now on this device. */
  offer: SavedFilterRef[]
  imported: number[]
  notice_closed: string[]
}

/** One row of the import dialog. */
export interface SavedFilterPreview {
  filter: SavedFilterRef
  rule: string
  result: ImportResult
  imported_before: boolean
}

export interface SavedFilterImportOutcome { count: number; list_id: string | null }

/** The icon an imported list gets. */
export const IMPORTED_LIST_ICON = 'filter_list'

const REASON_ORDER: ImportReason[] = ['kanban_column', 'other_field', 'manual_order', 'sort_key']

/** The saved filter a pseudo-project stands for, or null for a real project or Favorites (-1). */
export function savedFilterIdOf(projectId: number): number | null {
  return projectId <= -2 ? -projectId - 1 : null
}

/** `filter` as a custom list with the id `listId`. */
export function convertSavedFilter(filter: SavedFilterDto, listId: string): ImportResult {
  const reasons = new Set<ImportReason>()
  const query = filter.filters ?? {}
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

  const listFilter: ImportedListFilter = { include_done: true }
  if (rule.trim() !== '') listFilter.rule = rule
  if (query.filter_include_nulls) listFilter.rule_include_nulls = true
  const first = keys[0] ?? { sort_by: 'due_date', order_by: 'asc' }
  listFilter.sort_by = first.sort_by
  listFilter.order_by = first.order_by
  if (keys.length > 1) listFilter.then_by = keys.slice(1)

  const ordered = REASON_ORDER.filter((reason) => reasons.has(reason))
  return {
    list: {
      id: listId,
      name: (filter.title ?? '').trim() || `Saved filter ${filter.id}`,
      icon: IMPORTED_LIST_ICON,
      saved_filter_id: filter.id,
      filter: listFilter,
    },
    status: ordered.length === 0 ? 'exact' : 'changed',
    reasons: ordered,
  }
}
