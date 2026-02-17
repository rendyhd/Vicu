import { useEffect, useState } from 'react'
import { useParams } from '@tanstack/react-router'
import { useDndMonitor } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useProjectTasks } from '@/hooks/use-project-tasks'
import { useProjectSections } from '@/hooks/use-project-sections'
import { useProjects } from '@/hooks/use-projects'
import { useReorderStore } from '@/stores/reorder-store'
import type { Task, Project } from '@/lib/vikunja-types'
import { TaskList } from '@/components/task-list/TaskList'
import { SectionGroup } from '@/components/task-list/SectionGroup'
import { AddSectionButton } from '@/components/task-list/AddSectionButton'
import { ParentDropZone } from '@/components/task-list/ParentDropZone'

interface InsertIndicator {
  containerId: string // 'parent' or section project ID as string
  index: number
}

export function ProjectView() {
  const { projectId } = useParams({ from: '/project/$projectId' })
  const pid = Number(projectId)
  const { data: projectData } = useProjects()
  const projectName = projectData?.flat.find((p) => p.id === pid)?.title ?? 'Project'

  const { data: tasks = [], isLoading: tasksLoading, viewId } = useProjectTasks(pid)
  const { sections, hasSections, isLoading: sectionsLoading } = useProjectSections(pid)
  const setReorderContext = useReorderStore((s) => s.setReorderContext)
  const clearSectionContexts = useReorderStore((s) => s.clearSectionContexts)

  const [insertIndicator, setInsertIndicator] = useState<InsertIndicator | null>(null)

  useEffect(() => {
    setReorderContext(viewId ?? null, tasks)
    return () => clearSectionContexts()
  }, [viewId, tasks, setReorderContext, clearSectionContexts])

  // Track cross-container drag hover for visual insertion line
  useDndMonitor({
    onDragOver(event) {
      const { active, over } = event
      if (!over || !active) {
        setInsertIndicator(null)
        return
      }

      const activeData = active.data.current as Record<string, unknown>
      if (activeData?.type !== 'task') {
        setInsertIndicator(null)
        return
      }

      const draggedTask = activeData.task as Task
      const overId = String(over.id)
      const overData = over.data.current as Record<string, unknown>

      // Determine which container the over target belongs to and the insert index
      let overContainerId: string | null = null
      let overIndex = 0

      if (overData?.type === 'section') {
        // Hovering over a section header — insert at top of that section
        const project = overData.project as Project
        overContainerId = String(project.id)
        overIndex = 0
      } else if (overData?.type === 'parent-project') {
        overContainerId = 'parent'
        overIndex = tasks.length
      } else if (overId.startsWith('task-')) {
        const targetTaskId = Number(overId.replace('task-', ''))
        // Check parent tasks
        const parentIdx = tasks.findIndex((t) => t.id === targetTaskId)
        if (parentIdx !== -1) {
          overContainerId = 'parent'
          overIndex = parentIdx
        } else {
          // Check section tasks
          for (const section of sections) {
            const sIdx = section.tasks.findIndex((t) => t.id === targetTaskId)
            if (sIdx !== -1) {
              overContainerId = String(section.project.id)
              overIndex = sIdx
              break
            }
          }
        }
      }

      if (!overContainerId) {
        setInsertIndicator(null)
        return
      }

      // Find which container the dragged task is in
      let dragContainerId: string | null = null
      if (tasks.some((t) => t.id === draggedTask.id)) {
        dragContainerId = 'parent'
      } else {
        for (const section of sections) {
          if (section.tasks.some((t) => t.id === draggedTask.id)) {
            dragContainerId = String(section.project.id)
            break
          }
        }
      }

      // Only show insertion line for cross-container drags
      // Within the same container, @dnd-kit sortable handles the visual displacement
      if (dragContainerId === overContainerId) {
        setInsertIndicator(null)
        return
      }

      setInsertIndicator({ containerId: overContainerId, index: overIndex })
    },
    onDragEnd() {
      setInsertIndicator(null)
    },
    onDragCancel() {
      setInsertIndicator(null)
    },
  })

  const isLoading = tasksLoading || sectionsLoading

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-[var(--text-secondary)]">
        Loading...
      </div>
    )
  }

  const sectionProjects = sections.map((s) => s.project)
  const parentInsertIndex =
    insertIndicator?.containerId === 'parent' ? insertIndicator.index : undefined

  return (
    <TaskList
      title={projectName}
      tasks={tasks}
      projectId={pid}
      sortable
      viewId={viewId}
      emptyTitle="No tasks in this project"
      emptySubtitle="Create a new task to get started"
      insertIndex={parentInsertIndex}
    >
      <div className="px-2">
        {hasSections && <ParentDropZone projectId={pid} />}
        {hasSections && (
          <SortableContext
            items={sectionProjects.map((p) => `section-${p.id}`)}
            strategy={verticalListSortingStrategy}
          >
            {sections.map((section) => (
              <SectionGroup
                key={section.project.id}
                project={section.project}
                tasks={section.tasks}
                viewId={section.viewId}
                siblings={sectionProjects}
                insertIndex={
                  insertIndicator?.containerId === String(section.project.id)
                    ? insertIndicator.index
                    : undefined
                }
              />
            ))}
          </SortableContext>
        )}
        <AddSectionButton parentProjectId={pid} />
      </div>
    </TaskList>
  )
}
