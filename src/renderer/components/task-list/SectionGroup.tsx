import { useState, useRef, useEffect, useMemo, Fragment } from 'react'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useReorderStore } from '@/stores/reorder-store'
import { useCreateTask, useAddLabel } from '@/hooks/use-task-mutations'
import { useTaskParser } from '@/hooks/use-task-parser'
import { useProjects } from '@/hooks/use-projects'
import { useLabels } from '@/hooks/use-labels'
import { recurrenceToVikunja } from '@/lib/task-parser'
import type { Task, Project, CreateTaskPayload } from '@/lib/vikunja-types'
import { TaskRow } from './TaskRow'
import { SectionHeader } from './SectionHeader'
import { TaskInputParser } from '@/components/task-input/TaskInputParser'

interface SectionGroupProps {
  project: Project
  tasks: Task[]
  viewId: number | undefined
  siblings: Project[]
  insertIndex?: number
}

export function SectionGroup({ project, tasks, viewId, siblings, insertIndex }: SectionGroupProps) {
  const [isAdding, setIsAdding] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const creationRef = useRef<HTMLDivElement>(null)
  const parser = useTaskParser()
  const createTask = useCreateTask()
  const addLabel = useAddLabel()
  const { data: allLabels } = useLabels()
  const { data: projectData } = useProjects()
  const projectItems = useMemo(() => (projectData?.flat ?? []).map((p) => ({ id: p.id, title: p.title })), [projectData])
  const labelItems = useMemo(() => (allLabels ?? []).map((l) => ({ id: l.id, title: l.title })), [allLabels])
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

  const handleSubmit = () => {
    let trimmed = parser.inputValue.trim()
    if (!trimmed) {
      setIsAdding(false)
      parser.reset()
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
          return
        }
        payload.title = trimmed
        const today = new Date()
        today.setHours(23, 59, 59, 0)
        payload.due_date = today.toISOString()
      }
    }

    createTask.mutate(
      { projectId: project.id, task: payload },
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
          parser.reset()
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
        <div ref={creationRef} className="border-b border-[var(--border-color)]">
          <div className="flex items-start gap-3 px-4 pt-2.5">
            <div className="mt-[7px] h-[18px] w-[18px] shrink-0 rounded-full border border-[var(--border-color)]" />
            <TaskInputParser
              value={parser.inputValue}
              onChange={parser.setInputValue}
              onSubmit={handleSubmit}
              onCancel={() => {
                setIsAdding(false)
                parser.reset()
              }}
              parseResult={parser.parseResult}
              parserConfig={parser.parserConfig}
              onSuppressType={parser.suppressType}
              prefixes={parser.prefixes}
              enabled={parser.enabled}
              projects={projectItems}
              labels={labelItems}
              inputRef={inputRef}
              placeholder="New Task"
              onBlur={(e) => {
                if (creationRef.current?.contains(e.relatedTarget as Node)) return
                handleSubmit()
              }}
              showBangTodayHint={!parser.enabled && !!parser.parserConfig.bangToday}
              className="flex-1"
            />
          </div>
        </div>
      )}
    </div>
  )
}
