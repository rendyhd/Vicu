import { useState, useRef, useEffect, useCallback, Fragment } from 'react'
import { Plus, Inbox } from 'lucide-react'
import { SortableContext } from '@dnd-kit/sortable'
import { useQueryClient } from '@tanstack/react-query'
import { cn } from '@/lib/cn'
import { verticalListSortingStrategyForeignSafe } from '@/lib/sortable-strategy'
import { useCreateTask, useCompleteTask, useUpdateTask, useDeleteTask } from '@/hooks/use-task-mutations'
import { useSelectionStore } from '@/stores/selection-store'
import { orderedTaskIds, resolveSelectedTasks, copySelectedTitles, isTaskNestedInCurrentList } from '@/lib/task-selection'
import { confirmDelete } from '@/lib/confirm-bridge'
import type { Task } from '@/lib/vikunja-types'
import { TaskRow } from './TaskRow'
import { AddTaskButton } from './AddTaskButton'
import { EmptyState } from '@/components/shared/EmptyState'
import { NewTaskComposer } from './NewTaskComposer'
import { taskDescendants, unfinishedDescendants } from '@/lib/task-hierarchy'
import { confirmTaskCompletion } from '@/lib/task-completion'

interface TaskListProps {
  title: string
  tasks: Task[]
  projectId?: number
  emptyTitle?: string
  emptySubtitle?: string
  showNewTask?: boolean
  sortable?: boolean
  viewId?: number
  className?: string
  children?: React.ReactNode
  insertIndex?: number
  /** When set, new tasks get this due date by default. Shown as a dismissible chip. */
  defaultDueDate?: Date
  /** Content rendered inside the scroll area above the task input (e.g. date subtitle) */
  headerContent?: React.ReactNode
  onTaskCreated?: (task: Task) => void
}

