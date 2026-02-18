import { useState, useRef, useEffect, useCallback } from 'react'
import { Calendar, Tag, ListChecks, FolderOpen, Trash2, Bell, Repeat, Paperclip } from 'lucide-react'
import { useDraggable } from '@dnd-kit/core'
import { useSortable, defaultAnimateLayoutChanges } from '@dnd-kit/sortable'
import type { AnimateLayoutChanges } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { cn } from '@/lib/cn'
import { useSelectionStore } from '@/stores/selection-store'
import { useUpdateTask, useCompleteTask, useDeleteTask, useUploadAttachmentFromDrop } from '@/hooks/use-task-mutations'
import { isNullDate } from '@/lib/date-utils'
import type { Task, TaskReminder } from '@/lib/vikunja-types'
import { TaskCheckbox } from './TaskCheckbox'
import { TaskDueBadge } from './TaskDueBadge'
import { PriorityDot } from '@/components/shared/PriorityDot'
import { DatePickerPopover } from './DatePickerPopover'
import { LabelPickerPopover } from './LabelPickerPopover'
import { SubtaskList } from './SubtaskList'
import { ProjectPickerPopover } from './ProjectPickerPopover'
import { ReminderPickerPopover } from './ReminderPickerPopover'
import { AttachmentPickerPopover } from './AttachmentPickerPopover'
import { TaskLinkIcon } from '@/components/TaskLinkIcon'
import { stripNoteLink, stripPageLink, extractNoteLinkHtml, extractPageLinkHtml } from '@/lib/note-link'
import { formatRecurrenceLabel } from '@/lib/recurrence'

type PopoverType = 'date' | 'label' | 'project' | 'subtasks' | 'reminder' | 'attachment' | null

function getLabelStyle(hex: string | undefined): React.CSSProperties {
  if (!hex) return { backgroundColor: 'var(--bg-hover)', color: 'var(--text-secondary)' }
  const isDark = document.documentElement.classList.contains('dark')
  if (isDark) {
    // Lighten the color for readable text on dark backgrounds
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    const lr = Math.min(255, r + Math.round((255 - r) * 0.45))
    const lg = Math.min(255, g + Math.round((255 - g) * 0.45))
    const lb = Math.min(255, b + Math.round((255 - b) * 0.45))
    return {
      backgroundColor: `rgba(${r}, ${g}, ${b}, 0.2)`,
      color: `rgb(${lr}, ${lg}, ${lb})`,
    }
  }
  return { backgroundColor: `${hex}20`, color: hex }
}

interface TaskRowProps {
  task: Task
  sortable?: boolean
}

// Animate displacement during active drag, but never animate layout changes after drop.
// The default FLIP animation after drop causes a visual "bump" because items briefly
// snap to their old positions before animating to new ones.
const sortableAnimateLayoutChanges: AnimateLayoutChanges = (args) => {
  if (args.isSorting) {
    return defaultAnimateLayoutChanges(args)
  }
  return false
}

function useDragBehavior(task: Task, sortable: boolean) {
  const draggable = useDraggable({
    id: `task-${task.id}`,
    data: { type: 'task', task },
    disabled: sortable,
  })

  const sortableHook = useSortable({
    id: `task-${task.id}`,
    data: { type: 'task', task, sortable: true },
    disabled: !sortable,
    animateLayoutChanges: sortableAnimateLayoutChanges,
  })

  if (sortable) {
    return {
      attributes: sortableHook.attributes,
      listeners: sortableHook.listeners,
      setNodeRef: sortableHook.setNodeRef,
      isDragging: sortableHook.isDragging,
      style: {
        transform: CSS.Transform.toString(sortableHook.transform),
        transition: sortableHook.transition,
      } as React.CSSProperties,
    }
  }

  return {
    attributes: draggable.attributes,
    listeners: draggable.listeners,
    setNodeRef: draggable.setNodeRef,
    isDragging: draggable.isDragging,
    style: {} as React.CSSProperties,
  }
}

