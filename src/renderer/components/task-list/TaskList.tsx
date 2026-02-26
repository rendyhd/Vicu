import { useState, useRef, useEffect, useCallback, Fragment } from 'react'
import { Plus, Inbox } from 'lucide-react'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { cn } from '@/lib/cn'
import { useCreateTask, useCompleteTask, useUpdateTask, useDeleteTask, useAddLabel } from '@/hooks/use-task-mutations'
import { useSelectionStore } from '@/stores/selection-store'
import { useParserConfig } from '@/hooks/use-parser-config'
import { useLabels } from '@/hooks/use-labels'
import { parse, recurrenceToVikunja } from '@/lib/task-parser'
import type { ParseResult } from '@/lib/task-parser'
import type { Task, CreateTaskPayload } from '@/lib/vikunja-types'
import { TaskRow } from './TaskRow'
import { NlpParsePreview, NlpInputHighlight } from './NlpParsePreview'
import { EmptyState } from '@/components/shared/EmptyState'

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
}: TaskListProps) {
  const [isAdding, setIsAdding] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [showNotes, setShowNotes] = useState(false)
  const [newDescription, setNewDescription] = useState('')
  const [parseResult, setParseResult] = useState<ParseResult | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const descriptionRef = useRef<HTMLTextAreaElement>(null)
  const creationRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const parserConfig = useParserConfig()
  const { data: allLabels } = useLabels()
  const createTask = useCreateTask()
  const addLabel = useAddLabel()
  const completeTask = useCompleteTask()
  const updateTask = useUpdateTask()
  const deleteTask = useDeleteTask()
  const {
    expandedTaskId,
    focusedTaskId,
    setFocusedTask,
    setExpandedTask,
    toggleExpandedTask,
    collapseAll,
  } = useSelectionStore()

  useEffect(() => {
    if (isAdding && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isAdding])

  // Focus notes textarea when expanded
  useEffect(() => {
    if (showNotes && descriptionRef.current) {
      descriptionRef.current.focus()
    }
  }, [showNotes])

  const handleSubmit = () => {
    let trimmed = newTitle.trim()
    if (!trimmed || !projectId) {
      setIsAdding(false)
      setNewTitle('')
      setNewDescription('')
      setShowNotes(false)
      setParseResult(null)
      return
    }

    const payload: CreateTaskPayload = { title: trimmed }
    let parsedLabels: string[] = []

    if (parserConfig.enabled && parseResult) {
      // Use NLP parse result
      const title = parseResult.title.trim()
      if (!title) {
        setIsAdding(false)
        setNewTitle('')
        setNewDescription('')
        setShowNotes(false)
        setParseResult(null)
        return
      }
      payload.title = title

      if (parseResult.dueDate) {
        const d = new Date(parseResult.dueDate.getTime())
        d.setHours(23, 59, 59, 0)
        payload.due_date = d.toISOString()
      }

      if (parseResult.priority !== null && parseResult.priority > 0) {
        payload.priority = parseResult.priority
      }

      if (parseResult.recurrence) {
        const vik = recurrenceToVikunja(parseResult.recurrence)
        payload.repeat_after = vik.repeat_after
        payload.repeat_mode = vik.repeat_mode
      }

      parsedLabels = parseResult.labels
    } else {
      // Legacy ! → today behavior
      if (parserConfig.bangToday && trimmed.includes('!')) {
        trimmed = trimmed.replace(/!/g, '').trim()
        if (!trimmed) {
          setIsAdding(false)
          setNewTitle('')
          setNewDescription('')
          setShowNotes(false)
          setParseResult(null)
          return
        }
        payload.title = trimmed
        const today = new Date()
        today.setHours(23, 59, 59, 0)
        payload.due_date = today.toISOString()
      }
    }

    const desc = newDescription.trim()
    if (desc) {
      payload.description = desc
    }

    createTask.mutate(
      { projectId, task: payload },
      {
        onSuccess: (data) => {
          // Attach labels post-creation
          if (parsedLabels.length > 0 && data && typeof data === 'object' && 'id' in data) {
            const taskId = (data as Task).id
            for (const labelName of parsedLabels) {
              const match = allLabels?.find(
                (l) => l.title.toLowerCase() === labelName.toLowerCase()
              )
              if (match) {
                addLabel.mutate({ taskId, labelId: match.id })
              }
            }
          }
          setNewTitle('')
          setNewDescription('')
          setShowNotes(false)
          setParseResult(null)
          inputRef.current?.focus()
        },
      }
    )
  }

  // Click on whitespace (title area or empty space) collapses expanded task
  const handleContainerClick = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement
      // Only collapse if the click is directly on the container (whitespace)
      if (target === e.currentTarget) {
        collapseAll()
        setFocusedTask(null)
      }
    },
    [collapseAll, setFocusedTask]
  )

  const handleHeaderClick = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement
      // Collapse if clicking the header area but not buttons
      if (target.closest('button')) return
      collapseAll()
      setFocusedTask(null)
    },
    [collapseAll, setFocusedTask]
  )

  const handleScrollAreaClick = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement
      // Only collapse when clicking the scroll container itself (empty space below tasks)
      if (target === e.currentTarget) {
        collapseAll()
        setFocusedTask(null)
      }
    },
    [collapseAll, setFocusedTask]
  )

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Don't handle if focus is in an input/textarea (let the expanded task handle it)
      const active = document.activeElement
      const tag = active?.tagName.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return

      const taskCount = tasks.length

      // Ctrl+N / ⌘N: New task
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault()
        if (showNewTask && projectId) {
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
        if (task && !task.done) {
          completeTask.mutate(task)
          collapseAll()
          // Move focus to next task
          const idx = tasks.findIndex((t) => t.id === targetId)
          if (idx < taskCount - 1) {
            setFocusedTask(tasks[idx + 1].id)
          } else if (idx > 0) {
            setFocusedTask(tasks[idx - 1].id)
          } else {
            setFocusedTask(null)
          }
        }
        return
      }

      // Ctrl+Backspace / ⌘⌫: delete focused task
      if ((e.ctrlKey || e.metaKey) && e.key === 'Backspace') {
        e.preventDefault()
        const targetId = expandedTaskId || focusedTaskId
        if (!targetId) return
        const idx = tasks.findIndex((t) => t.id === targetId)
        deleteTask.mutate(targetId)
        collapseAll()
        if (idx < taskCount - 1) {
          setFocusedTask(tasks[idx + 1].id)
        } else if (idx > 0) {
          setFocusedTask(tasks[idx - 1].id)
        } else {
          setFocusedTask(null)
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
      expandedTaskId,
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
            onClick={() => setIsAdding(true)}
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
        {isAdding && (
          <div ref={creationRef} className="border-b border-[var(--border-color)]">
            <div className="flex h-10 items-center gap-3 px-4">
              <div className="h-[18px] w-[18px] shrink-0 rounded-full border border-[var(--border-color)]" />
              <div className="relative flex-1">
                {parserConfig.enabled && parseResult && (
                  <NlpInputHighlight value={newTitle} tokens={parseResult.tokens} />
                )}
                <input
                  ref={inputRef}
                  type="text"
                  value={newTitle}
                  onChange={(e) => {
                    const val = e.target.value
                    setNewTitle(val)
                    if (parserConfig.enabled && val.trim()) {
                      setParseResult(parse(val, parserConfig))
                    } else {
                      setParseResult(null)
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSubmit()
                    if (e.key === 'Escape') {
                      setIsAdding(false)
                      setNewTitle('')
                      setNewDescription('')
                      setShowNotes(false)
                      setParseResult(null)
                    }
                    if (e.key === 'Tab') {
                      e.preventDefault()
                      setShowNotes(true)
                    }
                  }}
                  onBlur={(e) => {
                    if (creationRef.current?.contains(e.relatedTarget as Node)) return
                    handleSubmit()
                  }}
                  placeholder="New Task"
                  className="relative w-full bg-transparent text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none"
                />
              </div>
              {!parserConfig.enabled && parserConfig.bangToday && newTitle.includes('!') && (
                <span className="shrink-0 text-[11px] font-medium text-accent-blue">Today</span>
              )}
            </div>
            {parserConfig.enabled && parseResult && (
              <NlpParsePreview result={parseResult} />
            )}
            {showNotes && (
              <div className="pb-2 pl-[46px] pr-4">
                <textarea
                  ref={descriptionRef}
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.preventDefault()
                      inputRef.current?.focus()
                    }
                    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                      e.preventDefault()
                      handleSubmit()
                    }
                  }}
                  onBlur={(e) => {
                    if (creationRef.current?.contains(e.relatedTarget as Node)) return
                    handleSubmit()
                  }}
                  placeholder="Notes"
                  rows={3}
                  className="w-full resize-none bg-transparent text-[12px] text-[var(--text-secondary)] placeholder:text-[var(--text-secondary)]/50 focus:outline-none"
                />
              </div>
            )}
          </div>
        )}

        {tasks.length === 0 && !isAdding && !children ? (
          <EmptyState icon={Inbox} title={emptyTitle} subtitle={emptySubtitle} />
        ) : sortable ? (
          <SortableContext
            items={tasks.map((t) => `task-${t.id}`)}
            strategy={verticalListSortingStrategy}
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

        {children}
      </div>
    </div>
  )
}
