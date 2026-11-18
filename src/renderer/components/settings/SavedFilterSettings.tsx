import { useId, useMemo, useRef, useState } from 'react'
import { ListFilter, X } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/shared/Button'
import { Checkbox } from '@/components/shared/Checkbox'
import { Dialog } from '@/components/overlay/Dialog'
import { SORT_OPTIONS, orderOptions } from '@/components/shared/CustomListDialog'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { SAVED_FILTERS_QUERY_KEY, useSavedFilters } from '@/hooks/use-saved-filters'
import { useAppConfig } from '@/hooks/use-app-config'
import { useLabels } from '@/hooks/use-labels'
import { useProjects } from '@/hooks/use-projects'
import { ruleToDisplay } from '../../../shared/rule-editing'
import {
  changedParts,
  startsTicked,
  type ComparableList,
  type ImportAnswer,
  type ImportChange,
  type ImportPart,
  type ImportReason,
  type SavedFilterPreview,
} from '../../../shared/saved-filter-import'

const REASON_TEXT: Record<ImportReason, string> = {
  kanban_column: 'the kanban column',
  other_field: "a condition Vicu can't check",
  manual_order: 'the manual order',
  sort_key: 'a sort order',
}

const PART_LABEL: Record<ImportPart, string> = {
  name: 'Name',
  rule: 'Rule',
  include_nulls: 'Tasks without a value',
  sort: 'Sort',
}

/** What an import will do, in words for the sheet; the same on Android (`importStatusText`). */
export function importStatusText(preview: SavedFilterPreview, checked: boolean): string {
  const { result } = preview
  if (result.list === null) return "Can't import: Vicu can't read this yet"
  switch (preview.comparison?.status) {
    case 'same': return 'Same as your list'
    case 'vikunja': return 'Changed in Vikunja since you imported it'
    case 'both': return 'Changed in Vikunja and in Vicu'
    case 'vicu': return "Your list differs from Vikunja's"
    case 'differs': return 'Differs from Vikunja'
  }
  if (preview.imported_before && !checked) return 'Imported before'
  if (result.status === 'exact') return 'Imports exactly'
  const parts = result.reasons.map((reason) => REASON_TEXT[reason])
  const joined = parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
  return `Leaves out ${joined}`
}

/** Who changed a part, in words (Android: `changeText`). */
export function changeText(change: ImportChange): string {
  switch (change) {
    case 'vikunja': return 'Changed in Vikunja'
    case 'vicu': return 'Changed in Vicu'
    case 'both': return 'Changed in both'
    case 'differs': return 'Differs'
    case 'same': return 'Same'
  }
}

/** The words under the question's title (Android: `questionText`). */
export function questionText(preview: SavedFilterPreview): string {
  const source = preview.view ? `the project view "${preview.title}"` : `the saved filter "${preview.title}"`
  const Source = source.charAt(0).toUpperCase() + source.slice(1)
  switch (preview.comparison?.status) {
    case 'vikunja': return `${Source} changed in Vikunja since you imported it.`
    case 'both': return `${Source} changed in Vikunja, and the list changed in Vicu.`
    case 'vicu': return `Your list differs from ${source}. Overwrite puts Vikunja's version back.`
    default: return `Your list differs from ${source}. Vicu can't tell which side changed.`
  }
}

/** The offer's title and words for `added` new and `changed` changed saved filters (Android: `offerText`). */
export function offerText(added: number, changed: number): [string, string] {
  if (changed === 0) {
    return [
      added === 1 ? '1 new saved filter on your server' : `${added} new saved filters on your server`,
      added === 1 ? 'Import it as a custom list to use it in Vicu.' : 'Import them as custom lists to use them in Vicu.',
    ]
  }
  if (added === 0) {
    return [
      changed === 1 ? '1 saved filter changed in Vikunja' : `${changed} saved filters changed in Vikunja`,
      'See what changed and choose whether to update your lists.',
    ]
  }
  return [`${added} new and ${changed} changed saved filters on your server`, 'Review them to import or update your lists.']
}

