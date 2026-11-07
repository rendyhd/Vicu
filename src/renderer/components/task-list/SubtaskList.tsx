import { useEffect, useState, useRef } from 'react'
import { ArrowDown, ArrowUp, ArrowUpRight, GripVertical, Pencil, Trash2 } from 'lucide-react'
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useQueryClient } from '@tanstack/react-query'
import { useSyncedPrefs, writeSyncedPrefs } from '@/hooks/use-synced-prefs'
import { isTempTaskId } from '@/lib/pending-cache'
import { movedId, readSubtaskOrder, sortSubtasks, subtaskOrderKey } from '../../../shared/subtask-order'
import { useSubtasks } from '@/hooks/use-subtasks'
import { useCreateSubtask, useCompleteTask, useDeleteTask, useUpdateTask } from '@/hooks/use-task-mutations'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { confirmDelete } from '@/lib/confirm-bridge'
import { renamedSubtaskTitle, taskDescendants } from '@/lib/task-hierarchy'
import type { Task } from '@/lib/vikunja-types'
import { confirmTaskCompletion } from '@/lib/task-completion'
import { useSelectionStore } from '@/stores/selection-store'
import { Menu, MenuItem, MenuSeparator } from '../overlay/Menu'
import { Tooltip } from '../overlay/Tooltip'

interface SubtaskListProps {
  parentTask: Task
  showInput?: boolean
}

const ACTION_BUTTON =
  'flex h-6 w-6 shrink-0 items-center justify-center rounded-control text-text-secondary transition-colors duration-fade-fast hover:bg-bg-hover hover:text-text'

