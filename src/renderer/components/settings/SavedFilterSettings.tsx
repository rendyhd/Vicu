import { useId, useMemo, useState } from 'react'
import { ListFilter, X } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/shared/Button'
import { Checkbox } from '@/components/shared/Checkbox'
import { Dialog } from '@/components/overlay/Dialog'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { SAVED_FILTERS_QUERY_KEY, useSavedFilters } from '@/hooks/use-saved-filters'
import { useLabels } from '@/hooks/use-labels'
import { useProjects } from '@/hooks/use-projects'
import { ruleToDisplay } from '../../../shared/rule-editing'
import type { ImportReason, SavedFilterPreview } from '../../../shared/saved-filter-import'

const REASON_TEXT: Record<ImportReason, string> = {
  kanban_column: 'the kanban column',
  other_field: "a condition Vicu can't check",
  manual_order: 'the manual order',
  sort_key: 'a sort order',
}

/** What an import will do, in words for the dialog; the same on Android (`importStatusText`). */
export function importStatusText(preview: SavedFilterPreview, checked: boolean): string {
  const { result } = preview
  if (result.list === null) return "Can't import: Vicu can't read this filter yet"
  if (preview.imported_before && !checked) return 'Imported before'
  if (result.status === 'exact') return 'Imports exactly'
  const parts = result.reasons.map((reason) => REASON_TEXT[reason])
  const joined = parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
  return `Leaves out ${joined}`
}

type DialogState =
  | { loading: true }
  | { loading: false; error: string }
  | { loading: false; previews: SavedFilterPreview[]; checked: Set<number> }

/**
 * Settings → Projects: the account's Vikunja saved filters (cross-app semantics 3.7). New filters
 * are offered once; Import saved filters is always there while the server has any.
 */
