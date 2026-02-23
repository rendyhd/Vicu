import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Outlet, useMatches } from '@tanstack/react-router'
import {
  DndContext,
  DragOverlay,
  defaultDropAnimationSideEffects,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { CollisionDetection, DragStartEvent, DragEndEvent } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { useSidebarStore } from '@/stores/sidebar-store'
import { useSelectionStore } from '@/stores/selection-store'
import { useUpdateTask, useReorderTask, useReorderProject, useAddLabel } from '@/hooks/use-task-mutations'
import { useReorderStore } from '@/stores/reorder-store'
import { api } from '@/lib/api'
import { applyTheme } from '@/lib/theme'
import type { ThemeOption } from '@/lib/theme'
import type { Task, Project, CustomList } from '@/lib/vikunja-types'
import type { ProjectTreeNode } from '@/hooks/use-projects'
import { useCompletedTasksStore } from '@/stores/completed-tasks-store'
import { Sidebar } from './Sidebar'
import { ContentArea } from './ContentArea'
import { WindowControls } from './WindowControls'
import { SearchBar } from './SearchBar'
import { SetupView } from '@/views/SetupView'
import { TaskDragOverlay } from '@/components/task-list/TaskDragOverlay'
import { ProjectDragOverlay } from '@/components/sidebar/ProjectDragOverlay'
import { CustomListDragOverlay } from '@/components/sidebar/CustomListDragOverlay'
import { SectionDragOverlay } from '@/components/task-list/SectionDragOverlay'
import { UpdateBanner } from '@/components/UpdateBanner'

const MIN_WIDTH = 180
const MAX_WIDTH = 360

function calculatePosition(tasks: Task[], oldIndex: number, newIndex: number): number {
  const without = tasks.filter((_, i) => i !== oldIndex)
  const targetIdx = newIndex

  const above = without[targetIdx - 1]?.position ?? 0
  const below = without[targetIdx]?.position ?? (above + 2 ** 16)
  return (above + below) / 2
}

function calculateProjectPosition(
  siblings: ProjectTreeNode[],
  oldIndex: number,
  newIndex: number
): number {
  const without = siblings.filter((_, i) => i !== oldIndex)
  const above = without[newIndex - 1]?.position ?? 0
  const below = without[newIndex]?.position ?? (above + 2 ** 16)
  return (above + below) / 2
}

type AppState = 'loading' | 'setup' | 'ready'

type DragItem =
  | { type: 'task'; task: Task }
  | { type: 'project'; node: ProjectTreeNode }
  | { type: 'custom-list'; list: CustomList }
  | { type: 'section'; project: Project; siblings: Project[] }

export function AppShell() {
  const queryClient = useQueryClient()
  const { sidebarWidth, setSidebarWidth } = useSidebarStore()
  const { setExpandedTask } = useSelectionStore()
  const updateTask = useUpdateTask()
  const reorderTask = useReorderTask()
  const reorderProject = useReorderProject()
  const addLabel = useAddLabel()
  const dragging = useRef(false)
  const startX = useRef(0)
  const startWidth = useRef(0)
  const [appState, setAppState] = useState<AppState>('loading')
  const [dragItem, setDragItem] = useState<DragItem | null>(null)
  const themeRef = useRef<ThemeOption>('system')

  // Clear recently-completed-tasks store on route change so completed tasks
  // don't bleed into the next view.
  const routeMatches = useMatches()
  const routePath = routeMatches[routeMatches.length - 1]?.pathname ?? ''
  const prevRouteRef = useRef(routePath)
  useEffect(() => {
    if (prevRouteRef.current !== routePath) {
      useCompletedTasksStore.getState().clear()
      // Flush stale optimistic data (complete/uncomplete skip invalidation
      // to keep tasks in-place, so we sync on navigation instead).
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      queryClient.invalidateQueries({ queryKey: ['view-tasks'] })
      queryClient.invalidateQueries({ queryKey: ['section-tasks'] })
      prevRouteRef.current = routePath
    }
  }, [routePath, queryClient])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  )

  const collisionDetection: CollisionDetection = useCallback(
    (args) => {
      const activeType = dragItem?.type

      // For project, section, and custom-list drags, use rect intersection only (sortable reorder)
      if (activeType === 'project' || activeType === 'custom-list' || activeType === 'section') {
        return rectIntersection(args)
      }

      // For task drags: sidebar droppables (project, label) take priority
      const pointerCollisions = pointerWithin(args)
      const sidebarDrop = pointerCollisions.find((c) => {
        const type = c.data?.droppableContainer?.data?.current?.type
        return type === 'project' || type === 'label'
      })
      if (sidebarDrop) return [sidebarDrop]

      // Fall back to rect intersection for sortable reordering
      return rectIntersection(args)
    },
    [dragItem?.type]
  )

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const data = event.active.data.current as Record<string, unknown>
      const type = data?.type as string

      if (type === 'task') {
        const task = data.task as Task
        setDragItem({ type: 'task', task })
        setExpandedTask(null)
      } else if (type === 'project') {
        const node = data.node as ProjectTreeNode
        setDragItem({ type: 'project', node })
      } else if (type === 'section') {
        const project = data.project as Project
        const siblings = data.siblings as Project[]
        setDragItem({ type: 'section', project, siblings })
      } else if (type === 'custom-list') {
        const list = data.list as CustomList
        setDragItem({ type: 'custom-list', list })
      }
    },
    [setExpandedTask]
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || !dragItem) {
        setDragItem(null)
        return
      }

      const overData = over.data.current as Record<string, unknown> | undefined

      if (dragItem.type === 'task') {
        const task = dragItem.task

        if (overData?.type === 'project') {
          const projectId = overData.projectId as number
          if (projectId !== task.project_id) {
            updateTask.mutate({
              id: task.id,
              task: { ...task, project_id: projectId },
            })
          }
        } else if (overData?.type === 'label') {
          const labelId = overData.labelId as number
          const currentLabels = task.labels ?? []
          if (!currentLabels.some((l) => l.id === labelId)) {
            addLabel.mutate({ taskId: task.id, labelId })
          }
        } else if (overData?.type === 'section') {
          // Task dropped on a section header — move task to that section's project
          const sectionProject = overData.project as Project
          if (sectionProject.id !== task.project_id) {
            updateTask.mutate({
              id: task.id,
              task: { ...task, project_id: sectionProject.id },
            })
          }
        } else if (overData?.type === 'parent-project') {
          // Task dropped on parent project drop zone — move back to parent
          const projectId = overData.projectId as number
          if (projectId !== task.project_id) {
            updateTask.mutate({
              id: task.id,
              task: { ...task, project_id: projectId },
            })
          }
        } else if (overData?.sortable && active.id !== over.id) {
          const { orderedTasks, viewId, sectionContexts } = useReorderStore.getState()
          const targetTaskId = Number(String(over.id).replace('task-', ''))

          // Find source context (where the dragged task lives)
          let sourceViewId: number | null = viewId
          let sourceTasks: Task[] = orderedTasks

          if (!viewId || !orderedTasks.some((t) => t.id === task.id)) {
            sourceViewId = null
            for (const [, ctx] of sectionContexts) {
              if (ctx.tasks.some((t) => t.id === task.id)) {
                sourceViewId = ctx.viewId
                sourceTasks = ctx.tasks
                break
              }
            }
          }

          // Find destination context (where the target task lives)
          let destViewId: number | null = viewId
          let destTasks: Task[] = orderedTasks
          let destProjectId: number | null = null

          if (viewId && orderedTasks.some((t) => t.id === targetTaskId)) {
            destProjectId = orderedTasks.find((t) => t.id === targetTaskId)?.project_id ?? null
          } else {
            destViewId = null
            for (const [projId, ctx] of sectionContexts) {
              if (ctx.tasks.some((t) => t.id === targetTaskId)) {
                destViewId = ctx.viewId
                destTasks = ctx.tasks
                destProjectId = projId
                break
              }
            }
          }

          if (sourceViewId === destViewId && sourceViewId) {
            // Same context — simple reorder
            const oldIndex = sourceTasks.findIndex((t) => t.id === task.id)
            const newIndex = sourceTasks.findIndex((t) => t.id === targetTaskId)
            if (oldIndex !== -1 && newIndex !== -1) {
              const newPosition = calculatePosition(sourceTasks, oldIndex, newIndex)
              reorderTask.mutate({ taskId: task.id, viewId: sourceViewId, position: newPosition })
            }
          } else if (destViewId && destProjectId && destProjectId !== task.project_id) {
            // Cross-section — move task to destination project + position
            const targetIndex = destTasks.findIndex((t) => t.id === targetTaskId)
            const above = destTasks[targetIndex - 1]?.position ?? 0
            const below = destTasks[targetIndex]?.position ?? (above + 2 ** 16)
            const insertPosition = (above + below) / 2

            const finalDestViewId = destViewId
            updateTask.mutate(
              { id: task.id, task: { ...task, project_id: destProjectId } },
              {
                onSuccess: () => {
                  reorderTask.mutate({ taskId: task.id, viewId: finalDestViewId, position: insertPosition })
                },
              }
            )
          }
        }
      } else if (dragItem.type === 'section') {
        if (overData?.type === 'section' && active.id !== over.id) {
          const siblings = dragItem.siblings
          const oldIndex = siblings.findIndex((s) => s.id === dragItem.project.id)
          const overProject = overData.project as Project
          const newIndex = siblings.findIndex((s) => s.id === overProject.id)
          if (oldIndex !== -1 && newIndex !== -1) {
            const without = siblings.filter((_, i) => i !== oldIndex)
            const above = without[newIndex - 1]?.position ?? 0
            const below = without[newIndex]?.position ?? (above + 2 ** 16)
            const newPosition = (above + below) / 2
            reorderProject.mutate({
              id: dragItem.project.id,
              project: {
                title: dragItem.project.title,
                description: dragItem.project.description,
                hex_color: dragItem.project.hex_color,
                is_archived: dragItem.project.is_archived,
                position: newPosition,
                parent_project_id: dragItem.project.parent_project_id,
              },
            })
          }
        }
      } else if (dragItem.type === 'project') {
        if (overData?.type === 'project' && active.id !== over.id) {
          const siblings = (active.data.current as Record<string, unknown>)?.siblings as ProjectTreeNode[]
          const node = dragItem.node
          if (siblings) {
            const oldIndex = siblings.findIndex((s) => s.id === node.id)
            const overNode = overData.node as ProjectTreeNode
            const newIndex = siblings.findIndex((s) => s.id === overNode.id)
            if (oldIndex !== -1 && newIndex !== -1) {
              const newPosition = calculateProjectPosition(siblings, oldIndex, newIndex)
              // Send full project object to avoid Go zero-value problem
              reorderProject.mutate({
                id: node.id,
                project: {
                  title: node.title,
                  description: node.description,
                  hex_color: node.hex_color,
                  is_archived: node.is_archived,
                  position: newPosition,
                },
              })
            }
          }
        }
      }
      // custom-list reorder is handled by CustomListNav's useDndMonitor

      setDragItem(null)
    },
    [dragItem, updateTask, reorderTask, reorderProject, addLabel]
  )

  useEffect(() => {
    api.getConfig().then(async (config) => {
      if (!config || !config.vikunja_url) {
        setAppState('setup')
        return
      }

      const t = (config.theme as ThemeOption) || 'system'
      themeRef.current = t
      applyTheme(t)

      if (config.auth_method === 'oidc') {
        const isAuthed = await api.checkAuth()
        setAppState(isAuthed ? 'ready' : 'setup')
      } else {
        setAppState(config.api_token ? 'ready' : 'setup')
      }
    })
  }, [])

  // Re-apply theme when OS preference changes (only matters for 'system' theme)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => {
      if (themeRef.current === 'system') {
        applyTheme('system')
      }
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // Invalidate query cache when Quick Entry/View mutates tasks
  useEffect(() => {
    const cleanup = api.onTasksChanged(() => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      queryClient.invalidateQueries({ queryKey: ['view-tasks'] })
      queryClient.invalidateQueries({ queryKey: ['task-detail'] })
    })
    return cleanup
  }, [queryClient])

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      dragging.current = true
      startX.current = e.clientX
      startWidth.current = sidebarWidth

      const handleMouseMove = (ev: MouseEvent) => {
        if (!dragging.current) return
        const delta = ev.clientX - startX.current
        const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth.current + delta))
        setSidebarWidth(newWidth)
      }

      const handleMouseUp = () => {
        dragging.current = false
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }

      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    },
    [sidebarWidth, setSidebarWidth]
  )

  if (appState === 'loading') {
    return <div className="flex h-screen w-screen items-center justify-center bg-[var(--bg-primary)]" />
  }

  if (appState === 'setup') {
    return <SetupView onComplete={() => setAppState('ready')} />
  }

  return (
    <DndContext sensors={sensors} collisionDetection={collisionDetection} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="relative flex h-screen w-screen overflow-hidden bg-[var(--bg-primary)]">
        {/* Window drag region overlay */}
        <div
          className="absolute inset-x-0 top-0 z-30 flex h-8"
          style={{
            WebkitAppRegion: 'drag',
            ...(window.api.platform === 'darwin' ? { paddingLeft: '80px' } : {}),
          } as React.CSSProperties}
        >
          <div className="flex-1" />
          <SearchBar />
          <WindowControls />
        </div>

        {/* Sidebar — bg extends behind drag region */}
        <div
          className="flex shrink-0 flex-col overflow-hidden border-r border-[var(--border-color)] bg-[var(--bg-sidebar)]"
          style={{ width: sidebarWidth }}
        >
          <div className="h-8 shrink-0" />
          <div className="flex-1 overflow-hidden">
            <Sidebar />
          </div>
        </div>

        <div
          className="w-1 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-[var(--accent-blue)]/20"
          onMouseDown={handleMouseDown}
          role="separator"
          aria-orientation="vertical"
        />

        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="h-8 shrink-0" />
          <UpdateBanner />
          <ContentArea>
            <Outlet />
          </ContentArea>
        </div>
      </div>

      <DragOverlay
        dropAnimation={{
          duration: 150,
          easing: 'ease',
          keyframes: ({ transform: { initial } }) => [
            { opacity: 1, transform: CSS.Transform.toString(initial) },
            { opacity: 0, transform: CSS.Transform.toString(initial) },
          ],
          sideEffects: defaultDropAnimationSideEffects({
            styles: { active: { opacity: '0' } },
          }),
        }}
      >
        {dragItem?.type === 'task' && <TaskDragOverlay task={dragItem.task} />}
        {dragItem?.type === 'project' && (
          <ProjectDragOverlay title={dragItem.node.title} hexColor={dragItem.node.hex_color} />
        )}
        {dragItem?.type === 'section' && (
          <SectionDragOverlay title={dragItem.project.title} />
        )}
        {dragItem?.type === 'custom-list' && (
          <CustomListDragOverlay name={dragItem.list.name} />
        )}
      </DragOverlay>
    </DndContext>
  )
}
