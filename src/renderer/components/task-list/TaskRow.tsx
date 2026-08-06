import { forwardRef, memo, useState, useRef, useEffect, useCallback, useImperativeHandle, useMemo } from 'react'
import { Calendar, Tag, ListChecks, FolderOpen, Trash2, Bell, Repeat, Paperclip, Info, Flag, AlignLeft } from 'lucide-react'
import type { Editor } from '@tiptap/react'
import { useDraggable } from '@dnd-kit/core'
import { useSortable, defaultAnimateLayoutChanges } from '@dnd-kit/sortable'
import type { AnimateLayoutChanges } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { cn } from '@/lib/cn'
import { useSelectionStore } from '@/stores/selection-store'
import { orderedTaskIds } from '@/lib/task-selection'
import { useUpdateTask, useCompleteTask, useDeleteTask, useUploadAttachmentFromDrop, useAddLabel, useCreateLabel } from '@/hooks/use-task-mutations'
import { useConfirmDelete } from '@/hooks/use-confirm-delete'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { isNullDate } from '@/lib/date-utils'
import { normalizeHex } from '@/lib/constants'
import type { Task, TaskReminder } from '@/lib/vikunja-types'
import { TaskCheckbox } from './TaskCheckbox'
import { TaskDueBadge } from './TaskDueBadge'
import { PriorityDot } from '@/components/shared/PriorityDot'
import { DatePickerPopover } from './DatePickerPopover'
import { LabelPickerPopover } from './LabelPickerPopover'
import { SubtaskList } from './SubtaskList'
import { TaskDescription } from './TaskDescription'
import { ProjectPickerPopover } from './ProjectPickerPopover'
import { ReminderPickerPopover } from './ReminderPickerPopover'
import { AttachmentPickerPopover } from './AttachmentPickerPopover'
import { PriorityPickerPopover } from './PriorityPickerPopover'
import { TaskContextMenu } from './TaskContextMenu'
import { InfoPopover } from './InfoPopover'
import { TaskLinkIcon } from '@/components/TaskLinkIcon'
import { stripNoteLink, stripPageLink, extractNoteLinkHtml, extractPageLinkHtml, hasNotesContent } from '@/lib/note-link'
import { formatRecurrenceLabel } from '@/lib/recurrence'
import { RichTextEditor } from '@/components/rich-text/RichTextEditor'
import { useTaskParser } from '@/hooks/use-task-parser'
import { useLabels } from '@/hooks/use-labels'
import { useProjects } from '@/hooks/use-projects'
import { extractBangToday, recurrenceToVikunja } from '@/lib/task-parser'
import { TaskInputParser } from '@/components/task-input/TaskInputParser'

type PopoverType = 'date' | 'label' | 'project' | 'subtasks' | 'reminder' | 'attachment' | 'info' | 'priority' | null