export function SubtaskList({ parentTask, showInput = false }: SubtaskListProps) {
  const embeddedSubtasks = parentTask.related_tasks?.subtask ?? []
  const { data: fetchedSubtasks, isLoading } = useSubtasks(parentTask.id)
  const { snapshot } = useSyncedPrefs()
  const subtasks = sortSubtasks(fetchedSubtasks ?? embeddedSubtasks, readSubtaskOrder(snapshot.values[subtaskOrderKey(parentTask.id)]))
  const queryClient = useQueryClient()
  // Section 19: only ids the server has can be written, so a task made offline waits.
  const canMove = subtasks.length > 1 && !isTempTaskId(parentTask.id) && !subtasks.some((st) => isTempTaskId(st.id))
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  const writeOrder = (ids: number[]) => {
    void writeSyncedPrefs(queryClient, { [subtaskOrderKey(parentTask.id)]: ids })
  }
  const moveBy = (id: number, delta: number) => {
    const ids = movedId(subtasks.map((st) => st.id), id, delta)
    if (ids) writeOrder(ids)
  }
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const ids = subtasks.map((st) => st.id)
    const to = ids.indexOf(over.id as number)
    const moved = movedId(ids, active.id as number, to - ids.indexOf(active.id as number))
    if (moved) writeOrder(moved)
  }
  const createSubtask = useCreateSubtask()
  const completeTask = useCompleteTask()
  const updateTask = useUpdateTask()
  const deleteTask = useDeleteTask()
  const openSubtask = useSelectionStore((s) => s.openSubtask)
  const [newTitle, setNewTitle] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (showInput) inputRef.current?.focus()
  }, [showInput, isLoading])

  // Adding several in a row: each new row pushes the input down, so it follows.
  useEffect(() => {
    if (document.activeElement === inputRef.current) {
      inputRef.current?.scrollIntoView({ block: 'nearest' })
    }
  }, [subtasks.length])

  const handleSubmit = () => {
    const trimmed = newTitle.trim()
    if (!trimmed) return
    createSubtask.mutate(
      { parentTask, title: trimmed },
      { onSuccess: () => setNewTitle('') }
    )
  }

  const rename = (subtask: Task, draft: string) => {
    const title = renamedSubtaskTitle(subtask, draft)
    if (title) updateTask.mutate({ id: subtask.id, changes: { title }, original: subtask })
  }

  const remove = async (subtask: Task, returnFocusTo: HTMLElement | null) => {
    // The parent's subtask list does not say whether a subtask has subtasks of its own: read it.
    const result = await api.fetchTaskById(subtask.id)
    const task = result.success ? (result.data as Task) : subtask
    const count = taskDescendants(task).length
    let deleteSubtasks = true
    if (count > 0) {
      const deleteChildren = await confirmDelete(
        `Delete this subtask and ${count} ${count === 1 ? 'subtask' : 'subtasks'} of its own?`,
        { force: true, confirmLabel: 'Delete all', destructive: true, returnFocusTo },
      )
      if (!deleteChildren) {
        const keepChildren = await confirmDelete(
          `Keep ${count === 1 ? 'its subtask' : 'its subtasks'} as standalone tasks and delete only this subtask?`,
          { force: true, confirmLabel: 'Keep subtasks', destructive: false, returnFocusTo },
        )
        if (!keepChildren) return
        deleteSubtasks = false
      }
    } else if (!(await confirmDelete('Delete this subtask? This cannot be undone.', { returnFocusTo }))) {
      return
    }
    // Focus moves to the next subtask (or the one before) once this row is gone.
    const titles = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-subtask-title]') ?? [])]
    const at = titles.findIndex((el) => el.dataset.subtaskTitle === String(subtask.id))
    const next = titles[at + 1] ?? titles[at - 1]
    deleteTask.mutate({ task, deleteSubtasks })
    if (next) requestAnimationFrame(() => next.focus())
  }

  if (isLoading && subtasks.length === 0 && showInput) {
    return <div className="py-1 text-caption text-[var(--text-secondary)]">Loading subtasks...</div>
  }

  if (subtasks.length === 0 && !showInput) return null

  return (
    <div className="mt-2">
      {subtasks.length > 0 && (
        <div ref={listRef} className="mb-1 flex flex-col gap-0.5">
          <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          <SortableContext items={subtasks.map((st) => st.id)} strategy={verticalListSortingStrategy}>
          {subtasks.map((st, index) => (
            <SubtaskRow
              key={st.id}
              subtask={st}
              canMove={canMove}
              onMoveUp={index > 0 ? () => moveBy(st.id, -1) : undefined}
              onMoveDown={index < subtasks.length - 1 ? () => moveBy(st.id, 1) : undefined}
              onComplete={async () => {
                if (!st.done && await confirmTaskCompletion(st)) {
                  completeTask.mutate({ task: st, suppressTopLevelUndo: true })
                }
              }}
              onRename={(draft) => rename(st, draft)}
              onOpen={() => openSubtask(parentTask.id, st.id)}
              onDelete={(returnFocusTo) => void remove(st, returnFocusTo)}
            />
          ))}
          </SortableContext>
          </DndContext>
        </div>
      )}
      {completeTask.isError && (
        <div role="alert" className="mb-1 text-caption text-danger">
          Could not complete subtask: {completeTask.error.message}
        </div>
      )}

      {showInput && (
        <div className="flex items-center gap-2">
          <div className="h-3.5 w-3.5 shrink-0 rounded-control border border-dashed border-[var(--border-color)]" />
          <input
            ref={inputRef}
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                handleSubmit()
              }
              if (e.key === 'Escape') {
                setNewTitle('')
                inputRef.current?.blur()
              }
            }}
            placeholder="Add subtask..."
            className="flex-1 bg-transparent text-xs text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none"
          />
        </div>
      )}
    </div>
  )
}

interface SubtaskRowProps {
  subtask: Task
  canMove: boolean
  onMoveUp?: () => void
  onMoveDown?: () => void
  onComplete: () => void
  onRename: (draft: string) => void
  onOpen: () => void
  onDelete: (returnFocusTo: HTMLElement | null) => void
}

/**
 * One subtask in the open card: complete it, click the title to rename it in place, open it as its
 * own task, or delete it (the buttons at the end, or the right-click menu).
 */
