import { forwardRef, memo, useState, useRef, useEffect, useCallback, useImperativeHandle, useMemo } from 'react'
import { ListChecks, Bell, Repeat, Paperclip, AlignLeft, ChevronRight } from 'lucide-react'
import type { Editor } from '@tiptap/react'
import { useDraggable } from '@dnd-kit/core'
import { useSortable, defaultAnimateLayoutChanges } from '@dnd-kit/sortable'
import type { AnimateLayoutChanges } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { cn } from '@/lib/cn'
import { useSelectionStore } from '@/stores/selection-store'
import { orderedTaskIds } from '@/lib/task-selection'
import { useUpdateTask, useCompleteTask, useDeleteTask, useUploadAttachmentFromDrop, useAddLabel, useCreateLabel } from '@/hooks/use-task-mutations'
import { useCompletionHoldEngagement } from '@/hooks/use-completion-hold'
import { useConfirmDelete } from '@/hooks/use-confirm-delete'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { dueToday, parsedDue } from '@/lib/due-dates'
import { labelChipStyle } from '@/lib/label-style'
import { normalizeHex } from '@/lib/constants'
import { checklistLabel, rowLabels, rowProjectSource } from '@/lib/row-anatomy'
import { useIsDark } from '@/hooks/use-is-dark'
import type { Task, TaskReminder } from '@/lib/vikunja-types'
import { TaskCheckbox } from './TaskCheckbox'
import { TaskCardBar, type CardPopover } from './TaskCardBar'
import { TaskDueBadge } from './TaskDueBadge'
import { useRowView } from './RowViewContext'
import { PriorityMark } from '@/components/shared/PriorityMark'
import { SubtaskList } from './SubtaskList'
import { TaskDescription } from './TaskDescription'
import { TaskContextMenu } from './TaskContextMenu'
import { TaskLinkIcon } from '@/components/TaskLinkIcon'
import { TaskSyncIcon } from '@/components/task-list/TaskSyncIcon'
import { stripNoteLink, stripPageLink, extractNoteLinkHtml, extractPageLinkHtml, hasNotesContent } from '@/lib/note-link'
import { useTaskParser } from '@/hooks/use-task-parser'
import { useLabels } from '@/hooks/use-labels'
import { useProjects } from '@/hooks/use-projects'
import { extractBangToday, recurrenceToVikunja } from '@/lib/task-parser'
import { TaskInputParser } from '@/components/task-input/TaskInputParser'
import { useAppConfig } from '@/hooks/use-app-config'
import {
  parentTitle,
  subtaskProgress,
  taskDescendants,
} from '@/lib/task-hierarchy'
import { confirmTaskCompletion } from '@/lib/task-completion'


interface TaskRowProps {
  task: Task
  sortable?: boolean
  nestedDepth?: number
  parentProjectId?: number
  /**
   * Set by a list view when the task is alone in its project group (no group header): the project
   * goes on the row's meta line, unless the view is that project (`RowViewContext`).
   */
  projectMeta?: { title: string; color?: string }
}