function getLabelStyle(rawHex: string | undefined): React.CSSProperties {
  const hex = normalizeHex(rawHex)
  if (!hex) return { backgroundColor: 'var(--bg-hover)', color: 'var(--text-secondary)' }
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const isDark = document.documentElement.classList.contains('dark')
  if (isDark) {
    const lr = Math.min(255, r + Math.round((255 - r) * 0.45))
    const lg = Math.min(255, g + Math.round((255 - g) * 0.45))
    const lb = Math.min(255, b + Math.round((255 - b) * 0.45))
    return {
      backgroundColor: `rgba(${r}, ${g}, ${b}, 0.12)`,
      color: `rgb(${lr}, ${lg}, ${lb})`,
    }
  }
  return { backgroundColor: `rgba(${r}, ${g}, ${b}, 0.12)`, color: hex }
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

interface TaskTitleEditorHandle {
  save: () => boolean
}

interface TaskTitleEditorProps {
  task: Task
  onSave: (changes: Partial<Task>) => void
  onSubmit: () => void
  onCancel: () => void
}

const TaskTitleEditor = forwardRef<TaskTitleEditorHandle, TaskTitleEditorProps>(
  function TaskTitleEditor({ task, onSave, onSubmit, onCancel }, ref) {
    const addLabel = useAddLabel()
    const createLabel = useCreateLabel()
    const parser = useTaskParser()
    const { data: allLabels } = useLabels()
    const { data: projectData } = useProjects()
    const projectItems = useMemo(
      () => (projectData?.flat ?? []).map((project) => ({ id: project.id, title: project.title })),
      [projectData],
    )
    const labelItems = useMemo(
      () => (allLabels ?? []).map((label) => ({ id: label.id, title: label.title })),
      [allLabels],
    )
    const [title, setTitle] = useState(task.title)
    const [isDirty, setIsDirty] = useState(false)
    const inputRef = useRef<HTMLTextAreaElement>(null)
    const dirtyRef = useRef(false)

    useEffect(() => {
      setTitle(task.title)
      parser.setInputValue(task.title)
      dirtyRef.current = false
      setIsDirty(false)
    }, [task.title, parser.setInputValue])

    useEffect(() => {
      inputRef.current?.focus()
    }, [])

    useEffect(() => {
      const input = inputRef.current
      if (!input) return
      input.style.height = 'auto'
      input.style.height = `${input.scrollHeight}px`
    }, [title])

    const save = useCallback(() => {
      if (!dirtyRef.current) return false

      const changes: Partial<Task> = {}
      let nextTitle = title.trim()
      let parsedLabels: string[] = []

      if (parser.parserConfig.enabled && parser.parseResult) {
        const parsed = parser.parseResult
        nextTitle = parsed.title.trim()

        if (nextTitle) {
          if (parsed.dueDate) {
            const dueDate = new Date(parsed.dueDate.getTime())
            dueDate.setHours(23, 59, 59, 0)
            changes.due_date = dueDate.toISOString()
          }
          if (parsed.priority !== null && parsed.priority > 0) {
            changes.priority = parsed.priority
          }
          if (parsed.recurrence) {
            const recurrence = recurrenceToVikunja(parsed.recurrence)
            changes.repeat_after = recurrence.repeat_after
            changes.repeat_mode = recurrence.repeat_mode
          }
          if (parsed.project) {
            const projectName = parsed.project.toLowerCase()
            const project = projectData?.flat.find(
              (candidate) => candidate.title.toLowerCase() === projectName,
            )
            if (project) changes.project_id = project.id
          }
          parsedLabels = parsed.labels
        }
      } else if (parser.parserConfig.bangToday) {
        const bang = extractBangToday(nextTitle)
        if (bang.dueDate) {
          nextTitle = bang.title.trim()
          const dueDate = new Date(bang.dueDate.getTime())
          dueDate.setHours(23, 59, 59, 0)
          changes.due_date = dueDate.toISOString()
        }
      }

      // Never replace a valid task title with an input made entirely of tokens.
      if (!nextTitle) return false

      if (nextTitle !== task.title) changes.title = nextTitle
      setTitle(nextTitle)
      parser.setInputValue(nextTitle)
      dirtyRef.current = false
      setIsDirty(false)

      onSave(changes)

      if (parsedLabels.length > 0) {
        const existingLabels = new Set(
          (task.labels ?? []).map((label) => label.title.toLowerCase()),
        )
        for (const labelName of new Set(parsedLabels)) {
          if (existingLabels.has(labelName.toLowerCase())) continue
          const label = allLabels?.find(
            (candidate) => candidate.title.toLowerCase() === labelName.toLowerCase(),
          )
          if (label) {
            addLabel.mutate({ taskId: task.id, labelId: label.id })
          } else {
            createLabel.mutate(
              { title: labelName },
              {
                onSuccess: (newLabel) => {
                  addLabel.mutate({ taskId: task.id, labelId: newLabel.id })
                },
              },
            )
          }
        }
      }
      return true
    }, [
      title,
      task,
      onSave,
      parser.parserConfig,
      parser.parseResult,
      parser.setInputValue,
      projectData,
      allLabels,
      addLabel,
      createLabel,
    ])

    useImperativeHandle(ref, () => ({ save }), [save])

    return (
      <div
        className="min-w-0 flex-1"
        onBlur={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node)) return
          save()
        }}
      >
        <TaskInputParser
          value={title}
          onChange={(value) => {
            setTitle(value)
            parser.setInputValue(value)
            dirtyRef.current = true
            setIsDirty(true)
          }}
          onSubmit={() => {
            save()
            onSubmit()
          }}
          onCancel={() => {
            save()
            onCancel()
          }}
          parseResult={isDirty ? parser.parseResult : null}
          parserConfig={parser.parserConfig}
          onSuppressType={parser.suppressType}
          prefixes={parser.prefixes}
          enabled={parser.enabled && isDirty}
          projects={projectItems}
          labels={labelItems}
          inputRef={inputRef}
          placeholder="Task title"
          showBangTodayHint={isDirty && !parser.enabled && !!parser.parserConfig.bangToday}
          inputClassName="font-medium leading-snug"
          multiline
        />
      </div>
    )
  },
)