function SubtaskRow({ subtask: st, canMove, onMoveUp, onMoveDown, onComplete, onRename, onOpen, onDelete }: SubtaskRowProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: st.id, disabled: !canMove })
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(st.title)
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null)
  const titleRef = useRef<HTMLButtonElement>(null)
  const deleteRef = useRef<HTMLButtonElement>(null)
  // Enter and Escape end the edit before the input's blur does: the blur must not save again.
  const ended = useRef(false)
  const refocusTitle = useRef(false)

  useEffect(() => {
    if (!editing && refocusTitle.current) {
      refocusTitle.current = false
      titleRef.current?.focus()
    }
  }, [editing])

  const startEditing = () => {
    ended.current = false
    setDraft(st.title)
    setEditing(true)
  }

  const endEditing = (save: boolean, refocus: boolean) => {
    if (ended.current) return
    ended.current = true
    refocusTitle.current = refocus
    setEditing(false)
    if (save) onRename(draft)
  }

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn('group/subrow relative flex items-center gap-2', isDragging && 'z-10 rounded-control bg-[var(--bg-hover)]')}
      onContextMenu={(e) => {
        if (editing) return
        e.preventDefault()
        e.stopPropagation()
        setMenuAt({ x: e.clientX, y: e.clientY })
      }}
    >
      {canMove && (
        <button
          ref={setActivatorNodeRef}
          type="button"
          {...attributes}
          {...listeners}
          // The keyboard's way is Move up and Move down in the row's menu.
          tabIndex={-1}
          aria-hidden="true"
          className="absolute -left-4 flex h-6 w-4 cursor-grab items-center justify-center text-[var(--text-secondary)] opacity-0 transition-opacity duration-fade-fast active:cursor-grabbing group-hover/subrow:opacity-100"
        >
          <GripVertical className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
      <button
        type="button"
        role="checkbox"
        aria-checked={st.done}
        aria-label={`Complete ${st.title}`}
        onClick={onComplete}
        // A 24 px target around the 14 px box.
        className="group/sub flex h-6 w-6 shrink-0 items-center justify-center"
      >
        <span
          className={cn(
            'flex h-3.5 w-3.5 items-center justify-center rounded-control border transition-colors',
            st.done
              ? 'border-accent-fill bg-accent-fill'
              : 'border-control-ring group-hover/sub:border-accent-fill'
          )}
        >
          {st.done && (
            <svg className="h-2 w-2 text-on-accent" viewBox="0 0 12 12" fill="none">
              <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </span>
      </button>
      {editing ? (
        <input
          type="text"
          autoFocus
          value={draft}
          aria-label={`Rename ${st.title}`}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              endEditing(true, true)
            }
            if (e.key === 'Escape') {
              // Only the edit ends, not the card.
              e.preventDefault()
              e.stopPropagation()
              endEditing(false, true)
            }
          }}
          onBlur={() => endEditing(true, false)}
          className="min-w-0 flex-1 rounded-control bg-bg-hover px-1 py-0.5 text-xs text-[var(--text-primary)] focus:outline-none"
        />
      ) : (
        <button
          ref={titleRef}
          type="button"
          data-subtask-title={st.id}
          aria-label={`Rename ${st.title}`}
          onClick={startEditing}
          className={cn(
            'min-w-0 flex-1 cursor-text truncate rounded-control px-1 py-0.5 text-left text-xs text-[var(--text-primary)] hover:bg-bg-hover',
            st.done && 'text-[var(--text-secondary)] line-through'
          )}
        >
          {st.title}
        </button>
      )}
      {!editing && (
        // Shown on hover and while the row has keyboard focus.
        <div className="flex shrink-0 items-center opacity-0 transition-opacity duration-fade-fast focus-within:opacity-100 group-hover/subrow:opacity-100">
          <Tooltip label="Open subtask">
            <button type="button" aria-label={`Open ${st.title}`} onClick={onOpen} className={ACTION_BUTTON}>
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </Tooltip>
          <Tooltip label="Delete subtask">
            <button
              ref={deleteRef}
              type="button"
              aria-label={`Delete ${st.title}`}
              onClick={() => onDelete(deleteRef.current)}
              className={cn(ACTION_BUTTON, 'hover:text-danger')}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </Tooltip>
        </div>
      )}
      {menuAt && (
        <Menu anchorPoint={menuAt} label="Subtask actions" onClose={() => setMenuAt(null)}>
          <MenuItem icon={<Pencil />} onSelect={startEditing}>Rename</MenuItem>
          <MenuItem icon={<ArrowUpRight />} onSelect={onOpen}>Open subtask</MenuItem>
          {canMove && onMoveUp && <MenuItem icon={<ArrowUp />} onSelect={onMoveUp}>Move up</MenuItem>}
          {canMove && onMoveDown && <MenuItem icon={<ArrowDown />} onSelect={onMoveDown}>Move down</MenuItem>}
          <MenuSeparator />
          <MenuItem icon={<Trash2 />} danger onSelect={() => onDelete(titleRef.current)}>Delete subtask</MenuItem>
        </Menu>
      )}
    </div>
  )
}