/** A list's sort in words: "Priority, highest first, then Due date, soonest first". */
export function sortText(list: ComparableList): string {
  const one = (sortBy: string, order: string) => {
    const name = SORT_OPTIONS.find((option) => option.value === sortBy)?.label ?? sortBy
    const label = orderOptions(sortBy).find((option) => option.value === order)?.label.toLowerCase() ?? order
    return `${name}, ${label}`
  }
  const sortBy = typeof list.filter.sort_by === 'string' && list.filter.sort_by !== '' ? list.filter.sort_by : 'due_date'
  const order = list.filter.order_by === 'desc' ? 'desc' : 'asc'
  const thenBy = Array.isArray(list.filter.then_by) ? (list.filter.then_by as Array<{ sort_by: string; order_by?: string }>) : []
  return [one(sortBy, order), ...thenBy.map((key) => one(key.sort_by, key.order_by === 'desc' ? 'desc' : 'asc'))].join(', then ')
}

interface Named { labels: Array<{ id: number; name: string }>; projects: Array<{ id: number; name: string }> }

function showRule(rule: unknown, named: Named): string {
  if (typeof rule !== 'string' || rule.trim() === '') return ''
  return ruleToDisplay(rule, named.labels, named.projects) || rule
}

function partText(list: ComparableList, part: ImportPart, named: Named): string {
  switch (part) {
    case 'name': return list.name
    case 'rule': return showRule(list.filter.rule, named) || 'No rule'
    case 'include_nulls': return list.filter.rule_include_nulls === true ? 'Included' : 'Left out'
    case 'sort': return sortText(list)
  }
}

/** Whether a row can be ticked: readable, and not already the same as its list. */
const importable = (preview: SavedFilterPreview) => preview.result.list !== null && preview.comparison?.status !== 'same'

/** Whether a row starts ticked (cross-app semantics 3.7). */
function ticked(preview: SavedFilterPreview): boolean {
  if (preview.result.list === null) return false
  if (preview.comparison) return startsTicked(preview.comparison.status)
  return !preview.imported_before
}

interface Sheet {
  loading: boolean
  error: string | null
  rows: SavedFilterPreview[]
  viewsLoading: boolean
  viewsError: string | null
  views: SavedFilterPreview[]
  checked: Set<string>
}

/** The questions for ticked sources that have a list, the answers given, and the new sources. */
interface Asking {
  pending: SavedFilterPreview[]
  answers: Array<{ key: string; answer: ImportAnswer }>
  add: string[]
}

/**
 * Settings → Projects: the account's Vikunja saved filters and project views (cross-app semantics
 * 3.7 and 3.9). New filters and filters changed in Vikunja are offered; Import saved filters and
 * views is always there. A source imported before is updated in place after a question.
 */
