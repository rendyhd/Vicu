import { useState, useRef, useEffect, Fragment } from 'react'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useReorderStore } from '@/stores/reorder-store'
import { useCreateTask } from '@/hooks/use-task-mutations'
import { api } from '@/lib/api'
import type { Task, Project, CreateTaskPayload } from '@/lib/vikunja-types'
import { TaskRow } from './TaskRow'
import { SectionHeader } from './SectionHeader'

interface SectionGroupProps {
  project: Project
  tasks: Task[]
  viewId: number | undefined
  siblings: Project[]
  insertIndex?: number
}

export function SectionGroup({ project, tasks, viewId, siblings, insertIndex }: SectionGroupProps) {
  const [isAdding, setIsAdding] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [exclamationToday, setExclamationToday] = useState(true)
  const inputRef = useRef<HTMLInputElement>(null)
  const createTask = useCreateTask()
  const setSectionReorderContext = useReorderStore((s) => s.setSectionReorderContext)

  useEffect(() => {
    if (viewId != null) {
      setSectionReorderContext(project.id, viewId, tasks)
    }
  }, [project.id, viewId, tasks, setSectionReorderContext])

  useEffect(() => {
    if (isAdding && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isAdding])

  useEffect(() => {
    api.getConfig().then((config) => {
      if (config) setExclamationToday(config.exclamation_today !== false)
    })
  }, [])

  const handleSubmit = () => {
    let trimmed = newTitle.trim()
    if (!trimmed) {
      setIsAdding(false)
      setNewTitle('')
      return
    }

    const payload: CreateTaskPayload = { title: trimmed }

    if (exclamationToday && trimmed.includes('!')) {
      trimmed = trimmed.replace(/!/g, '').trim()
      if (!trimmed) {
        setIsAdding(false)
        setNewTitle('')
        return
      }
      payload.title = trimmed
      const today = new Date()
      today.setHours(23, 59, 59, 0)
      payload.due_date = today.toISOString()
    }

    createTask.mutate(
      { projectId: project.id, task: payload },
      {
        onSuccess: () => {
          setNewTitle('')
          inputRef.current?.focus()
        },
      }
    )
  }

  return (
    <div>
      <SectionHeader
        project={project}
        siblings={siblings}
        onAddTask={() => setIsAdding(true)}
      />

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

      {isAdding && (
        <div className="border-b border-[var(--border-color)]">
          <div className="flex h-10 items-center gap-3 px-4">
            <div className="h-[18px] w-[18px] shrink-0 rounded-full border border-[var(--border-color)]" />
            <input
              ref={inputRef}
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSubmit()
                if (e.key === 'Escape') {
                  setIsAdding(false)
                  setNewTitle('')
                }
              }}
              onBlur={handleSubmit}
              placeholder="New Task"
              className="flex-1 bg-transparent text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none"
            />
            {exclamationToday && newTitle.includes('!') && (
              <span className="shrink-0 text-[11px] font-medium text-accent-blue">Today</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