export function TaskRow({ task, sortable = false }: TaskRowProps) {
  const { expandedTaskId, focusedTaskId, toggleExpandedTask, setFocusedTask, collapseAll } =
    useSelectionStore()
  const updateTask = useUpdateTask()
  const completeTask = useCompleteTask()
  const deleteTask = useDeleteTask()
  const uploadFromDrop = useUploadAttachmentFromDrop()
  const isExpanded = expandedTaskId === task.id
  const isFocused = focusedTaskId === task.id

  const { attributes, listeners, setNodeRef, isDragging, style } = useDragBehavior(task, sortable)

  const [editTitle, setEditTitle] = useState(task.title)
  const [editDescription, setEditDescription] = useState(stripPageLink(stripNoteLink(task.description)))
  const [isDragOver, setIsDragOver] = useState(false)
  const [dropError, setDropError] = useState<string | null>(null)
  const noteLinkHtml = extractNoteLinkHtml(task.description) + extractPageLinkHtml(task.description)
  const [activePopover, setActivePopover] = useState<PopoverType>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const descRef = useRef<HTMLTextAreaElement>(null)

  // Flash red border briefly when drag-drop upload fails, show error message
  useEffect(() => {
    if (uploadFromDrop.isError) {
      setDropError(uploadFromDrop.error?.message || 'Upload failed')
      const timer = setTimeout(() => setDropError(null), 4000)
      return () => clearTimeout(timer)
    }
  }, [uploadFromDrop.isError, uploadFromDrop.failureCount, uploadFromDrop.error])

  // Sync local state when task changes from server
  useEffect(() => {
    setEditTitle(task.title)
  }, [task.title])

  useEffect(() => {
    setEditDescription(stripPageLink(stripNoteLink(task.description)))
  }, [task.description])

  // Focus title input when expanded, and auto-size description textarea
  useEffect(() => {
    if (isExpanded) {
      titleRef.current?.focus()
      // Auto-size description textarea for existing content
      if (descRef.current) {
        const el = descRef.current
        el.style.height = 'auto'
        const maxH = 10 * 18
        el.style.height = `${Math.min(el.scrollHeight, maxH)}px`
        el.style.overflowY = el.scrollHeight > maxH ? 'auto' : 'hidden'
      }
    }
  }, [isExpanded])

  const handleSave = useCallback(() => {
    const changes: Partial<Task> = {}
    if (editTitle.trim() && editTitle !== task.title) {
      changes.title = editTitle.trim()
    }
    const fullDescription = noteLinkHtml ? (editDescription ? editDescription + noteLinkHtml : noteLinkHtml) : editDescription
    if (fullDescription !== task.description) {
      changes.description = fullDescription
    }
    if (Object.keys(changes).length > 0) {
      updateTask.mutate({ id: task.id, task: { ...task, ...changes } })
    }
  }, [editTitle, editDescription, noteLinkHtml, task, updateTask])

  const handleDateChange = useCallback(
    (isoDate: string) => {
      updateTask.mutate({ id: task.id, task: { ...task, due_date: isoDate } })
    },
    [task, updateTask]
  )

  const handleReminderChange = useCallback(
    (reminders: TaskReminder[]) => {
      updateTask.mutate({ id: task.id, task: { ...task, reminders } })
    },
    [task, updateTask]
  )

  const handleRecurrenceChange = useCallback(
    (repeat_after: number, repeat_mode: number) => {
      updateTask.mutate({ id: task.id, task: { ...task, repeat_after, repeat_mode } })
    },
    [task, updateTask]
  )

  const setDateToToday = useCallback(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    updateTask.mutate({ id: task.id, task: { ...task, due_date: today.toISOString() } })
  }, [task, updateTask])

  const togglePopover = (popover: PopoverType) => {
    setActivePopover((prev) => (prev === popover ? null : popover))
  }

  // Handle keyboard shortcuts inside expanded task inputs
  const handleExpandedKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Ctrl+Enter: save and close
      if (e.ctrlKey && e.key === 'Enter') {
        e.preventDefault()
        handleSave()
        collapseAll()
        return
      }
      // Ctrl+K: complete task
      if (e.ctrlKey && e.key === 'k') {
        e.preventDefault()
        if (!task.done) {
          handleSave()
          completeTask.mutate(task)
          collapseAll()
        }
        return
      }
      // Ctrl+T: set date to today
      if (e.ctrlKey && e.key === 't') {
        e.preventDefault()
        setDateToToday()
        return
      }
      // Ctrl+Backspace: delete task
      if (e.ctrlKey && e.key === 'Backspace') {
        e.preventDefault()
        deleteTask.mutate(task.id)
        collapseAll()
        return
      }
    },
    [handleSave, collapseAll, completeTask, deleteTask, task, setDateToToday]
  )

  const handleFileDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault()
      e.stopPropagation()
      setIsDragOver(true)
    }
  }, [])

  const handleFileDragLeave = useCallback((e: React.DragEvent) => {
    e.stopPropagation()
    setIsDragOver(false)
  }, [])

  const handleFileDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragOver(false)
      const files = e.dataTransfer.files
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const reader = new FileReader()
        reader.onload = () => {
          if (reader.result instanceof ArrayBuffer) {
            uploadFromDrop.mutate({
              taskId: task.id,
              fileData: new Uint8Array(reader.result),
              fileName: file.name,
              mimeType: file.type || 'application/octet-stream',
            })
          }
        }
        reader.readAsArrayBuffer(file)
      }
    },
    [task.id, uploadFromDrop]
  )

  const labels = task.labels ?? []

  // Collapsed row — entire row is draggable (PointerSensor distance:8 distinguishes click vs drag)
  if (!isExpanded) {
    return (
      <div
        ref={setNodeRef}
        data-task-id={task.id}
        className={cn(
          'group flex h-10 cursor-default items-center gap-3 border-b border-[var(--border-color)] px-4 transition-colors hover:bg-[var(--bg-hover)]',
          isFocused && !isExpanded && 'bg-[var(--accent-blue)]/8 ring-1 ring-inset ring-[var(--accent-blue)]/30',
          isDragging && 'opacity-30',
          isDragOver && 'ring-2 ring-inset ring-[var(--accent-blue)] bg-[var(--accent-blue)]/5',
          dropError && 'ring-2 ring-inset ring-red-500 bg-red-500/5'
        )}
        style={style}
        onClick={() => {
          setFocusedTask(task.id)
          toggleExpandedTask(task.id)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') toggleExpandedTask(task.id)
        }}
        onDragOver={handleFileDragOver}
        onDragLeave={handleFileDragLeave}
        onDrop={handleFileDrop}
        role="button"
        tabIndex={0}
        {...listeners}
        {...attributes}
      >
        <TaskCheckbox task={task} />

        {labels.length > 0 && (
          <div className="flex shrink-0 items-center gap-1">
            {labels.map((l) => (
              <span
                key={l.id}
                className="rounded-full px-1.5 py-px text-[10px] font-medium leading-tight"
                style={getLabelStyle(l.hex_color)}
              >
                {l.title}
              </span>
            ))}
          </div>
        )}

        <span
          className={cn(
            'min-w-0 flex-1 truncate text-[13px] text-[var(--text-primary)]',
            task.done && 'text-[var(--text-secondary)] line-through'
          )}
        >
          {dropError ? (
            <span className="text-red-500">{dropError}</span>
          ) : (
            task.title
          )}
        </span>

        <TaskLinkIcon description={task.description} />

        <div className="flex items-center gap-2">
          {(task.repeat_after ?? 0) > 0 || (task.repeat_mode ?? 0) > 0 ? (
            <Repeat className="h-3 w-3 text-[var(--text-secondary)]" />
          ) : null}
          {(task.attachments?.length ?? 0) > 0 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                toggleExpandedTask(task.id)
                setActivePopover('attachment')
              }}
              className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              <Paperclip className="h-3 w-3" />
            </button>
          )}
          {(task.reminders?.length ?? 0) > 0 && (
            <Bell className="h-3 w-3 text-[var(--text-secondary)]" />
          )}
          <PriorityDot priority={task.priority} />
          <TaskDueBadge dueDate={task.due_date} />
        </div>
      </div>
    )
  }

  // Expanded card — pop-out style
  return (
    <div
      data-task-id={task.id}
      className={cn(
        'mx-2 my-1 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] shadow-md',
        isDragOver && 'ring-2 ring-[var(--accent-blue)] bg-[var(--accent-blue)]/5',
        dropError && 'ring-2 ring-red-500 bg-red-500/5'
      )}
      onKeyDown={handleExpandedKeyDown}
      onDragOver={handleFileDragOver}
      onDragLeave={handleFileDragLeave}
      onDrop={handleFileDrop}
    >
      {/* Title row */}
      <div className="flex items-center gap-3 px-4 pt-3">
        <TaskCheckbox task={task} className="mt-0.5" />
        <input
          ref={titleRef}
          type="text"
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          onBlur={handleSave}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.ctrlKey) {
              e.preventDefault()
              descRef.current?.focus()
            }
            if (e.key === 'Escape') {
              handleSave()
              collapseAll()
            }
          }}
          className="flex-1 bg-transparent text-[13px] font-medium text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none"
          placeholder="Task title"
        />
        <TaskLinkIcon description={task.description} />
        {(task.attachments?.length ?? 0) > 0 && (
          <button
            type="button"
            onClick={() => togglePopover('attachment')}
            className="shrink-0 text-[var(--text-secondary)]"
            title="Attachments"
          >
            <Paperclip className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Description */}
      <div className="px-4 pt-2 pl-[43px]">
        <textarea
          ref={descRef}
          value={editDescription}
          onChange={(e) => {
            setEditDescription(e.target.value)
            // Auto-resize textarea
            const el = e.target
            el.style.height = 'auto'
            const maxH = 10 * 18
            el.style.height = `${Math.min(el.scrollHeight, maxH)}px`
            el.style.overflowY = el.scrollHeight > maxH ? 'auto' : 'hidden'
          }}
          onBlur={handleSave}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              handleSave()
              collapseAll()
            }
          }}
          placeholder="Notes"
          rows={1}
          className="custom-scrollbar w-full resize-none bg-transparent text-xs leading-[18px] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none"
          style={{ overflowY: 'hidden' }}
        />
      </div>

      {/* Subtasks — only visible when toggled via ListChecks button */}
      {activePopover === 'subtasks' && (
        <div className="px-4 pl-[43px]">
          <SubtaskList parentTask={task} />
        </div>
      )}

      {/* Action bar */}
      <div className="flex items-center justify-between px-4 pb-3 pt-2 pl-[43px]">
        {/* Labels */}
        <div className="flex flex-1 flex-wrap items-center gap-1">
          {labels.map((l) => (
            <span
              key={l.id}
              className="rounded-full px-2 py-0.5 text-2xs font-medium"
              style={getLabelStyle(l.hex_color)}
            >
              {l.title}
            </span>
          ))}
          {!isNullDate(task.due_date) && (
            <TaskDueBadge dueDate={task.due_date} />
          )}
          {((task.repeat_after ?? 0) > 0 || (task.repeat_mode ?? 0) > 0) && (
            <span className="flex items-center gap-0.5 text-2xs text-[var(--text-secondary)]">
              <Repeat className="h-3 w-3" />
              {formatRecurrenceLabel(task.repeat_after ?? 0, task.repeat_mode ?? 0)}
            </span>
          )}
          <PriorityDot priority={task.priority} />
        </div>

        {/* Action buttons */}
        <div className="relative flex items-center gap-1">
          <button
            type="button"
            onClick={() => togglePopover('date')}
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded transition-colors',
              activePopover === 'date'
                ? 'bg-[var(--accent-blue)]/10 text-[var(--accent-blue)]'
                : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
            )}
            title="Schedule"
          >
            <Calendar className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => togglePopover('label')}
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded transition-colors',
              activePopover === 'label'
                ? 'bg-[var(--accent-blue)]/10 text-[var(--accent-blue)]'
                : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
            )}
            title="Labels"
          >
            <Tag className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => togglePopover('subtasks')}
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded transition-colors',
              activePopover === 'subtasks'
                ? 'bg-[var(--accent-blue)]/10 text-[var(--accent-blue)]'
                : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
            )}
            title="Subtasks"
          >
            <ListChecks className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => togglePopover('reminder')}
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded transition-colors',
              activePopover === 'reminder'
                ? 'bg-[var(--accent-blue)]/10 text-[var(--accent-blue)]'
                : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
            )}
            title="Reminders"
          >
            <Bell className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => togglePopover('attachment')}
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded transition-colors',
              activePopover === 'attachment' || (task.attachments?.length ?? 0) > 0
                ? 'bg-[var(--accent-blue)]/10 text-[var(--accent-blue)]'
                : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
            )}
            title="Attachments"
          >
            <Paperclip className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => togglePopover('project')}
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded transition-colors',
              activePopover === 'project'
                ? 'bg-[var(--accent-blue)]/10 text-[var(--accent-blue)]'
                : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
            )}
            title="Move to project"
          >
            <FolderOpen className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              deleteTask.mutate(task.id)
              collapseAll()
            }}
            className="flex h-6 w-6 items-center justify-center rounded text-[var(--text-secondary)] transition-colors hover:bg-accent-red/10 hover:text-accent-red"
            title="Delete task (Ctrl+Backspace)"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>

          {/* Popovers */}
          {activePopover === 'date' && (
            <DatePickerPopover
              currentDate={task.due_date}
              onDateChange={handleDateChange}
              onClose={() => setActivePopover(null)}
              repeatAfter={task.repeat_after ?? 0}
              repeatMode={task.repeat_mode ?? 0}
              onRecurrenceChange={handleRecurrenceChange}
            />
          )}
          {activePopover === 'label' && (
            <LabelPickerPopover
              taskId={task.id}
              currentLabels={labels}
              onClose={() => setActivePopover(null)}
            />
          )}
          {activePopover === 'project' && (
            <ProjectPickerPopover
              task={task}
              onClose={() => setActivePopover(null)}
            />
          )}
          {activePopover === 'reminder' && (
            <ReminderPickerPopover
              task={task}
              onReminderChange={handleReminderChange}
              onClose={() => setActivePopover(null)}
            />
          )}
          {activePopover === 'attachment' && (
            <AttachmentPickerPopover
              taskId={task.id}
              onClose={() => setActivePopover(null)}
            />
          )}
        </div>
      </div>
    </div>
  )
}