export function SavedFilterSettings() {
  const titleId = useId()
  const queryClient = useQueryClient()
  const { data: state } = useSavedFilters()
  const { data: config } = useAppConfig()
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const [asking, setAsking] = useState<Asking | null>(null)
  const opened = useRef(0)
  const { data: labels } = useLabels()
  const { data: projectData } = useProjects()
  // The rule as the list editor shows it: label and project names instead of ids.
  const named = useMemo<Named>(() => ({
    labels: (labels ?? []).map((label) => ({ id: label.id, name: label.title })),
    projects: (projectData?.flat ?? []).map((project) => ({ id: project.id, name: project.title })),
  }), [labels, projectData])

  if (!state || config?.standalone_mode) return null
  const offer = state.offer
  const changedOffer = state.changed_offer ?? []

  const open = () => {
    const token = ++opened.current
    setSheet({ loading: true, error: null, rows: [], viewsLoading: true, viewsError: null, views: [], checked: new Set() })
    const update = (change: (current: Sheet) => Sheet) =>
      setSheet((current) => (current === null || opened.current !== token ? current : change(current)))
    void api.previewSavedFilters().then((previews) => update((current) => {
      if (!previews) return { ...current, loading: false, error: "Vicu couldn't read the saved filters. Check the connection and try again." }
      const checked = new Set(current.checked)
      for (const preview of previews) if (ticked(preview)) checked.add(preview.key)
      return { ...current, loading: false, rows: previews, checked }
    }))
    void api.previewProjectViews().then((previews) => update((current) => {
      if (!previews) return { ...current, viewsLoading: false, viewsError: "Vicu couldn't read the project views." }
      const checked = new Set(current.checked)
      for (const preview of previews) if (ticked(preview)) checked.add(preview.key)
      return { ...current, viewsLoading: false, views: previews, checked }
    }))
  }

  const close = () => {
    opened.current++
    setSheet(null)
  }

  const toggle = (key: string) => {
    setSheet((current) => {
      if (!current) return current
      const checked = new Set(current.checked)
      if (checked.has(key)) checked.delete(key)
      else checked.add(key)
      return { ...current, checked }
    })
  }

  const write = (add: string[], answers: Asking['answers']) => {
    if (add.length === 0 && answers.length === 0) return
    // The toast (Open, or Undo for answers) comes from the main process (saved-filters-imported).
    void api.applySavedFilterImport({ add, answers })
  }

  // Import: new sources at once, then a question for each ticked source that has a list.
  const importChecked = () => {
    if (!sheet) return
    const chosen = [...sheet.rows, ...sheet.views].filter((preview) => sheet.checked.has(preview.key) && importable(preview))
    close()
    const add = chosen.filter((preview) => !preview.existing).map((preview) => preview.key)
    const pending = chosen.filter((preview) => preview.existing)
    if (pending.length === 0) {
      write(add, [])
      return
    }
    setAsking({ pending, answers: [], add })
  }

  // Overwrite or Skip for the question on screen; with `forAll`, for every one after it too.
  const answer = (choice: ImportAnswer, forAll: boolean) => {
    if (!asking) return
    const now = forAll ? asking.pending : asking.pending.slice(0, 1)
    const answers = [...asking.answers, ...now.map((preview) => ({ key: preview.key, answer: choice }))]
    const pending = asking.pending.slice(now.length)
    if (pending.length > 0) {
      setAsking({ ...asking, pending, answers })
      return
    }
    setAsking(null)
    write(asking.add, answers)
  }

  // The question closed: what was answered is written, the rest stays as it is.
  const stopAsking = () => {
    if (!asking) return
    setAsking(null)
    write(asking.add, asking.answers)
  }

  const notNow = () => {
    void api.dismissSavedFilters(offer.map((filter) => filter.id), changedOffer.map((filter) => filter.id))
      .then((next) => queryClient.setQueryData(SAVED_FILTERS_QUERY_KEY, next))
  }

  const checkedCount = sheet ? [...sheet.rows, ...sheet.views].filter((preview) => sheet.checked.has(preview.key) && importable(preview)).length : 0
  const [offerTitle, offerBody] = offerText(offer.length, changedOffer.length)

  const renderRow = (preview: SavedFilterPreview) => {
    if (!sheet) return null
    const canTick = importable(preview)
    const checked = sheet.checked.has(preview.key) && canTick
    const status = preview.comparison?.status
    const rule = showRule(preview.rule, named) || preview.rule
    return (
      <label
        key={preview.key}
        className={cn(
          'flex items-start gap-3 rounded-control px-2 py-2',
          canTick ? 'cursor-pointer hover:bg-[var(--bg-hover)]' : 'cursor-not-allowed',
        )}
      >
        <Checkbox checked={checked} disabled={!canTick} onChange={() => toggle(preview.key)} className="mt-0.5" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm text-[var(--text-primary)]">{preview.title}</span>
          {rule !== '' && (
            <span className="block break-words font-mono text-caption text-[var(--text-secondary)]">{rule}</span>
          )}
          <span
            className={cn(
              'block text-caption',
              preview.result.list === null
                ? 'text-danger'
                : status === 'vikunja' || status === 'both' || status === 'differs'
                  ? 'font-medium text-[var(--text-primary)]'
                  : status !== undefined || (preview.imported_before && !checked)
                    ? 'text-[var(--text-secondary)]'
                    : preview.result.status === 'exact'
                      ? 'text-accent-blue'
                      : 'text-[var(--text-primary)]',
            )}
          >
            {importStatusText(preview, checked)}
          </span>
        </span>
      </label>
    )
  }

  return (
    <div className="rounded-card border border-[var(--border-color)] bg-[var(--bg-primary)] p-5">
      <h2 className="mb-1 text-sm font-semibold text-[var(--text-primary)]">Saved filters and views</h2>
      <p className="mb-3 text-xs text-[var(--text-secondary)]">
        {state.known.length === 0
          ? 'Import a saved filter or a project view from Vikunja as a custom list.'
          : `Your server has ${state.known.length === 1 ? 'a saved filter' : `${state.known.length} saved filters`}. Imported filters and project views become custom lists.`}
      </p>

      {(offer.length > 0 || changedOffer.length > 0) && (
        <div className="mb-3 flex items-start gap-3 rounded-control bg-[var(--bg-secondary)] px-3 py-2.5">
          <ListFilter className="mt-0.5 h-4 w-4 shrink-0 text-accent-blue" aria-hidden />
          <div className="flex-1">
            <p className="text-sm font-medium text-[var(--text-primary)]">{offerTitle}</p>
            <p className="text-xs text-[var(--text-secondary)]">{offerBody}</p>
          </div>
          <div className="flex shrink-0 gap-1">
            <Button variant="quiet" onClick={notNow}>Not now</Button>
            <Button variant="secondary" onClick={open}>Review</Button>
          </div>
        </div>
      )}

      <Button variant="secondary" onClick={open}>Import saved filters and views</Button>

      {sheet && (
        <Dialog open onClose={close} labelledBy={titleId} className="w-[520px] max-w-[calc(100%-2rem)]">
          <div className="flex items-center justify-between border-b border-[var(--border-color)] px-5 py-3">
            <h2 id={titleId} className="text-sm font-semibold text-[var(--text-primary)]">Import saved filters and views</h2>
            <button
              type="button"
              aria-label="Close"
              onClick={close}
              className="rounded-control p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="px-5 pt-3 text-xs text-[var(--text-secondary)]">
            Each becomes a custom list in Vicu. Changes you make to these lists won&apos;t change anything on your server.
          </p>
          <div className="max-h-[420px] overflow-y-auto px-3 py-2">
            {sheet.loading && <p className="px-2 py-6 text-center text-xs text-[var(--text-secondary)]">Reading the saved filters...</p>}
            {!sheet.loading && sheet.error !== null && <p className="px-2 py-3 text-xs text-danger">{sheet.error}</p>}
            {!sheet.loading && sheet.error === null && (
              <>
                {sheet.rows.length > 0 && (
                  <section aria-labelledby={`${titleId}-filters`}>
                    <h3 id={`${titleId}-filters`} className="px-2 pb-1 pt-2 text-xs font-semibold text-accent-blue">Saved filters</h3>
                    {sheet.rows.map(renderRow)}
                  </section>
                )}
                <section aria-labelledby={`${titleId}-views`}>
                  <h3 id={`${titleId}-views`} className="px-2 pb-1 pt-3 text-xs font-semibold text-accent-blue">Project views</h3>
                  {sheet.viewsLoading && <p className="px-2 py-2 text-xs text-[var(--text-secondary)]">Reading the project views...</p>}
                  {!sheet.viewsLoading && sheet.viewsError !== null && <p className="px-2 py-2 text-xs text-danger">{sheet.viewsError}</p>}
                  {!sheet.viewsLoading && sheet.viewsError === null && sheet.views.length === 0 && (
                    <p className="px-2 py-2 text-xs text-[var(--text-secondary)]">
                      No project has a view of its own yet. A view with its own filter or sort shows up here.
                    </p>
                  )}
                  {!sheet.viewsLoading && sheet.viewsError === null && sheet.views.map(renderRow)}
                </section>
              </>
            )}
          </div>
          <div className="flex justify-end gap-2 border-t border-[var(--border-color)] px-5 py-3">
            <Button variant="secondary" onClick={close}>Cancel</Button>
            <Button variant="primary" disabled={checkedCount === 0} onClick={importChecked}>
              {checkedCount === 0 ? 'Import' : `Import ${checkedCount}`}
            </Button>
          </div>
        </Dialog>
      )}

      {asking && asking.pending[0] && (
        <UpdateQuestion
          key={asking.pending[0].key}
          preview={asking.pending[0]}
          remaining={asking.pending.length - 1}
          named={named}
          onAnswer={answer}
          onClose={stopAsking}
        />
      )}
    </div>
  )
}