function TaskRowInner({ task, sortable = false }: TaskRowProps) {
  // Per-field subscriptions: each row re-renders only when *its own* derived
  // state flips, not on every focus/selection change anywhere in the list.
  const isExpanded = useSelectionStore((s) => s.expandedTaskId === task.id)
  const isFocused = useSelectionStore((s) => s.focusedTaskId === task.id)
  const isSelected = useSelectionStore((s) => s.selectedTaskIds.has(task.id))
  const toggleExpandedTask = useSelectionStore((s) => s.toggleExpandedTask)
  const setFocusedTask = useSelectionStore((s) => s.setFocusedTask)
  const setExpandedTask = useSelectionStore((s) => s.setExpandedTask)
  const collapseAll = useSelectionStore((s) => s.collapseAll)
  const toggleSelected = useSelectionStore((s) => s.toggleSelected)
  const selectOnly = useSelectionStore((s) => s.selectOnly)
  const setSelectedRange = useSelectionStore((s) => s.setSelectedRange)
  const clearSelection = useSelectionStore((s) => s.clearSelection)
  const updateTask = useUpdateTask()
  const completeTask = useCompleteTask()
  const deleteTask = useDeleteTask()
  const { confirmDelete, dialogProps } = useConfirmDelete()
  const uploadFromDrop = useUploadAttachmentFromDrop()

  const { attributes, listeners, setNodeRef, isDragging, style } = useDragBehavior(task, sortable)

  const [editDescription, setEditDescription] = useState(stripPageLink(stripNoteLink(task.description)))
  const [isDragOver, setIsDragOver] = useState(false)
  const [dropError, setDropError] = useState<string | null>(null)
  const noteLinkHtml = extractNoteLinkHtml(task.description) + extractPageLinkHtml(task.description)
  const subtaskCount = task.related_tasks?.subtask?.length ?? 0
  const [activePopover, setActivePopover] = useState<PopoverType>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const titleEditorRef = useRef<TaskTitleEditorHandle>(null)
  const descEditorRef = useRef<Editor | null>(null)
  const descBaselineRef = useRef<string | null>(null)

  // Flash red border briefly when drag-drop upload fails, show error message
  useEffect(() => {
    if (uploadFromDrop.isError) {
      setDropError(uploadFromDrop.error?.message || 'Upload failed')
      const timer = setTimeout(() => setDropError(null), 4000)
      return () => clearTimeout(timer)
    }
  }, [uploadFromDrop.isError, uploadFromDrop.failureCount, uploadFromDrop.error])

  useEffect(() => {
    setEditDescription(stripPageLink(stripNoteLink(task.description)))
  }, [task.description])

  const saveTaskChanges = useCallback((titleChanges: Partial<Task> = {}) => {
    const changes: Partial<Task> = { ...titleChanges }
    // Only diff against the TipTap-normalized baseline, not the raw server value —
    // opening a task shouldn't trigger a save just because TipTap re-serializes whitespace.
    const baseline = descBaselineRef.current
    const descChanged = baseline !== null && editDescription !== baseline
    if (descChanged) {
      const fullDescription = noteLinkHtml
        ? (editDescription ? editDescription + noteLinkHtml : noteLinkHtml)
        : editDescription
      changes.description = fullDescription
      descBaselineRef.current = editDescription
    }
    if (Object.keys(changes).length > 0) {
      updateTask.mutate({ id: task.id, task: { ...task, ...changes } })
    }
  }, [editDescription, noteLinkHtml, task, updateTask])

  const handleSave = useCallback(() => {
    if (!titleEditorRef.current?.save()) {
      saveTaskChanges()
    }
  }, [saveTaskChanges])

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

  const handlePriorityChange = useCallback(
    (priority: number) => {
      updateTask.mutate({ id: task.id, task: { ...task, priority } })
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
      // Ctrl+Enter / ⌘Enter: save and close
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        handleSave()
        collapseAll()
        return
      }
      // Ctrl+K / ⌘K: complete task
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        if (!task.done) {
          handleSave()
          completeTask.mutate(task)
          collapseAll()
        }
        return
      }
      // Ctrl+T / ⌘T: set date to today
      if ((e.ctrlKey || e.metaKey) && e.key === 't') {
        e.preventDefault()
        setDateToToday()
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
      <>
      <div
        ref={setNodeRef}
        data-task-id={task.id}
        className={cn(
          'group flex min-h-10 cursor-default items-center gap-3 border-b border-[var(--border-color)] px-4 py-2 transition-colors hover:bg-[var(--bg-hover)]',
          isSelected && 'bg-[var(--accent-blue)]/15 ring-1 ring-inset ring-[var(--accent-blue)]/40',
          isFocused && !isSelected && !isExpanded && 'bg-[var(--accent-blue)]/8 ring-1 ring-inset ring-[var(--accent-blue)]/30',
          isDragging && 'opacity-30',
          isDragOver && 'ring-2 ring-inset ring-[var(--accent-blue)] bg-[var(--accent-blue)]/5',
          dropError && 'ring-2 ring-inset ring-red-500 bg-red-500/5'
        )}
        style={style}
        onClick={(e) => {
          // Event handlers want current-at-click values — read them
          // imperatively instead of subscribing the row to every change.
          const { selectionAnchorId, selectedTaskIds, focusedTaskId } = useSelectionStore.getState()
          // Cmd/Ctrl-click: toggle this row in the multi-selection (no expand).
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault()
            setExpandedTask(null)
            toggleSelected(task.id)
            setFocusedTask(task.id)
            return
          }
          // Shift-click: select the contiguous visual range from the anchor.
          if (e.shiftKey) {
            e.preventDefault()
            const order = orderedTaskIds()
            const anchor = selectionAnchorId ?? focusedTaskId ?? task.id
            const a = order.indexOf(anchor)
            const b = order.indexOf(task.id)
            if (a === -1 || b === -1) {
              selectOnly(task.id)
            } else {
              const [lo, hi] = a < b ? [a, b] : [b, a]
              setExpandedTask(null)
              setSelectedRange(order.slice(lo, hi + 1))
            }
            setFocusedTask(task.id)
            return
          }
          // Plain click: drop any multi-selection, then focus + expand as before.
          if (selectedTaskIds.size > 0) clearSelection()
          setFocusedTask(task.id)
          toggleExpandedTask(task.id)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') toggleExpandedTask(task.id)
        }}
        onDragOver={handleFileDragOver}
        onDragLeave={handleFileDragLeave}
        onDrop={handleFileDrop}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          const { selectedTaskIds } = useSelectionStore.getState()
          // Right-clicking outside the selection narrows it to just this row.
          if (!selectedTaskIds.has(task.id)) selectOnly(task.id)
          setFocusedTask(task.id)
          setContextMenu({ x: e.clientX, y: e.clientY })
        }}
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
            'min-w-0 flex-1 break-words text-[13px] text-[var(--text-primary)]',
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
          {hasNotesContent(task.description) && (
            <AlignLeft
              className="h-3 w-3 text-[var(--text-secondary)]"
              aria-label="Has notes"
            />
          )}
          {subtaskCount > 0 && (
            <ListChecks
              className="h-3 w-3 text-[var(--text-secondary)]"
              aria-label={`${subtaskCount} ${subtaskCount === 1 ? 'subtask' : 'subtasks'}`}
            />
          )}
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
      {contextMenu && (
        <TaskContextMenu
          fallbackTask={task}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
        />
      )}
      </>
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
      <div className="flex items-start gap-3 px-4 pt-3">
        <TaskCheckbox task={task} className="mt-0.5" />
        <TaskTitleEditor
          ref={titleEditorRef}
          task={task}
          onSave={saveTaskChanges}
          onSubmit={() => descEditorRef.current?.commands.focus('end')}
          onCancel={collapseAll}
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
        <TaskDescription
          taskId={task.id}
          value={editDescription}
          onChange={setEditDescription}
          onBlur={handleSave}
          onKeyDown={(e) => {
            // Escape is the only shortcut that needs handling inside the editor —
            // outer handleExpandedKeyDown catches Ctrl+Enter / Ctrl+K / Ctrl+T via bubbling.
            if (e.key === 'Escape') {
              e.preventDefault()
              handleSave()
              collapseAll()
              return true
            }
            return false
          }}
          onReady={(normalized) => {
            descBaselineRef.current = normalized
          }}
          editorRef={descEditorRef}
          placeholder="Notes"
        />
      </div>

      {/* Existing subtasks stay visible; the action button toggles the add input. */}
      <div className="px-4 pl-[43px]">
        <SubtaskList parentTask={task} showInput={activePopover === 'subtasks'} />
      </div>

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
        <div className="flex items-center gap-1">
          <div className="relative">
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
          </div>
          <div className="relative">
            <button
              type="button"
              onClick={() => togglePopover('priority')}
              className={cn(
                'flex h-6 w-6 items-center justify-center rounded transition-colors',
                activePopover === 'priority'
                  ? 'bg-[var(--accent-blue)]/10 text-[var(--accent-blue)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
              )}
              title="Priority"
            >
              <Flag className="h-3.5 w-3.5" />
            </button>
            {activePopover === 'priority' && (
              <PriorityPickerPopover
                currentPriority={task.priority}
                onPriorityChange={handlePriorityChange}
                onClose={() => setActivePopover(null)}
              />
            )}
          </div>
          <div className="relative">
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
            {activePopover === 'label' && (
              <LabelPickerPopover
                tasks={[task]}
                onClose={() => setActivePopover(null)}
              />
            )}
          </div>
          <button
            type="button"
            onClick={() => togglePopover('subtasks')}
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded transition-colors',
              activePopover === 'subtasks'
                ? 'bg-[var(--accent-blue)]/10 text-[var(--accent-blue)]'
                : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
            )}
            title={activePopover === 'subtasks' ? 'Hide add subtask' : 'Add subtask'}
          >
            <ListChecks className="h-3.5 w-3.5" />
          </button>
          <div className="relative">
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
            {activePopover === 'reminder' && (
              <ReminderPickerPopover
                task={task}
                onReminderChange={handleReminderChange}
                onClose={() => setActivePopover(null)}
              />
            )}
          </div>
          <div className="relative">
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
            {activePopover === 'attachment' && (
              <AttachmentPickerPopover
                taskId={task.id}
                onClose={() => setActivePopover(null)}
              />
            )}
          </div>
          <div className="relative">
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
            {activePopover === 'project' && (
              <ProjectPickerPopover
                currentProjectId={task.project_id}
                onSelect={(pid) => updateTask.mutate({ id: task.id, task: { ...task, project_id: pid } })}
                onClose={() => setActivePopover(null)}
              />
            )}
          </div>
          <div className="relative">
            <button
              type="button"
              onClick={() => togglePopover('info')}
              className={cn(
                'flex h-6 w-6 items-center justify-center rounded transition-colors',
                activePopover === 'info'
                  ? 'bg-[var(--accent-blue)]/10 text-[var(--accent-blue)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
              )}
              title="Task info"
            >
              <Info className="h-3.5 w-3.5" />
            </button>
            {activePopover === 'info' && (
              <InfoPopover
                task={task}
                onClose={() => setActivePopover(null)}
              />
            )}
          </div>
          <button
            type="button"
            onClick={async () => {
              const ok = await confirmDelete('Delete this task? This cannot be undone.')
              if (ok) {
                deleteTask.mutate(task.id)
                collapseAll()
              }
            }}
            className="flex h-6 w-6 items-center justify-center rounded text-[var(--text-secondary)] transition-colors hover:bg-accent-red/10 hover:text-accent-red"
            title="Delete task"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <ConfirmDialog {...dialogProps} />
    </div>
  )
}

export const TaskRow = memo(TaskRowInner)
