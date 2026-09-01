import { useState, useRef, useEffect, Fragment } from 'react'
import { SortableContext } from '@dnd-kit/sortable'
import { useDroppable, useDndContext } from '@dnd-kit/core'
import { cn } from '@/lib/cn'
import { verticalListSortingStrategyForeignSafe } from '@/lib/sortable-strategy'
import { useReorderStore } from '@/stores/reorder-store'
import { useSelectionStore } from '@/stores/selection-store'
import type { Task, Project } from '@/lib/vikunja-types'
import { TaskRow } from './TaskRow'
import { SectionHeader } from './SectionHeader'
import { AddTaskButton } from './AddTaskButton'
import type { SectionData } from '@/hooks/use-project-sections'
import { AddSectionButton } from './AddSectionButton'
import { NewTaskComposer } from './NewTaskComposer'

interface InsertIndicator {
  containerId: string
  index: number
}

interface SectionGroupProps {
  project: Project
  tasks: Task[]
  viewId: number | undefined
  siblings: Project[]
  insertIndicator?: InsertIndicator | null
  childSections?: SectionData[]
  depth?: number
}

export function SectionGroup({
  project,
  tasks,
  viewId,
  siblings,
  insertIndicator,
  childSections = [],
  depth = 0,
}: SectionGroupProps) {
  const insertIndex =
    insertIndicator?.containerId === String(project.id) ? insertIndicator.index : undefined
  const [isAdding, setIsAdding] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const creationRef = useRef<HTMLDivElement>(null)
  const pendingTaskClickRef = useRef<number | null>(null)
  const setSectionReorderContext = useReorderStore((s) => s.setSectionReorderContext)
  const setExpandedTask = useSelectionStore((s) => s.setExpandedTask)
  const setFocusedTask = useSelectionStore((s) => s.setFocusedTask)
  const { active } = useDndContext()
  const activeType = (active?.data.current as Record<string, unknown> | undefined)?.type as
    | string
    | undefined
  const isDraggingTask = !!active && activeType === 'task'

  const { setNodeRef: setBottomDropRef } = useDroppable({
    id: `section-bottom-${project.id}`,
    data: { type: 'section-bottom', projectId: project.id, taskCount: tasks.length },
  })

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

  // While the new-task UI is open, record which task row the user mousedowns on
  // so we can open it after blur — see the matching effect in TaskList for why.
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

  return (
    // Child sections render inside this div, so paddingLeft accumulates with
    // nesting. Each level only adds a constant step (a depth-scaled value would
    // compound quadratically); top-level sections sit flush with the project.
    <div style={{ paddingLeft: depth === 0 ? 0 : 16 }}>
      <SectionHeader
        project={project}
        siblings={siblings}
        onAddTask={() => setIsAdding(true)}
      />

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

      <div ref={setBottomDropRef} className={cn(isDraggingTask ? 'h-3' : 'h-0')} />

      {!isAdding && (
        <AddTaskButton onClick={() => setIsAdding(true)} />
      )}

      {isAdding && (
        <div ref={creationRef}>
          <NewTaskComposer
            projectId={project.id}
            inputRef={inputRef}
            onCancel={() => setIsAdding(false)}
            onCreated={() => inputRef.current?.focus()}
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
      )}

      {childSections.length > 0 && (
        <SortableContext
          items={childSections.map((c) => `section-${c.project.id}`)}
          strategy={verticalListSortingStrategyForeignSafe}
        >
          {childSections.map((child) => (
            <SectionGroup
              key={child.project.id}
              project={child.project}
              tasks={child.tasks}
              viewId={child.viewId}
              siblings={childSections.map((c) => c.project)}
              childSections={child.children}
              depth={depth + 1}
              insertIndicator={insertIndicator}
            />
          ))}
        </SortableContext>
      )}

      <AddSectionButton parentProjectId={project.id} />
    </div>
  )
}
