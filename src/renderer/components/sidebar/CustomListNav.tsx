import { useEffect, useState, useCallback } from 'react'
import { useNavigate, useMatches } from '@tanstack/react-router'
import { Plus, List, Pencil, Trash2 } from 'lucide-react'
import { useSortable, SortableContext, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { useDndMonitor } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { cn } from '@/lib/cn'
import { api } from '@/lib/api'
import { CustomListDialog } from '@/components/shared/CustomListDialog'
import type { CustomList } from '@/lib/vikunja-types'

function CustomListItem({
  item,
  isActive,
  onNavigate,
  onContextMenu,
}: {
  item: CustomList
  isActive: boolean
  onNavigate: () => void
  onContextMenu: (e: React.MouseEvent) => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: `custom-list-${item.id}`,
    data: { type: 'custom-list', listId: item.id, list: item },
  })

  const yOnlyTransform = transform ? { ...transform, x: 0 } : transform
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(yOnlyTransform),
    transition: transition ?? undefined,
    opacity: isDragging ? 0.4 : undefined,
  }

  return (
    <button
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      type="button"
      onClick={onNavigate}
      onContextMenu={onContextMenu}
      className={cn(
        'flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium transition-colors',
        isActive
          ? 'bg-[var(--bg-selected)] text-[var(--text-primary)]'
          : 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
      )}
    >
      <List className="h-4 w-4 shrink-0 text-[var(--text-secondary)]" strokeWidth={1.8} />
      <span className="flex-1 truncate text-left">{item.name}</span>
    </button>
  )
}

export function CustomListNav() {
  const navigate = useNavigate()
  const matches = useMatches()
  const currentPath = matches[matches.length - 1]?.pathname ?? ''

  const [lists, setLists] = useState<CustomList[]>([])
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingList, setEditingList] = useState<CustomList | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; list: CustomList } | null>(null)

  const loadLists = useCallback(() => {
    api.getConfig().then((config) => {
      setLists(config?.custom_lists ?? [])
    })
  }, [])

  useEffect(() => {
    loadLists()
  }, [loadLists])

  // Close context menu on click outside
  useEffect(() => {
    if (!contextMenu) return
    const handler = () => setContextMenu(null)
    window.addEventListener('click', handler)
    return () => window.removeEventListener('click', handler)
  }, [contextMenu])

  // Handle custom list reorder via dnd monitor
  useDndMonitor({
    onDragEnd(event) {
      const { active, over } = event
      if (!over) return

      const activeType = (active.data.current as Record<string, unknown>)?.type
      if (activeType !== 'custom-list') return

      const activeId = (active.data.current as Record<string, unknown>)?.listId as string
      const overId = (over.data.current as Record<string, unknown>)?.listId as string | undefined
      if (!activeId || !overId || activeId === overId) return

      const oldIndex = lists.findIndex((l) => l.id === activeId)
      const newIndex = lists.findIndex((l) => l.id === overId)
      if (oldIndex === -1 || newIndex === -1) return

      const reordered = arrayMove(lists, oldIndex, newIndex)
      setLists(reordered)

      // Persist to config
      api.getConfig().then((config) => {
        if (config) {
          api.saveConfig({ ...config, custom_lists: reordered })
        }
      })
    },
  })

  const handleSave = async (list: CustomList) => {
    const config = await api.getConfig()
    if (!config) return

    const existing = config.custom_lists ?? []
    const idx = existing.findIndex((l) => l.id === list.id)
    const updated = idx >= 0
      ? existing.map((l) => (l.id === list.id ? list : l))
      : [...existing, list]

    await api.saveConfig({ ...config, custom_lists: updated })
    setLists(updated)
    setDialogOpen(false)
    setEditingList(null)
  }

  const handleDelete = async (id: string) => {
    const config = await api.getConfig()
    if (!config) return

    const updated = (config.custom_lists ?? []).filter((l) => l.id !== id)
    await api.saveConfig({ ...config, custom_lists: updated })
    setLists(updated)
    setContextMenu(null)

    // Navigate away if viewing the deleted list
    if (currentPath === `/list/${id}`) {
      navigate({ to: '/inbox' })
    }
  }

  const handleContextMenu = (e: React.MouseEvent, list: CustomList) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, list })
  }

  const sortableIds = lists.map((l) => `custom-list-${l.id}`)

  return (
    <>
      <div className="px-4 pb-1 pt-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            Lists
          </span>
          <button
            type="button"
            onClick={() => {
              setEditingList(null)
              setDialogOpen(true)
            }}
            className="flex h-5 w-5 items-center justify-center rounded text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            aria-label="New list"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <nav className="flex flex-col gap-0.5 px-2 pb-2">
        <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
          {lists.map((item) => {
            const path = `/list/${item.id}`
            const isActive = currentPath === path
            return (
              <CustomListItem
                key={item.id}
                item={item}
                isActive={isActive}
                onNavigate={() => navigate({ to: '/list/$listId', params: { listId: item.id } })}
                onContextMenu={(e) => handleContextMenu(e, item)}
              />
            )
          })}
        </SortableContext>

        {lists.length === 0 && (
          <p className="px-2.5 py-1 text-[11px] text-[var(--text-secondary)]">
            No custom lists yet
          </p>
        )}
      </nav>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed z-50 min-w-[140px] rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] py-1 shadow-lg"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            type="button"
            onClick={() => {
              setEditingList(contextMenu.list)
              setDialogOpen(true)
              setContextMenu(null)
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </button>
          <button
            type="button"
            onClick={() => handleDelete(contextMenu.list.id)}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-accent-red hover:bg-[var(--bg-hover)]"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
        </div>
      )}

      <CustomListDialog
        open={dialogOpen}
        list={editingList}
        onSave={handleSave}
        onClose={() => {
          setDialogOpen(false)
          setEditingList(null)
        }}
      />
    </>
  )
}
