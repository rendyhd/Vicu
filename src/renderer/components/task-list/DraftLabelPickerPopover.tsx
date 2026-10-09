import { useState, type RefObject } from 'react'
import { Check, Plus } from 'lucide-react'
import { useLabels } from '@/hooks/use-labels'
import { useCreateLabel } from '@/hooks/use-task-mutations'
import { normalizeHex } from '@/lib/constants'
import type { Label } from '@/lib/vikunja-types'
import { Popover, type PopoverCloseReason } from '../overlay/Popover'

export function DraftLabelPickerPopover({
  anchorRef,
  selectedIds,
  onChange,
  onClose,
}: {
  anchorRef: RefObject<HTMLElement | null>
  selectedIds: number[]
  onChange: (ids: number[]) => void
  onClose: (reason?: PopoverCloseReason) => void
}) {
  const { data: labels = [] } = useLabels()
  const createLabel = useCreateLabel()
  const [search, setSearch] = useState('')

  const toggle = (label: Label) => {
    onChange(selectedIds.includes(label.id)
      ? selectedIds.filter((id) => id !== label.id)
      : [...selectedIds, label.id])
  }
  const trimmed = search.trim()
  const exact = labels.some((label) => label.title.toLowerCase() === trimmed.toLowerCase())
  const filtered = labels.filter((label) => label.title.toLowerCase().includes(trimmed.toLowerCase()))

  return (
    <Popover anchorRef={anchorRef} onClose={onClose} label="Labels" className="w-52">
      <div className="border-b border-[var(--border-color)] px-3 py-2">
        <input
          data-autofocus
          aria-label="Search labels"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search labels..."
          className="w-full bg-transparent text-xs text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none"
          onKeyDown={(event) => {
            if (event.key === 'Enter' && trimmed && !exact) {
              event.preventDefault()
              createLabel.mutate({ title: trimmed }, { onSuccess: (label) => {
                onChange([...selectedIds, label.id])
                setSearch('')
              } })
            }
          }}
        />
      </div>
      <div role="listbox" aria-label="Labels" aria-multiselectable="true" className="max-h-60 overflow-y-auto py-1">
        {filtered.map((label) => (
          <button key={label.id} type="button" role="option" tabIndex={-1} aria-selected={selectedIds.includes(label.id)} onClick={() => toggle(label)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)]">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: normalizeHex(label.hex_color) || 'var(--text-secondary)' }} />
            <span className="min-w-0 flex-1 truncate">{label.title}</span>
            {selectedIds.includes(label.id) && <Check className="h-3.5 w-3.5 text-[var(--accent-blue)]" />}
          </button>
        ))}
        {trimmed && !exact && (
          <button type="button" role="option" tabIndex={-1} aria-selected={false} onClick={() => createLabel.mutate({ title: trimmed }, { onSuccess: (label) => onChange([...selectedIds, label.id]) })} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs italic text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]">
            <Plus className="h-3.5 w-3.5" /> Create “{trimmed}”
          </button>
        )}
      </div>
    </Popover>
  )
}
