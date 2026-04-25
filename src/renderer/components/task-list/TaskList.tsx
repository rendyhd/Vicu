import { useState, useRef, useEffect, useCallback, useMemo, Fragment } from 'react'
import { Plus, Inbox } from 'lucide-react'
import { SortableContext } from '@dnd-kit/sortable'
import { cn } from '@/lib/cn'
import { verticalListSortingStrategyForeignSafe } from '@/lib/sortable-strategy'
import { useCreateTask, useCompleteTask, useUpdateTask, useDeleteTask, useAddLabel, useCreateLabel, useUploadAttachmentFromPaste } from '@/hooks/use-task-mutations'
import { useSelectionStore } from '@/stores/selection-store'
import { useTaskParser } from '@/hooks/use-task-parser'
import { useLabels } from '@/hooks/use-labels'
import { useProjects } from '@/hooks/use-projects'
import { recurrenceToVikunja } from '@/lib/task-parser'
import type { Task, CreateTaskPayload } from '@/lib/vikunja-types'
import { TaskRow } from './TaskRow'
import { TaskInputParser } from '@/components/task-input/TaskInputParser'
import { EmptyState } from '@/components/shared/EmptyState'
import type { ChipData } from '@/components/task-input/TokenChip'
import { TaskDescription, type PendingImage } from './TaskDescription'
import { replacePendingTokens } from '@/lib/image-tokens'

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
}: TaskListProps) {
  const [isAdding, setIsAdding] = useState(false)
  const [showNotes, setShowNotes] = useState(false)
  const [defaultDateDismissed, setDefaultDateDismissed] = useState(false)
  const [newDescription, setNewDescription] = useState('')
  const [pendingImages, setPendingImages] = useState<Record<string, PendingImage>>({})
  const inputRef = useRef<HTMLInputElement>(null)
  const creationRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const parser = useTaskParser()
  const { data: allLabels } = useLabels()
  const { data: projectData } = useProjects()
  const projectItems = useMemo(() => (projectData?.flat ?? []).map((p) => ({ id: p.id, title: p.title })), [projectData])
  const labelItems = useMemo(() => (allLabels ?? []).map((l) => ({ id: l.id, title: l.title })), [allLabels])
  const createTask = useCreateTask()
  const addLabel = useAddLabel()
  const createLabel = useCreateLabel()
  const completeTask = useCompleteTask()
  const updateTask = useUpdateTask()
  const deleteTask = useDeleteTask()
  const uploadFromPaste = useUploadAttachmentFromPaste()
  const {
    expandedTaskId,
    focusedTaskId,
    setFocusedTask,
    setExpandedTask,
    toggleExpandedTask,
    collapseAll,
  } = useSelectionStore()

  // Build context chips (e.g. "Today" default on Today view)
  const hasNlpDate = parser.parseResult?.dueDate != null
  const contextChips = useMemo<ChipData[]>(() => {
    if (!defaultDueDate || defaultDateDismissed || hasNlpDate) return []
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const target = new Date(defaultDueDate.getFullYear(), defaultDueDate.getMonth(), defaultDueDate.getDate())
    const diffDays = Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    let label: string
    if (diffDays === 0) label = 'Today'
    else if (diffDays === 1) label = 'Tomorrow'
    else label = target.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    return [{ type: 'date' as const, label, key: 'context-date' }]
  }, [defaultDueDate, defaultDateDismissed, hasNlpDate])

  useEffect(() => {
    if (isAdding && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isAdding])

  const handleSubmit = () => {
    let trimmed = parser.inputValue.trim()
    if (!trimmed || !projectId) {
      setIsAdding(false)
      parser.reset()
      setNewDescription('')
      Object.values(pendingImages).forEach((p) => URL.revokeObjectURL(p.blobUrl))
      setPendingImages({})
      setShowNotes(false)
      return
    }

    const payload: CreateTaskPayload = { title: trimmed }
    let parsedLabels: string[] = []

    if (parser.parserConfig.enabled && parser.parseResult) {
      const pr = parser.parseResult
      const title = pr.title.trim()
      if (!title) {
        setIsAdding(false)
        parser.reset()
        setNewDescription('')
        Object.values(pendingImages).forEach((p) => URL.revokeObjectURL(p.blobUrl))
        setPendingImages({})
        setShowNotes(false)
        return
      }
      payload.title = title

      if (pr.dueDate) {
        const d = new Date(pr.dueDate.getTime())
        d.setHours(23, 59, 59, 0)
        payload.due_date = d.toISOString()
      }

      if (pr.priority !== null && pr.priority > 0) {
        payload.priority = pr.priority
      }

      if (pr.recurrence) {
        const vik = recurrenceToVikunja(pr.recurrence)
        payload.repeat_after = vik.repeat_after
        payload.repeat_mode = vik.repeat_mode
      }

      parsedLabels = pr.labels
    } else {
      // Legacy ! → today behavior
      if (parser.parserConfig.bangToday && trimmed.includes('!')) {
        trimmed = trimmed.replace(/!/g, '').trim()
        if (!trimmed) {
          setIsAdding(false)
          parser.reset()
          setNewDescription('')
          Object.values(pendingImages).forEach((p) => URL.revokeObjectURL(p.blobUrl))
          setPendingImages({})
          setShowNotes(false)
          return
        }
        payload.title = trimmed
        const today = new Date()
        today.setHours(23, 59, 59, 0)
        payload.due_date = today.toISOString()
      }
    }

    // Apply context default due date if no date was parsed/set and it wasn't dismissed
    if (!payload.due_date && defaultDueDate && !defaultDateDismissed) {
      const d = new Date(defaultDueDate.getTime())
      d.setHours(23, 59, 59, 0)
      payload.due_date = d.toISOString()
    }

    const desc = newDescription.trim()
    if (desc) {
      payload.description = desc
    }
    const snapshotDesc = desc
    const snapshotPending = pendingImages

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
              } else {
                createLabel.mutate(
                  { title: labelName },
                  {
                    onSuccess: (newLabel) => {
                      addLabel.mutate({ taskId, labelId: newLabel.id })
                    },
                  }
                )
              }
            }
          }

          // Upload any images that were pasted before the task had an ID.
          const stagedEntries = Object.entries(snapshotPending)
          if (stagedEntries.length > 0 && data && typeof data === 'object' && 'id' in data) {
            const newTaskId = (data as Task).id
            ;(async () => {
              const mapping: Record<string, number> = {}
              for (const [uuid, img] of stagedEntries) {
                try {
                  const result = await uploadFromPaste.mutateAsync({
                    taskId: newTaskId,
                    fileData: img.bytes,
                    fileName: img.name,
                    mimeType: img.mime,
                  })
                  mapping[uuid] = result.attachmentId
                } catch {
                  // Leave pending token in place; user can retry by editing.
                }
                URL.revokeObjectURL(img.blobUrl)
              }
              if (Object.keys(mapping).length > 0) {
                const patched = replacePendingTokens(snapshotDesc, mapping)
                if (patched !== snapshotDesc) {
                  updateTask.mutate({
                    id: newTaskId,
                    task: { ...(data as Task), description: patched },
                  })
                }
              }
            })()
          }

          parser.reset()
          setNewDescription('')
          setPendingImages({})
          setShowNotes(false)
          setDefaultDateDismissed(false)
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
      // Don't handle if focus is in an input/textarea/contentEditable (let the field handle it)
      const active = document.activeElement as HTMLElement | null
      const tag = active?.tagName.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return
      if (active?.isContentEditable) return

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

  const taskInputElement = (
    <div
      ref={creationRef}
      className="border-b border-[var(--border-color)]"
      onBlur={(e) => {
        if (creationRef.current?.contains(e.relatedTarget as Node)) return
        handleSubmit()
      }}
    >
      <div className="flex items-start gap-3 px-4 py-2.5">
        <div className="mt-[7px] h-[18px] w-[18px] shrink-0 rounded-full border border-[var(--border-color)]" />
        <TaskInputParser
          value={parser.inputValue}
          onChange={parser.setInputValue}
          onSubmit={handleSubmit}
          onCancel={() => {
            setIsAdding(false)
            parser.reset()
            setNewDescription('')
            Object.values(pendingImages).forEach((p) => URL.revokeObjectURL(p.blobUrl))
            setPendingImages({})
            setShowNotes(false)
            setDefaultDateDismissed(false)
          }}
          onTab={() => setShowNotes(true)}
          parseResult={parser.parseResult}
          parserConfig={parser.parserConfig}
          onSuppressType={parser.suppressType}
          prefixes={parser.prefixes}
          enabled={parser.enabled}
          projects={projectItems}
          labels={labelItems}
          inputRef={inputRef}
          placeholder="New Task"
          showBangTodayHint={!parser.enabled && !!parser.parserConfig.bangToday}
          className="flex-1"
          contextChips={contextChips}
          onDismissContextChip={() => setDefaultDateDismissed(true)}
        />
      </div>
      {showNotes && (
        <div className="pb-2 pl-[46px] pr-4">
          <TaskDescription
            value={newDescription}
            onChange={setNewDescription}
            onStagePending={(img) => setPendingImages((prev) => ({ ...prev, [img.uuid]: img }))}
            onRemovePending={(uuid) =>
              setPendingImages((prev) => {
                const entry = prev[uuid]
                if (entry) URL.revokeObjectURL(entry.blobUrl)
                const { [uuid]: _removed, ...rest } = prev
                return rest
              })
            }
            pendingImages={pendingImages}
            placeholder="Notes"
            autoFocus
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
          />
        </div>
      )}
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
        {headerContent}

        {isAdding && taskInputElement}

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

        {children}
      </div>
    </div>
  )
}
