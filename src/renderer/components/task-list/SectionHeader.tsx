import { useState, useRef, useEffect } from 'react'
import { Plus, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { useSortable, defaultAnimateLayoutChanges } from '@dnd-kit/sortable'
import type { AnimateLayoutChanges } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useDndContext } from '@dnd-kit/core'
import { cn } from '@/lib/cn'
import { useUpdateProject, useDeleteProject } from '@/hooks/use-task-mutations'
import type { Project } from '@/lib/vikunja-types'

interface SectionHeaderProps {
  project: Project
  siblings: Project[]
  onAddTask: () => void
}

const sectionAnimateLayoutChanges: AnimateLayoutChanges = (args) => {
  if (args.isSorting) {
    return defaultAnimateLayoutChanges(args)
  }
  return false
}

export function SectionHeader({ project, siblings, onAddTask }: SectionHeaderProps) {
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(project.title)
  const [showMenu, setShowMenu] = useState(false)
  const renameRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuBtnRef = useRef<HTMLButtonElement>(null)
  const updateProject = useUpdateProject()
  const deleteProject = useDeleteProject()
  const { active } = useDndContext()

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({
    id: `section-${project.id}`,
    data: { type: 'section', project, siblings },
    disabled: isRenaming,
    animateLayoutChanges: sectionAnimateLayoutChanges,
  })

  const activeType = (active?.data.current as Record<string, unknown>)?.type as string | undefined
  const isTaskDragOver = isOver && activeType === 'task'

  const yOnlyTransform = transform ? { ...transform, x: 0 } : transform
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(yOnlyTransform),
    transition: active ? (transition ?? undefined) : undefined,
    opacity: isDragging ? 0.4 : undefined,
  }

  useEffect(() => {
    if (isRenaming && renameRef.current) {
      renameRef.current.focus()
      renameRef.current.select()
    }
  }, [isRenaming])

  useEffect(() => {
    if (!showMenu) return
    const handler = (e: MouseEvent) => {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        menuBtnRef.current && !menuBtnRef.current.contains(e.target as Node)
      ) {
        setShowMenu(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showMenu])

  const handleRenameSubmit = () => {
    const trimmed = renameValue.trim()
    if (trimmed && trimmed !== project.title) {
      updateProject.mutate({
        id: project.id,
        project: {
          title: trimmed,
          description: project.description,
          hex_color: project.hex_color,
          is_archived: project.is_archived,
          position: project.position,
          parent_project_id: project.parent_project_id,
        },
      })
    }
    setIsRenaming(false)
  }

  const handleDelete = () => {
    setShowMenu(false)
    deleteProject.mutate(project.id)
  }

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={cn(
        'group flex h-9 cursor-grab items-center gap-2 px-4 pt-4 pb-1 rounded-md',
        isDragging && 'cursor-grabbing',
        isTaskDragOver && 'bg-[var(--accent-blue)]/10'
      )}
      style={style}
    >
      {isRenaming ? (
        <input
          ref={renameRef}
          type="text"
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleRenameSubmit()
            if (e.key === 'Escape') {
              setRenameValue(project.title)
              setIsRenaming(false)
            }
          }}
          onBlur={handleRenameSubmit}
          className="flex-1 bg-transparent text-[13px] font-bold text-[var(--text-primary)] focus:outline-none"
        />
      ) : (
        <span className="flex-1 truncate text-[13px] font-bold text-[var(--text-primary)]">
          {project.title}
        </span>
      )}

      <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onAddTask()
          }}
          className="flex h-5 w-5 items-center justify-center rounded text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--accent-blue)]"
          aria-label="Add task to section"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>

        <div className="relative">
          <button
            ref={menuBtnRef}
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setShowMenu((s) => !s)
            }}
            className="flex h-5 w-5 items-center justify-center rounded text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
            aria-label="Section menu"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>

          {showMenu && (
            <div
              ref={menuRef}
              className="absolute right-0 top-6 z-50 min-w-[120px] rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] py-1 shadow-lg"
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setShowMenu(false)
                  setRenameValue(project.title)
                  setIsRenaming(true)
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
              >
                <Pencil className="h-3 w-3" />
                Rename
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  handleDelete()
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-accent-red hover:bg-[var(--bg-hover)]"
              >
                <Trash2 className="h-3 w-3" />
                Delete
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