export function SavedFilterSettings() {
  const titleId = useId()
  const queryClient = useQueryClient()
  const { data: state } = useSavedFilters()
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const { data: labels } = useLabels()
  const { data: projectData } = useProjects()
  // The rule as the list editor shows it: label and project names instead of ids.
  const named = useMemo(() => ({
    labels: (labels ?? []).map((label) => ({ id: label.id, name: label.title })),
    projects: (projectData?.flat ?? []).map((project) => ({ id: project.id, name: project.title })),
  }), [labels, projectData])

  if (!state || state.known.length === 0) return null
  const offer = state.offer

  const open = () => {
    setDialog({ loading: true })
    void api.previewSavedFilters().then((previews) => {
      setDialog((current) => {
        if (current === null) return null
        if (!previews) return { loading: false, error: "Vicu couldn't read the saved filters. Check the connection and try again." }
        const checked = new Set(previews.filter((p) => !p.imported_before && p.result.list !== null).map((p) => p.filter.id))
        return { loading: false, previews, checked }
      })
    })
  }

  const toggle = (id: number) => {
    setDialog((current) => {
      if (!current || current.loading || !('previews' in current)) return current
      const checked = new Set(current.checked)
      if (checked.has(id)) checked.delete(id)
      else checked.add(id)
      return { ...current, checked }
    })
  }

  const importChecked = () => {
    if (!dialog || dialog.loading || !('previews' in dialog)) return
    const ids = [...dialog.checked]
    setDialog(null)
    // The toast with Open comes from the main process (saved-filters-imported), as after a first connect.
    void api.importSavedFilters(ids)
  }

  const notNow = () => {
    void api.dismissSavedFilters(offer.map((filter) => filter.id)).then((next) => queryClient.setQueryData(SAVED_FILTERS_QUERY_KEY, next))
  }

  const checkedCount = dialog && !dialog.loading && 'previews' in dialog ? dialog.checked.size : 0

  return (
    <div className="rounded-card border border-[var(--border-color)] bg-[var(--bg-primary)] p-5">
      <h2 className="mb-1 text-sm font-semibold text-[var(--text-primary)]">Saved filters</h2>
      <p className="mb-3 text-xs text-[var(--text-secondary)]">
        Your server has {state.known.length === 1 ? 'a saved filter' : `${state.known.length} saved filters`}. Imported filters become custom lists.
      </p>

      {offer.length > 0 && (
        <div className="mb-3 flex items-start gap-3 rounded-control bg-[var(--bg-secondary)] px-3 py-2.5">
          <ListFilter className="mt-0.5 h-4 w-4 shrink-0 text-accent-blue" aria-hidden />
          <div className="flex-1">
            <p className="text-sm font-medium text-[var(--text-primary)]">
              {offer.length === 1 ? '1 new saved filter on your server' : `${offer.length} new saved filters on your server`}
            </p>
            <p className="text-xs text-[var(--text-secondary)]">
              {offer.length === 1 ? 'Import it as a custom list to use it in Vicu.' : 'Import them as custom lists to use them in Vicu.'}
            </p>
          </div>
          <div className="flex shrink-0 gap-1">
            <Button variant="quiet" onClick={notNow}>Not now</Button>
            <Button variant="secondary" onClick={open}>Review</Button>
          </div>
        </div>
      )}

      <Button variant="secondary" onClick={open}>Import saved filters</Button>

      {dialog && (
        <Dialog open onClose={() => setDialog(null)} labelledBy={titleId} className="w-[480px]">
          <div className="flex items-center justify-between border-b border-[var(--border-color)] px-5 py-3">
            <h2 id={titleId} className="text-sm font-semibold text-[var(--text-primary)]">Import saved filters</h2>
            <button
              type="button"
              aria-label="Close"
              onClick={() => setDialog(null)}
              className="rounded-control p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="px-5 pt-3 text-xs text-[var(--text-secondary)]">
            Each becomes a custom list in Vicu. Changes you make to these lists won&apos;t update the saved filters on your server.
          </p>
          <div className="max-h-[420px] overflow-y-auto px-3 py-2">
            {dialog.loading && <p className="px-2 py-6 text-center text-xs text-[var(--text-secondary)]">Reading the saved filters...</p>}
            {!dialog.loading && 'error' in dialog && <p className="px-2 py-3 text-xs text-danger">{dialog.error}</p>}
            {!dialog.loading && 'previews' in dialog && dialog.previews.map((preview) => {
              const importable = preview.result.list !== null
              const checked = dialog.checked.has(preview.filter.id)
              const status = importStatusText(preview, checked)
              return (
                <label
                  key={preview.filter.id}
                  className={cn(
                    'flex items-start gap-3 rounded-control px-2 py-2',
                    importable ? 'cursor-pointer hover:bg-[var(--bg-hover)]' : 'cursor-not-allowed',
                  )}
                >
                  <Checkbox
                    checked={checked}
                    disabled={!importable}
                    onChange={() => toggle(preview.filter.id)}
                    className="mt-0.5"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-[var(--text-primary)]">{preview.filter.title}</span>
                    {preview.rule !== '' && (
                      <span className="block break-words font-mono text-caption text-[var(--text-secondary)]">
                        {ruleToDisplay(preview.rule, named.labels, named.projects) || preview.rule}
                      </span>
                    )}
                    <span
                      className={cn(
                        'block text-caption',
                        !importable
                          ? 'text-danger'
                          : preview.imported_before && !checked
                            ? 'text-[var(--text-secondary)]'
                            : preview.result.status === 'exact'
                              ? 'text-accent-blue'
                              : 'text-[var(--text-primary)]',
                      )}
                    >
                      {status}
                    </span>
                  </span>
                </label>
              )
            })}
          </div>
          <div className="flex justify-end gap-2 border-t border-[var(--border-color)] px-5 py-3">
            <Button variant="secondary" onClick={() => setDialog(null)}>Cancel</Button>
            <Button variant="primary" disabled={checkedCount === 0} onClick={importChecked}>
              {checkedCount === 0 ? 'Import' : `Import ${checkedCount}`}
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  )
}