export function TaskList({
  title,
  tasks,
  projectId,
  emptyTitle = 'No tasks',
  emptySubtitle,
  showNewTask = true,
  sortable = false,
  viewId,
  className,
  children,
  insertIndex,
  defaultDueDate,
  headerContent,
  onTaskCreated,
}: TaskListProps) {
  const [isAdding, setIsAdding] = useState(false)
  const [addPosition, setAddPosition] = useState<'top' | 'bottom'>('top')
  const inputRef = useRef<HTMLInputElement>(null)
  const creationRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const pendingTaskClickRef = useRef<number | null>(null)
  const createTask = useCreateTask()
  const completeTask = useCompleteTask()
  const updateTask = useUpdateTask()
  const deleteTask = useDeleteTask()
  const qc = useQueryClient()
  // Narrow selectors: focusedTaskId drives the scroll-into-view effect, so it
  // stays a subscription; expandedTaskId/selectedTaskIds are only read inside
  // the keyboard handler and are fetched there via getState().
  const focusedTaskId = useSelectionStore((s) => s.focusedTaskId)
  const setFocusedTask = useSelectionStore((s) => s.setFocusedTask)
  const setExpandedTask = useSelectionStore((s) => s.setExpandedTask)
  const toggleExpandedTask = useSelectionStore((s) => s.toggleExpandedTask)
  const collapseAll = useSelectionStore((s) => s.collapseAll)
  const setSelectedRange = useSelectionStore((s) => s.setSelectedRange)
  const clearSelection = useSelectionStore((s) => s.clearSelection)

  useEffect(() => {
    if (isAdding && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isAdding])

  // While the new-task UI is open, record which task row the user mousedowns on.
  // Mousedown fires before the input's blur, which is the only signal we have
  // before the layout shifts from removing the input — by the time the click
  // event fires, the cursor is no longer over the intended row.
  useEffect(() => {
    if (!isAdding) {
      pendingTaskClickRef.current = null
      return
    }
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target
      if (!(target instanceof Node)) return
      if (creationRef.current?.contains(target)) {
        pendingTaskClickRef.current = null
        return
      }
      const el = target instanceof HTMLElement ? target : null
      const taskEl = el?.closest('[data-task-id]') as HTMLElement | null
      if (!taskEl) {
        pendingTaskClickRef.current = null
        return
      }
      const id = Number(taskEl.getAttribute('data-task-id'))
      pendingTaskClickRef.current = Number.isNaN(id) ? null : id
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [isAdding])

  // Click on whitespace (title area or empty space) collapses expanded task
  const handleContainerClick = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement
      // Only collapse if the click is directly on the container (whitespace)
      if (target === e.currentTarget) {
        collapseAll()
        setFocusedTask(null)
        clearSelection()
      }
    },
    [collapseAll, setFocusedTask, clearSelection]
  )

  const handleHeaderClick = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement
      // Collapse if clicking the header area but not buttons
      if (target.closest('button')) return
      collapseAll()
      setFocusedTask(null)
      clearSelection()
    },
    [collapseAll, setFocusedTask, clearSelection]
  )

  const handleScrollAreaClick = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement
      // Only collapse when clicking the scroll container itself (empty space below tasks)
      if (target === e.currentTarget) {
        collapseAll()
        setFocusedTask(null)
        clearSelection()
      }
    },
    [collapseAll, setFocusedTask, clearSelection]
  )

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Don't handle if focus is in an input/textarea/contentEditable (let the field handle it)
      const active = document.activeElement as HTMLElement | null
      const tag = active?.tagName.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return
      if (active?.isContentEditable) return

      // Handler wants current-at-keypress values — read imperatively instead
      // of subscribing the whole list to selection/expansion changes.
      const { expandedTaskId, selectedTaskIds } = useSelectionStore.getState()

      const taskCount = tasks.length

      // --- Multi-selection shortcuts (work even when this list's own `tasks`
      // prop is empty, e.g. a project whose tasks all live in sections) ---

      // Ctrl+A / ⌘A: select all visible rows (DOM order spans parent + sections)
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault()
        setSelectedRange(orderedTaskIds())
        setExpandedTask(null)
        return
      }

      // Ctrl+C / ⌘C: copy selected titles, one per line. Only hijack when there
      // IS a selection; otherwise let native copy run.
      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        if (selectedTaskIds.size > 0) {
          e.preventDefault()
          void copySelectedTitles(qc, selectedTaskIds)
        }
        return
      }

      // Escape clears an active multi-selection first.
      if (e.key === 'Escape' && selectedTaskIds.size > 0) {
        e.preventDefault()
        clearSelection()
        return
      }

      // Ctrl+K / ⌘K with a multi-selection: complete every selected task.
      if ((e.ctrlKey || e.metaKey) && e.key === 'k' && selectedTaskIds.size > 0) {
        e.preventDefault()
        const targets = resolveSelectedTasks(qc, selectedTaskIds).filter((task) => !task.done)
        const descendantCount = new Set(
          targets.flatMap((task) => unfinishedDescendants(task).map((child) => child.id)),
        ).size
        void (async () => {
          if (descendantCount > 0) {
            const ok = await confirmDelete(
              `Complete ${targets.length} ${targets.length === 1 ? 'task' : 'tasks'} and ${descendantCount} unfinished ${descendantCount === 1 ? 'subtask' : 'subtasks'}?`,
              { force: true, confirmLabel: 'Complete all', destructive: false },
            )
            if (!ok) return
          }
          targets.forEach((task) => completeTask.mutate(
            isTaskNestedInCurrentList(task)
              ? { task, suppressTopLevelUndo: true }
              : task,
          ))
          clearSelection()
        })()
        return
      }

      // Delete / Backspace with a multi-selection: delete all (single confirm).
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedTaskIds.size > 0) {
        e.preventDefault()
        const targets = resolveSelectedTasks(qc, selectedTaskIds)
        if (targets.length === 0) return
        if (targets.some((task) => taskDescendants(task).length > 0)) {
          void confirmDelete(
            'This selection includes a parent task. Open that parent to choose whether its subtasks should be deleted or kept.',
            { force: true, confirmLabel: 'Close', destructive: false },
          )
          return
        }
        const message =
          targets.length > 1
            ? `Delete ${targets.length} tasks? This cannot be undone.`
            : 'Delete this task? This cannot be undone.'
        void confirmDelete(message).then((ok) => {
          if (!ok) return
          targets.forEach((t) => deleteTask.mutate({ task: t }))
          clearSelection()
        })
        return
      }

      // Ctrl+N / ⌘N: New task
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault()
        if (showNewTask && projectId) {
          setAddPosition('top')
          setIsAdding(true)
        }
        return
      }

      // Ctrl+V / ⌘V: New task from clipboard
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        e.preventDefault()
        if (!projectId) return
        navigator.clipboard.readText().then((text) => {
          const trimmed = text.trim()
          if (trimmed) {
            createTask.mutate({ projectId, task: { title: trimmed } })
          }
        })
        return
      }

      if (taskCount === 0) return

      const currentIndex = focusedTaskId
        ? tasks.findIndex((t) => t.id === focusedTaskId)
        : -1

      // Arrow Up
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        if (expandedTaskId) return // don't navigate while editing
        const newIndex = currentIndex <= 0 ? 0 : currentIndex - 1
        setFocusedTask(tasks[newIndex].id)
        return
      }

      // Arrow Down
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        if (expandedTaskId) return // don't navigate while editing
        const newIndex = currentIndex >= taskCount - 1 ? taskCount - 1 : currentIndex + 1
        setFocusedTask(tasks[newIndex].id)
        return
      }

      // Enter: expand focused task
      if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        if (focusedTaskId && !expandedTaskId) {
          toggleExpandedTask(focusedTaskId)
        }
        return
      }

      // Escape: collapse expanded, or clear focus
      if (e.key === 'Escape') {
        e.preventDefault()
        if (expandedTaskId) {
          collapseAll()
        } else {
          setFocusedTask(null)
        }
        return
      }

      // Ctrl+K / ⌘K: complete focused/expanded task
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        const targetId = expandedTaskId || focusedTaskId
        if (!targetId) return
        const task = tasks.find((t) => t.id === targetId)
          ?? resolveSelectedTasks(qc, new Set([targetId]))[0]
        if (task && !task.done) {
          void confirmTaskCompletion(task).then((ok) => {
            if (!ok) return
            completeTask.mutate(
              isTaskNestedInCurrentList(task)
                ? { task, suppressTopLevelUndo: true }
                : task,
            )
            collapseAll()
            // Move focus to the next top-level task; nested rows simply clear focus.
            const idx = tasks.findIndex((item) => item.id === targetId)
            if (idx >= 0 && idx < taskCount - 1) {
              setFocusedTask(tasks[idx + 1].id)
            } else if (idx > 0) {
              setFocusedTask(tasks[idx - 1].id)
            } else {
              setFocusedTask(null)
            }
          })
        }
        return
      }


      // Ctrl+T / ⌘T or "!" : set due date to today
      if (((e.ctrlKey || e.metaKey) && e.key === 't') || (!e.ctrlKey && !e.altKey && !e.metaKey && e.key === '!')) {
        e.preventDefault()
        const targetId = expandedTaskId || focusedTaskId
        if (!targetId) return
        const task = tasks.find((t) => t.id === targetId)
        if (task) {
          const today = new Date()
          today.setHours(0, 0, 0, 0)
          updateTask.mutate({ id: task.id, task: { ...task, due_date: today.toISOString() } })
        }
        return
      }

      // Ctrl+Enter / ⌘Enter: save and collapse
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        if (expandedTaskId) {
          collapseAll()
        }
        return
      }
    },
    [
      tasks,
      focusedTaskId,
      projectId,
      showNewTask,
      createTask,
      completeTask,
      updateTask,
      deleteTask,
      setFocusedTask,
      toggleExpandedTask,
      collapseAll,
      setIsAdding,
      qc,
      setSelectedRange,
      setExpandedTask,
      clearSelection,
    ]
  )

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  // Scroll focused task into view
  useEffect(() => {
    if (!focusedTaskId || !listRef.current) return
    const el = listRef.current.querySelector(`[data-task-id="${focusedTaskId}"]`)
    if (el) {
      el.scrollIntoView({ block: 'nearest' })
    }
  }, [focusedTaskId])

  const taskInputElement = (
    <div ref={creationRef}>
      <NewTaskComposer
        projectId={projectId!}
        defaultDueDate={defaultDueDate}
        inputRef={inputRef}
        onCancel={() => setIsAdding(false)}
        onCreated={(task) => {
          inputRef.current?.focus()
          onTaskCreated?.(task)
        }}
        onBlurOutside={() => {
        const pendingTaskId = pendingTaskClickRef.current
        pendingTaskClickRef.current = null
        if (pendingTaskId !== null) {
          setTimeout(() => {
            setExpandedTask(pendingTaskId)
            setFocusedTask(pendingTaskId)
          }, 0)
        }
        }}
      />
    </div>
  )

  return (
    <div className={cn('flex h-full flex-col', className)} onClick={handleContainerClick}>
      <div
        className="flex items-center justify-between px-6 pb-2 pt-6"
        onClick={handleHeaderClick}
      >
        <h1 className="text-xl font-bold text-[var(--text-primary)]">{title}</h1>
        {showNewTask && projectId && (
          <button
            type="button"
            onClick={() => {
              setAddPosition('top')
              setIsAdding(true)
            }}
            className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--accent-blue)]"
            aria-label="New task"
          >
            <Plus className="h-4 w-4" />
          </button>
        )}
      </div>

      <div
        ref={listRef}
        className="flex-1 overflow-y-auto"
        onClick={handleScrollAreaClick}
      >
        {headerContent}

        {isAdding && addPosition === 'top' && taskInputElement}

        {tasks.length === 0 && !isAdding && !children ? (
          <EmptyState icon={Inbox} title={emptyTitle} subtitle={emptySubtitle} />
        ) : sortable ? (
          <SortableContext
            items={tasks.map((t) => `task-${t.id}`)}
            strategy={verticalListSortingStrategyForeignSafe}
          >
            {tasks.map((task, i) => (
              <Fragment key={task.id}>
                {insertIndex === i && (
                  <div className="mx-4 flex items-center gap-1 py-0.5">
                    <div className="h-1.5 w-1.5 rounded-full bg-[var(--accent-blue)]" />
                    <div className="h-[2px] flex-1 rounded-full bg-[var(--accent-blue)]" />
                  </div>
                )}
                <TaskRow task={task} sortable />
              </Fragment>
            ))}
            {insertIndex != null && insertIndex >= tasks.length && (
              <div className="mx-4 flex items-center gap-1 py-0.5">
                <div className="h-1.5 w-1.5 rounded-full bg-[var(--accent-blue)]" />
                <div className="h-[2px] flex-1 rounded-full bg-[var(--accent-blue)]" />
              </div>
            )}
          </SortableContext>
        ) : (
          tasks.map((task) => <TaskRow key={task.id} task={task} />)
        )}

        {isAdding && addPosition === 'bottom' && taskInputElement}

        {showNewTask && projectId && !isAdding && (
          <AddTaskButton
            onClick={() => {
              setAddPosition('bottom')
              setIsAdding(true)
            }}
          />
        )}

        {children}
      </div>
    </div>
  )
}