/** `projectMeta` is a new object on every render of a group, so compare it by value to keep memo useful. */
function sameRowProps(a: TaskRowProps, b: TaskRowProps): boolean {
  return (
    a.task === b.task &&
    a.sortable === b.sortable &&
    a.nestedDepth === b.nestedDepth &&
    a.parentProjectId === b.parentProjectId &&
    a.projectMeta?.title === b.projectMeta?.title &&
    a.projectMeta?.color === b.projectMeta?.color
  )
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

/**
 * What a row takes from drag and drop, whichever hook provided it. The hooks' `attributes` (role
 * "button", tabindex, aria-pressed) are left out on purpose: they made a row a button that holds
 * buttons, and no keyboard sensor is registered, so they only added noise. Only the pointer starts a drag.
 */
interface DragBehavior {
  listeners: ReturnType<typeof useDraggable>['listeners']
  setNodeRef: (node: HTMLElement | null) => void
  isDragging: boolean
  style: React.CSSProperties
}

const NO_STYLE: React.CSSProperties = {}

// A row registers with the drag context once (D-REN-5): `useSortable` (a draggable and a droppable in
// one) where the list reorders, `useDraggable` everywhere else. A row used to call both hooks on one
// id and keep the unused one disabled, which registered every row twice.
function useSortableRow(task: Task): DragBehavior {
  const sortableHook = useSortable({
    id: `task-${task.id}`,
    data: { type: 'task', task, sortable: true },
    animateLayoutChanges: sortableAnimateLayoutChanges,
  })
  return {
    listeners: sortableHook.listeners,
    setNodeRef: sortableHook.setNodeRef,
    isDragging: sortableHook.isDragging,
    style: {
      transform: CSS.Transform.toString(sortableHook.transform),
      transition: sortableHook.transition,
    },
  }
}

function useDraggableRow(task: Task): DragBehavior {
  const draggable = useDraggable({
    id: `task-${task.id}`,
    data: { type: 'task', task },
  })
  return {
    listeners: draggable.listeners,
    setNodeRef: draggable.setNodeRef,
    isDragging: draggable.isDragging,
    style: NO_STYLE,
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
            // A parsed time ("tomorrow at 3pm") is kept; a bare date is date-only.
            changes.due_date = parsedDue(parsed.dueDate, parsed.dueHasTime)
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
          changes.due_date = dueToday()
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

/** The project on a row's meta line: its colour dot and name. */
function RowProject({ title, color }: { title: string; color?: string }) {
  return (
    <span className="flex min-w-0 shrink items-center gap-1">
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: normalizeHex(color) ?? 'var(--text-tertiary)' }}
      />
      <span className="truncate">{title}</span>
    </span>
  )
}

/** The project of a row in a list that mixes projects without headers (Search, custom lists). */
function RowProjectLookup({ projectId }: { projectId: number }) {
  const { data } = useProjects()
  const project = data?.flat.find((candidate) => candidate.id === projectId)
  return project ? <RowProject title={project.title} color={project.hex_color} /> : null
}

function TaskRowInner({ task, nestedDepth = 0, parentProjectId, projectMeta, drag }: Omit<TaskRowProps, 'sortable'> & { drag: DragBehavior }) {
  // Per-field subscriptions: each row re-renders only when *its own* derived
  // state flips, not on every focus/selection change anywhere in the list.
  const isExpanded = useSelectionStore((s) => s.expandedTaskId === task.id)
  const isFocused = useSelectionStore((s) => s.focusedTaskId === task.id)
  const isSelected = useSelectionStore((s) => s.selectedTaskIds.has(task.id))
  // Main asked for this task to be shown (a clicked reminder): expand once the row is on screen.
  const isOpenRequested = useSelectionStore((s) => s.pendingOpenTaskId === task.id)
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
  const { data: appConfig } = useAppConfig()
  const rowView = useRowView()
  // Pointer and keyboard focus on the row keep a completed row in its list (the completion hold).
  const holdEngagement = useCompletionHoldEngagement(task.id)

  const { listeners, setNodeRef, isDragging, style } = drag
  const isDark = useIsDark()

  const [editDescription, setEditDescription] = useState(stripPageLink(stripNoteLink(task.description)))
  const [isDragOver, setIsDragOver] = useState(false)
  const [dropError, setDropError] = useState<string | null>(null)
  const noteLinkHtml = extractNoteLinkHtml(task.description) + extractPageLinkHtml(task.description)
  const directSubtasks = task.related_tasks?.subtask ?? []
  const progress = subtaskProgress(task)
  const subtaskCount = progress.total
  const canExpandSubtasks = appConfig?.subtask_display === 'expandable' && directSubtasks.length > 0
  const [subtasksExpanded, setSubtasksExpanded] = useState(false)
  const [structuralDeleteOpen, setStructuralDeleteOpen] = useState(false)
  const [activePopover, setActivePopover] = useState<CardPopover>(null)
  // The toolbar buttons that open the pickers: each picker sits next to its button and gives
  // focus back to it when it closes.
  const headerAttachmentButtonRef = useRef<HTMLButtonElement>(null)
  const attachmentInvokers = useMemo(() => [headerAttachmentButtonRef], [])
  useEffect(() => {
    if (isOpenRequested) useSelectionStore.getState().openRequestedTask(task.id)
  }, [isOpenRequested, task.id])
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
      updateTask.mutate({ id: task.id, changes, original: task })
    }
  }, [editDescription, noteLinkHtml, task, updateTask])

  const handleSave = useCallback(() => {
    if (!titleEditorRef.current?.save()) {
      saveTaskChanges()
    }
  }, [saveTaskChanges])

  const handleDateChange = useCallback(
    (isoDate: string) => {
      updateTask.mutate({ id: task.id, changes: { due_date: isoDate }, original: task })
    },
    [task, updateTask]
  )

  const handleReminderChange = useCallback(
    (reminders: TaskReminder[]) => {
      updateTask.mutate({ id: task.id, changes: { reminders }, original: task })
    },
    [task, updateTask]
  )

  const handleRecurrenceChange = useCallback(
    (repeat_after: number, repeat_mode: number) => {
      updateTask.mutate({ id: task.id, changes: { repeat_after, repeat_mode }, original: task })
    },
    [task, updateTask]
  )

  const handlePriorityChange = useCallback(
    (priority: number) => {
      updateTask.mutate({ id: task.id, changes: { priority }, original: task })
    },
    [task, updateTask]
  )

  const setDateToToday = useCallback(() => {
    updateTask.mutate({ id: task.id, changes: { due_date: dueToday() }, original: task })
  }, [task, updateTask])

  const togglePopover = (popover: Exclude<CardPopover, null>) => {
    setActivePopover((prev) => (prev === popover ? null : popover))
  }

  // Handle keyboard shortcuts inside expanded task inputs
  const handleExpandedKeyDown = useCallback(
    async (e: React.KeyboardEvent) => {
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
          if (await confirmTaskCompletion(task)) {
            completeTask.mutate(nestedDepth > 0 ? { task, suppressTopLevelUndo: true } : task)
            collapseAll()
          }
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
  const metaLabels = rowLabels(labels, rowView)
  const projectSource = rowProjectSource(task.project_id, rowView, projectMeta !== undefined)
  const isRepeating = (task.repeat_after ?? 0) > 0 || (task.repeat_mode ?? 0) > 0
  const hasMeta =
    projectSource !== 'none' ||
    metaLabels.length > 0 ||
    subtaskCount > 0 ||
    isRepeating ||
    hasNotesContent(task.description) ||
    (task.attachments?.length ?? 0) > 0 ||
    (nestedDepth === 0 && !!parentTitle(task)) ||
    (nestedDepth > 0 && parentProjectId !== undefined && parentProjectId !== task.project_id)

  // Collapsed row — entire row is draggable (PointerSensor distance:8 distinguishes click vs drag)
  if (!isExpanded) {
    return (
      <>
      <div
        ref={setNodeRef}
        data-task-id={task.id}
        role="listitem"
        // Roving tabindex: the row the keyboard selection is on is the one Tab stop of the list.
        tabIndex={isFocused ? 0 : -1}
        onFocus={(e) => {
          // Keyboard focus anywhere in the row (the row itself, its checkbox) moves the keyboard selection here.
          if (!isFocused && e.target.matches(':focus-visible')) setFocusedTask(task.id)
          holdEngagement.onFocus(e)
        }}
        onBlur={holdEngagement.onBlur}
        onPointerEnter={holdEngagement.onPointerEnter}
        onPointerLeave={holdEngagement.onPointerLeave}
        className={cn(
          'vicu-task-fade group grid cursor-default grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 border-b border-[var(--border-color)] px-4 py-2.5 transition-colors hover:bg-[var(--bg-hover)]',
          isSelected && 'bg-bg-selected ring-1 ring-inset ring-accent-blue/40',
          isFocused && !isSelected && !isExpanded && 'bg-accent-blue/8 ring-1 ring-inset ring-accent-blue/30',
          isDragging && 'opacity-30',
          isDragOver && 'ring-2 ring-inset ring-[var(--accent-blue)] bg-accent-blue/5',
          dropError && 'ring-2 ring-inset ring-danger bg-danger/5'
        )}
        style={{
          ...style,
          paddingLeft: `${16 + nestedDepth * 20}px`,
        }}
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
      >
        <TaskCheckbox task={task} suppressTopLevelUndo={nestedDepth > 0} />

        {/* Line 1 is the title, level with the checkbox; line 2 is the meta line, when there is one. */}
        <div className="min-w-0">
          <span
            className={cn(
              'block truncate text-task-title',
              task.done ? 'text-text-secondary line-through' : 'text-text'
            )}
          >
            {dropError ? <span className="text-danger">{dropError}</span> : task.title}
          </span>
          {hasMeta && (
            <div className="mt-0.5 flex min-w-0 items-center gap-x-2 overflow-hidden whitespace-nowrap text-meta text-text-secondary">
              {projectSource === 'group' && projectMeta && (
                <RowProject title={projectMeta.title} color={projectMeta.color} />
              )}
              {projectSource === 'lookup' && <RowProjectLookup projectId={task.project_id} />}
              {metaLabels.map((l) => (
                <span
                  key={l.id}
                  className="shrink-0 rounded-chip px-2 py-px text-chip leading-tight"
                  style={labelChipStyle(l.hex_color, isDark)}
                >
                  {l.title}
                </span>
              ))}
              {nestedDepth === 0 && parentTitle(task) && (
                <span className="min-w-0 truncate">Subtask of {parentTitle(task)}</span>
              )}
              {nestedDepth > 0 && parentProjectId !== undefined && parentProjectId !== task.project_id && (
                <span className="shrink-0">Different project</span>
              )}
              {subtaskCount > 0 && (
                <button
                  type="button"
                  disabled={!canExpandSubtasks}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (canExpandSubtasks) setSubtasksExpanded((expanded) => !expanded)
                  }}
                  className={cn(
                    'flex min-h-6 shrink-0 items-center justify-center gap-0.5',
                    canExpandSubtasks && 'rounded-control px-0.5 hover:bg-bg-hover hover:text-text',
                  )}
                  aria-label={`${checklistLabel(progress.completed, progress.total)} subtasks complete`}
                  aria-expanded={canExpandSubtasks ? subtasksExpanded : undefined}
                >
                  {canExpandSubtasks && (
                    <ChevronRight className={cn('h-3 w-3 transition-transform duration-fade-fast', subtasksExpanded && 'rotate-90')} />
                  )}
                  <ListChecks className="h-3 w-3" />
                  <span>{checklistLabel(progress.completed, progress.total)}</span>
                </button>
              )}
              {hasNotesContent(task.description) && (
                <AlignLeft className="h-3 w-3 shrink-0" aria-label="Has notes" />
              )}
              {isRepeating && <Repeat className="h-3 w-3 shrink-0" aria-label="Repeats" />}
              {(task.attachments?.length ?? 0) > 0 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleExpandedTask(task.id)
                    setActivePopover('attachment')
                  }}
                  className="relative shrink-0 after:absolute after:-inset-1.5 after:content-[''] hover:text-text"
                  aria-label="Attachments"
                >
                  <Paperclip className="h-3 w-3" />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Trailing cluster, level with the title: the due phrase, the reminder bell, the priority last. */}
        <div className="flex h-5 shrink-0 items-center gap-2">
          <TaskSyncIcon taskId={task.id} />
          <TaskLinkIcon description={task.description} />
          <TaskDueBadge dueDate={task.due_date} />
          {(task.reminders?.length ?? 0) > 0 && (
            <Bell className="h-3 w-3 text-text-secondary" aria-label="Has a reminder" />
          )}
          <PriorityMark priority={task.priority} />
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
      {canExpandSubtasks && subtasksExpanded && directSubtasks.map((child) => (
        <TaskRow
          key={child.id}
          task={child}
          sortable={false}
          nestedDepth={nestedDepth + 1}
          parentProjectId={task.project_id}
        />
      ))}
      </>
    )
  }

  // Expanded card — pop-out style
  return (
    <div
      data-task-id={task.id}
      role="listitem"
      className={cn(
        // Two columns, the checkbox and the body: the notes, subtasks and property bar sit under the title.
        // The surface is bg.card; in dark it is lifted by a 1 px white-at-8% edge instead of a shadow.
        'vicu-task-fade vicu-card mx-2 my-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 rounded-card border border-[var(--border-color)] bg-bg-card px-4 shadow-md dark:border-white/8 dark:shadow-none',
        isDragOver && 'ring-2 ring-[var(--accent-blue)] bg-accent-blue/5',
        dropError && 'ring-2 ring-danger bg-danger/5'
      )}
      onKeyDown={handleExpandedKeyDown}
      onFocus={holdEngagement.onFocus}
      onBlur={holdEngagement.onBlur}
      onPointerEnter={holdEngagement.onPointerEnter}
      onPointerLeave={holdEngagement.onPointerLeave}
      onDragOver={handleFileDragOver}
      onDragLeave={handleFileDragLeave}
      onDrop={handleFileDrop}
    >
      {/* Title row */}
      <TaskCheckbox task={task} className="mt-3.5" suppressTopLevelUndo={nestedDepth > 0} />
      <div className="flex min-w-0 items-start gap-3 pt-3">
        <TaskTitleEditor
          ref={titleEditorRef}
          task={task}
          onSave={saveTaskChanges}
          onSubmit={() => descEditorRef.current?.commands.focus('end')}
          onCancel={collapseAll}
        />
        <TaskSyncIcon taskId={task.id} />
        <TaskLinkIcon description={task.description} />
        {(task.attachments?.length ?? 0) > 0 && (
          <button
            ref={headerAttachmentButtonRef}
            type="button"
            aria-haspopup="dialog"
            aria-expanded={activePopover === 'attachment'}
            onClick={() => togglePopover('attachment')}
            className="relative shrink-0 text-[var(--text-secondary)] after:absolute after:-inset-1.5 after:content-['']"
            title="Attachments"
          >
            <Paperclip className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Description */}
      <div className="col-start-2 pt-2">
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
            setEditDescription(normalized)
          }}
          editorRef={descEditorRef}
          placeholder="Notes"
        />
      </div>

      {/* Existing subtasks stay visible; the action button toggles the add input. */}
      <div className="col-start-2">
        <SubtaskList parentTask={task} showInput={activePopover === 'subtasks'} />
      </div>

      {/* Properties: chips for what is set, quiet "+" buttons for what is not; Info and Delete under More. */}
      <TaskCardBar
        task={task}
        active={activePopover}
        onToggle={togglePopover}
        onOpen={setActivePopover}
        onClose={() => setActivePopover(null)}
        attachmentInvokers={attachmentInvokers}
        onDateChange={handleDateChange}
        onRecurrenceChange={handleRecurrenceChange}
        onPriorityChange={handlePriorityChange}
        onReminderChange={handleReminderChange}
        onProjectChange={(pid) => updateTask.mutate({ id: task.id, changes: { project_id: pid }, original: task })}
        onDelete={async () => {
          setActivePopover(null)
          if (taskDescendants(task).length > 0) {
            setStructuralDeleteOpen(true)
            return
          }
          const ok = await confirmDelete('Delete this task? This cannot be undone.')
          if (ok) {
            deleteTask.mutate({ task })
            collapseAll()
          }
        }}
      />
      <div className="col-span-2">
      <ConfirmDialog {...dialogProps} />
      <ConfirmDialog
        open={structuralDeleteOpen}
        message={`This task has ${taskDescendants(task).length} ${taskDescendants(task).length === 1 ? 'subtask' : 'subtasks'}. Delete them too, or keep them as standalone tasks?`}
        confirmLabel="Delete all"
        onConfirm={() => {
          setStructuralDeleteOpen(false)
          deleteTask.mutate({ task, deleteSubtasks: true })
          collapseAll()
        }}
        secondaryLabel="Keep subtasks"
        onSecondary={() => {
          setStructuralDeleteOpen(false)
          deleteTask.mutate({ task, deleteSubtasks: false })
          collapseAll()
        }}
        onCancel={() => setStructuralDeleteOpen(false)}
      />
      </div>
    </div>
  )
}

const SortableTaskRow = memo(function SortableTaskRow(props: TaskRowProps) {
  const drag = useSortableRow(props.task)
  return <TaskRowInner task={props.task} nestedDepth={props.nestedDepth} parentProjectId={props.parentProjectId} projectMeta={props.projectMeta} drag={drag} />
}, sameRowProps)

const DraggableTaskRow = memo(function DraggableTaskRow(props: TaskRowProps) {
  const drag = useDraggableRow(props.task)
  return <TaskRowInner task={props.task} nestedDepth={props.nestedDepth} parentProjectId={props.parentProjectId} projectMeta={props.projectMeta} drag={drag} />
}, sameRowProps)

export const TaskRow = memo(function TaskRow(props: TaskRowProps) {
  // `sortable` is fixed by the list a row belongs to, so a row never switches between the two.
  return props.sortable ? <SortableTaskRow {...props} /> : <DraggableTaskRow {...props} />
}, sameRowProps)
