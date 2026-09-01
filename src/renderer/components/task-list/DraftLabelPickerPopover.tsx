import { useEffect, useRef, useState } from 'react'
import { Check, Plus } from 'lucide-react'
import { useLabels } from '@/hooks/use-labels'
import { useCreateLabel } from '@/hooks/use-task-mutations'
import { normalizeHex } from '@/lib/constants'
import type { Label } from '@/lib/vikunja-types'
import { usePopoverAlignment } from './use-popover-alignment'

export function DraftLabelPickerPopover({
  selectedIds,
  onChange,
  onClose,
}: {
  selectedIds: number[]
  onChange: (ids: number[]) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const align = usePopoverAlignment(ref)
  const { data: labels = [] } = useLabels()
  const createLabel = useCreateLabel()
  const [search, setSearch] = useState('')

  useEffect(() => {
    const listener = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose()
    }
    document.addEventListener('mousedown', listener)
    return () => document.removeEventListener('mousedown', listener)
  }, [onClose])

  const toggle = (label: Label) => {
    onChange(selectedIds.includes(label.id)
      ? selectedIds.filter((id) => id !== label.id)
      : [...selectedIds, label.id])
  }
  const trimmed = search.trim()
  const exact = labels.some((label) => label.title.toLowerCase() === trimmed.toLowerCase())
  const filtered = labels.filter((label) => label.title.toLowerCase().includes(trimmed.toLowerCase()))

  return (
    <div ref={ref} className={`absolute ${align} top-full z-50 mt-1 w-52 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] shadow-lg`}>
      <div className="border-b border-[var(--border-color)] px-3 py-2">
        <input
          autoFocus
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
      <div className="max-h-60 overflow-y-auto py-1">
        {filtered.map((label) => (
          <button key={label.id} type="button" onClick={() => toggle(label)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)]">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: normalizeHex(label.hex_color) || 'var(--text-secondary)' }} />
            <span className="min-w-0 flex-1 truncate">{label.title}</span>
            {selectedIds.includes(label.id) && <Check className="h-3.5 w-3.5 text-[var(--accent-blue)]" />}
          </button>
        ))}
        {trimmed && !exact && (
          <button type="button" onClick={() => createLabel.mutate({ title: trimmed }, { onSuccess: (label) => onChange([...selectedIds, label.id]) })} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs italic text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]">
            <Plus className="h-3.5 w-3.5" /> Create “{trimmed}”
          </button>
        )}
      </div>
    </div>
  )
}
