import { useRef, useEffect, useState } from 'react'
import { Check, Plus } from 'lucide-react'
import { useLabels } from '@/hooks/use-labels'
import { useAddLabel, useRemoveLabel, useCreateLabel } from '@/hooks/use-task-mutations'
import type { Label, Task } from '@/lib/vikunja-types'
import { normalizeHex } from '@/lib/constants'
import { usePopoverAlignment } from './use-popover-alignment'

interface LabelPickerPopoverProps {
  /** Tasks to apply labels to. One for the expanded card; many for a multi-selection. */
  tasks: Task[]
  onClose: () => void
  onApplied?: (label: Label) => void
}

export function LabelPickerPopover({ tasks, onClose, onApplied }: LabelPickerPopoverProps) {
  const ref = useRef<HTMLDivElement>(null)
  const align = usePopoverAlignment(ref)
  const { data: allLabels } = useLabels()
  const addLabel = useAddLabel()
  const removeLabel = useRemoveLabel()
  const createLabel = useCreateLabel()

  const [searchQuery, setSearchQuery] = useState('')

  // Labels present on EVERY selected task → checkmarked, and clicking removes
  // from all. A label on only some tasks shows unchecked, and clicking adds it
  // to the tasks that lack it.
  const commonIds = new Set<number>()
  if (tasks.length > 0) {
    for (const l of tasks[0].labels ?? []) {
      if (tasks.every((t) => (t.labels ?? []).some((x) => x.id === l.id))) {
        commonIds.add(l.id)
      }
    }
  }

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onClose])

  const toggle = (label: Label) => {
    if (commonIds.has(label.id)) {
      tasks.forEach((t) => removeLabel.mutate({ taskId: t.id, labelId: label.id }))
    } else {
      tasks.forEach((t) => {
        if (!(t.labels ?? []).some((x) => x.id === label.id)) {
          addLabel.mutate({ taskId: t.id, labelId: label.id })
        }
      })
      onApplied?.(label)
    }
  }

  const handleCreateAndAssign = (title: string) => {
    createLabel.mutate(
      { title: title.trim() },
      {
        onSuccess: (newLabel) => {
          tasks.forEach((t) => addLabel.mutate({ taskId: t.id, labelId: newLabel.id }))
          onApplied?.(newLabel)
          setSearchQuery('')
        },
      }
    )
  }

  const filteredLabels = (allLabels ?? []).filter((label) =>
    label.title.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const trimmedQuery = searchQuery.trim()
  const exactMatch = (allLabels ?? []).some(
    (l) => l.title.toLowerCase() === trimmedQuery.toLowerCase()
  )

  return (
    <div
      ref={ref}
      className={`absolute ${align} top-full z-50 mt-1 w-52 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] shadow-lg`}
    >
      {/* Search field */}
      <div className="border-b border-[var(--border-color)] px-3 py-2">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search labels..."
          autoFocus
          className="w-full bg-transparent text-xs text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && trimmedQuery && !exactMatch) {
              handleCreateAndAssign(trimmedQuery)
            }
          }}
        />
      </div>

      <div className="max-h-60 overflow-y-auto py-1">
        {filteredLabels.length === 0 && !trimmedQuery && (
          <div className="px-3 py-2 text-xs text-[var(--text-secondary)]">No labels</div>
        )}

        {filteredLabels.map((label) => (
          <button
            key={label.id}
            type="button"
            onClick={() => toggle(label)}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
          >
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: normalizeHex(label.hex_color) || 'var(--text-secondary)' }}
            />
            <span className="min-w-0 flex-1 truncate">{label.title}</span>
            {commonIds.has(label.id) && (
              <Check className="h-3.5 w-3.5 shrink-0 text-[var(--accent-blue)]" />
            )}
          </button>
        ))}

        {/* Create new label option */}
        {trimmedQuery && !exactMatch && (
          <button
            type="button"
            onClick={() => handleCreateAndAssign(trimmedQuery)}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs italic text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          >
            <Plus className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">
              Create &ldquo;{trimmedQuery}&rdquo;
            </span>
          </button>
        )}
      </div>
    </div>
  )
}
