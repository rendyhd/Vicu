import { useState, useEffect } from 'react'
import { useNavigate, useMatches } from '@tanstack/react-router'
import { useDroppable } from '@dnd-kit/core'
import { Pencil, Trash2, X } from 'lucide-react'
import { useLabels } from '@/hooks/use-labels'
import { useCreateLabel, useUpdateLabel, useDeleteLabel } from '@/hooks/use-task-mutations'
import { useSidebarStore } from '@/stores/sidebar-store'
import { cn } from '@/lib/cn'
import type { Label } from '@/lib/vikunja-types'

function LabelDialog({
  open,
  label,
  onClose,
}: {
  open: boolean
  label: Label | null
  onClose: () => void
}) {
  const [title, setTitle] = useState('')
  const [hexColor, setHexColor] = useState('')
  const createLabel = useCreateLabel()
  const updateLabel = useUpdateLabel()

  useEffect(() => {
    if (open) {
      setTitle(label?.title ?? '')
      setHexColor(label?.hex_color ?? '')
    }
  }, [open, label])

  if (!open) return null

  const handleSave = () => {
    const trimmed = title.trim()
    if (!trimmed) return

    if (label) {
      updateLabel.mutate(
        { id: label.id, label: { title: trimmed, hex_color: hexColor || undefined } },
        { onSuccess: onClose }
      )
    } else {
      createLabel.mutate(
        { title: trimmed, hex_color: hexColor || undefined },
        { onSuccess: onClose }
      )
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-[360px] rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border-color)] px-5 py-3">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">
            {label ? 'Edit Tag' : 'New Tag'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div>
            <label className="mb-1 block text-xs text-[var(--text-secondary)]">Name</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Tag name"
              autoFocus
              className="w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:border-accent-blue focus:outline-none"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSave()
              }}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-[var(--text-secondary)]">Color</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={hexColor || '#6b7280'}
                onChange={(e) => setHexColor(e.target.value)}
                className="h-8 w-8 cursor-pointer rounded border border-[var(--border-color)]"
              />
              <input
                type="text"
                value={hexColor}
                onChange={(e) => setHexColor(e.target.value)}
                placeholder="#hex"
                className="flex-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:border-accent-blue focus:outline-none"
              />
              {hexColor && (
                <button
                  type="button"
                  onClick={() => setHexColor('')}
                  className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--border-color)] px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-[var(--border-color)] px-4 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!title.trim()}
            className={cn(
              'rounded-md px-4 py-1.5 text-xs font-medium transition-colors',
              'bg-accent-blue text-white hover:bg-accent-blue/90',
              'disabled:cursor-not-allowed disabled:opacity-50'
            )}
          >
            {label ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}

function TagListItem({
  label,
  onContextMenu,
}: {
  label: Label
  onContextMenu: (e: React.MouseEvent, label: Label) => void
}) {
  const navigate = useNavigate()
  const matches = useMatches()
  const currentPath = matches[matches.length - 1]?.pathname ?? ''
  const isActive = currentPath === `/tag/${label.id}`

  const { setNodeRef, isOver } = useDroppable({
    id: `label-${label.id}`,
    data: { type: 'label', labelId: label.id },
  })

  return (
    <button
      ref={setNodeRef}
      key={label.id}
      type="button"
      onClick={() => navigate({ to: '/tag/$labelId', params: { labelId: String(label.id) } })}
      onContextMenu={(e) => onContextMenu(e, label)}
      className={cn(
        'flex h-7 items-center gap-2.5 rounded-md px-2.5 text-xs transition-colors',
        isOver
          ? 'bg-[var(--accent-blue)]/15 ring-1 ring-[var(--accent-blue)]'
          : isActive
            ? 'bg-[var(--bg-selected)] text-[var(--text-primary)]'
            : 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
      )}
    >
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: label.hex_color || 'var(--text-secondary)' }}
      />
      <span className="min-w-0 flex-1 truncate text-left">{label.title}</span>
    </button>
  )
}

export function TagList() {
  const { data: labels, isLoading } = useLabels()
  const deleteLabel = useDeleteLabel()
  const { labelDialogOpen, setLabelDialogOpen } = useSidebarStore()

  const [editingLabel, setEditingLabel] = useState<Label | null>(null)
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    label: Label
  } | null>(null)

  // Close context menu on click outside
  useEffect(() => {
    if (!contextMenu) return
    const handler = () => setContextMenu(null)
    window.addEventListener('click', handler)
    return () => window.removeEventListener('click', handler)
  }, [contextMenu])

  const handleContextMenu = (e: React.MouseEvent, label: Label) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, label })
  }

  const handleCloseDialog = () => {
    setLabelDialogOpen(false)
    setEditingLabel(null)
  }

  if (isLoading || !labels) return null

  return (
    <>
      <div className="flex flex-col gap-0.5 px-2">
        {labels.map((label) => (
          <TagListItem key={label.id} label={label} onContextMenu={handleContextMenu} />
        ))}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed z-50 min-w-[140px] rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] py-1 shadow-lg"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            type="button"
            onClick={() => {
              setEditingLabel(contextMenu.label)
              setLabelDialogOpen(true)
              setContextMenu(null)
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </button>
          <button
            type="button"
            onClick={() => {
              deleteLabel.mutate(contextMenu.label.id)
              setContextMenu(null)
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-accent-red hover:bg-[var(--bg-hover)]"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
        </div>
      )}

      <LabelDialog
        open={labelDialogOpen}
        label={editingLabel}
        onClose={handleCloseDialog}
      />
    </>
  )
}
