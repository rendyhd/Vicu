import { useEffect, useState } from 'react'
import { useNavigate, useMatches } from '@tanstack/react-router'
import {
  Plus, List, ListFilter, Folder, Star, Heart, Home, Briefcase, GraduationCap,
  ShoppingCart, Dumbbell, Code2, PawPrint, Sparkles, Lightbulb, Bookmark, Flag,
  Wrench, Palette, Pencil, Trash2, CloudOff, Loader2, RefreshCw,
  type LucideIcon,
} from 'lucide-react'
import { useSortable, SortableContext, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { useDndMonitor } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { cn } from '@/lib/cn'
import { CustomListDialog } from '@/components/shared/CustomListDialog'
import type { CustomList } from '@/lib/vikunja-types'
import {
  useCustomLists,
  useCustomListSyncStatus,
  useDeleteCustomList,
  useReorderCustomLists,
  useSyncCustomLists,
  useUpsertCustomList,
} from '@/hooks/use-custom-lists'

const CUSTOM_LIST_ICONS: Record<string, LucideIcon> = {
  filter_list: ListFilter,
  folder: Folder,
  star: Star,
  favorite: Heart,
  home: Home,
  work: Briefcase,
  school: GraduationCap,
  shopping_cart: ShoppingCart,
  fitness: Dumbbell,
  code: Code2,
  pets: PawPrint,
  auto_awesome: Sparkles,
  lightbulb: Lightbulb,
  bookmark: Bookmark,
  flag: Flag,
  build: Wrench,
  palette: Palette,
}

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
  const ItemIcon = CUSTOM_LIST_ICONS[item.icon ?? ''] ?? List
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
      <ItemIcon className="h-4 w-4 shrink-0 text-[var(--text-secondary)]" strokeWidth={1.8} />
      <span className="flex-1 truncate text-left">{item.name}</span>
    </button>
  )
}

export function CustomListNav() {
  const navigate = useNavigate()
  const matches = useMatches()
  const currentPath = matches[matches.length - 1]?.pathname ?? ''

  const { data: lists = [] } = useCustomLists()
  const { data: syncStatus } = useCustomListSyncStatus()
  const upsertList = useUpsertCustomList()
  const deleteList = useDeleteCustomList()
  const reorderLists = useReorderCustomLists()
  const syncLists = useSyncCustomLists()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingList, setEditingList] = useState<CustomList | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; list: CustomList } | null>(null)

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
      reorderLists.mutate(reordered.map((list) => list.id))
    },
  })

  const handleSave = async (list: CustomList) => {
    await upsertList.mutateAsync(list)
    setDialogOpen(false)
    setEditingList(null)
  }

  const handleDelete = async (id: string) => {
    await deleteList.mutateAsync(id)
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
          <div className="flex items-center gap-0.5">
            {syncStatus && !['idle', 'local_only'].includes(syncStatus.state) && (
              <button
                type="button"
                onClick={() => syncLists.mutate()}
                disabled={syncStatus.state === 'syncing'}
                className={cn(
                  'flex h-5 w-5 items-center justify-center rounded transition-colors hover:bg-[var(--bg-hover)]',
                  syncStatus.state === 'error' || syncStatus.state === 'update_required'
                    ? 'text-accent-red'
                    : 'text-[var(--text-secondary)]',
                )}
                title={'message' in syncStatus ? syncStatus.message : syncStatus.state === 'pending' ? 'Custom-list sync pending' : 'Syncing custom lists'}
                aria-label="Retry custom-list sync"
              >
                {syncStatus.state === 'syncing' ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : syncStatus.state === 'offline' ? <CloudOff className="h-3.5 w-3.5" />
                    : <RefreshCw className="h-3.5 w-3.5" />}
              </button>
            )}
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