/**
 * Overwrite or Skip for one source imported before (cross-app semantics 3.7): each part that
 * differs, who changed it, the list's value and Vikunja's, side by side.
 */
function UpdateQuestion({
  preview,
  remaining,
  named,
  onAnswer,
  onClose,
}: {
  preview: SavedFilterPreview
  remaining: number
  named: Named
  onAnswer: (answer: ImportAnswer, forAll: boolean) => void
  onClose: () => void
}) {
  const titleId = useId()
  const textId = useId()
  const [forAll, setForAll] = useState(false)
  const list = preview.existing
  const fresh = preview.result.list
  const comparison = preview.comparison
  if (!list || !fresh || !comparison) return null
  const freshList = fresh as unknown as ComparableList
  const parts = changedParts(comparison)
  const tint = 'bg-accent-blue/10'

  return (
    <Dialog
      open
      onClose={onClose}
      role="alertdialog"
      labelledBy={titleId}
      describedBy={textId}
      className="w-[560px] max-w-[calc(100%-2rem)]"
    >
      <div className="p-5">
        <h2 id={titleId} className="mb-1 text-sm font-semibold text-[var(--text-primary)]">
          Update &ldquo;{list.name}&rdquo; from Vikunja?
        </h2>
        <p id={textId} className="mb-4 text-xs text-[var(--text-secondary)]">{questionText(preview)}</p>

        <table className="mb-3 w-full table-fixed border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-[var(--border-color)] text-[var(--text-secondary)]">
              <th scope="col" className="w-[30%] py-1.5 pr-2 font-medium"><span className="sr-only">Part</span></th>
              <th scope="col" className="py-1.5 pr-2 font-medium">Your list</th>
              <th scope="col" className="py-1.5 font-medium">Vikunja now</th>
            </tr>
          </thead>
          <tbody>
            {parts.map((part) => {
              const change = comparison.parts[part]
              const mineChanged = change !== 'vikunja'
              const theirsChanged = change !== 'vicu'
              const mono = part === 'rule'
              return (
                <tr key={part} className="border-b border-[var(--border-color)] align-top">
                  <th scope="row" className="py-2 pr-2 font-normal">
                    <span className="block font-medium text-[var(--text-primary)]">{PART_LABEL[part]}</span>
                    <span className="block text-caption text-[var(--text-secondary)]">{changeText(change)}</span>
                  </th>
                  <td className="py-1 pr-2">
                    <span className={cn('block break-words rounded-control px-2 py-1 text-[var(--text-primary)]', mono && 'font-mono', mineChanged && tint)}>
                      {partText(list, part, named)}
                    </span>
                  </td>
                  <td className="py-1">
                    <span className={cn('block break-words rounded-control px-2 py-1 text-[var(--text-primary)]', mono && 'font-mono', theirsChanged && tint)}>
                      {partText(freshList, part, named)}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        <p className="mb-3 rounded-control bg-[var(--bg-secondary)] px-3 py-2 text-xs text-[var(--text-secondary)]">
          Kept either way: the icon, its place and the list&apos;s other conditions.
        </p>

        {remaining > 0 && (
          <label className="mb-4 flex cursor-pointer items-center gap-2">
            <Checkbox checked={forAll} onChange={(event) => setForAll(event.target.checked)} />
            <span className="text-sm text-[var(--text-primary)]">
              {remaining === 1 ? 'Same for the next one' : `Same for the next ${remaining}`}
            </span>
          </label>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" data-autofocus onClick={() => onAnswer('skip', forAll)}>Skip</Button>
          <Button variant="primary" onClick={() => onAnswer('overwrite', forAll)}>Overwrite</Button>
        </div>
      </div>
    </Dialog>
  )
}
