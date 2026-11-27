import { Fragment, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from '@tanstack/react-router'
import { useDndMonitor } from '@dnd-kit/core'
import { SortableContext } from '@dnd-kit/sortable'
import { verticalListSortingStrategyForeignSafe } from '@/lib/sortable-strategy'
import { useProjectTasks } from '@/hooks/use-project-tasks'
import { useProjectSections, type SectionData } from '@/hooks/use-project-sections'
import { useProjects } from '@/hooks/use-projects'
import { useReorderStore } from '@/stores/reorder-store'
import { usePrintable } from '@/stores/print-store'
import type { Task, Project } from '@/lib/vikunja-types'
import { TaskList } from '@/components/task-list/TaskList'
import { SectionGroup } from '@/components/task-list/SectionGroup'
import { AddSectionButton } from '@/components/task-list/AddSectionButton'
import { ParentDropZone } from '@/components/task-list/ParentDropZone'
import { RowViewProvider } from '@/components/task-list/RowViewContext'
import { ListSkeleton } from '@/components/shared/ListSkeleton'
import { Button } from '@/components/shared/Button'
import { ProjectHeaderMenu } from '@/components/projects/ProjectHeaderMenu'
import { useSharedProjectActions } from '@/hooks/use-project-actions'
import { useAvailabilityView } from '@/hooks/use-availability'
import { HiddenSummary, ViewSwitch } from '@/components/pro/ViewSwitch'
import { InitiativePanel } from '@/components/pro/InitiativePanel'
import { ProjectPlanLink } from '@/components/pro/ProjectPlanLink'
import { parentTaskId, useWorkMode } from '@/hooks/use-work-mode'
import { WorkModeMore } from '@/components/task-list/WorkModeMore'
import { LabelFilterBar, LabelFilterButton, LabelFilterMore } from '@/components/projects/ProjectLabelFilter'
import { useLabels } from '@/hooks/use-labels'
import { labelFilterChoices, shownWithLabels } from '../../shared/project-label-filter'

function findSectionForTask(
  sections: SectionData[],
  taskId: number
): { containerId: string; index: number } | null {
  for (const section of sections) {
    const idx = section.tasks.findIndex((t) => t.id === taskId)
    if (idx !== -1) return { containerId: String(section.project.id), index: idx }
    const found = findSectionForTask(section.children, taskId)
    if (found) return found
  }
  return null
}

/** The sections with only the tasks `keep` lets through, and how many tasks it took out in all. */
function filterSections(sections: SectionData[], keep: (tasks: Task[]) => Task[]): { sections: SectionData[]; removed: number } {
  let removed = 0
  const walk = (list: SectionData[]): SectionData[] =>
    list.map((section) => {
      const tasks = keep(section.tasks)
      removed += section.tasks.length - tasks.length
      return { ...section, tasks, children: walk(section.children) }
    })
  const result = walk(sections)
  return { sections: result, removed }
}

function flattenForPrint(
  secs: SectionData[]
): { heading: string; groups: { tasks: Task[] }[] }[] {
  return secs.flatMap((s) => [
    { heading: s.project.title, groups: [{ tasks: s.tasks }] },
    ...flattenForPrint(s.children),
  ])
}

/** Every task of the sections, at any depth. */
function sectionTasks(sections: SectionData[]): Task[] {
  return sections.flatMap((section) => [...section.tasks, ...sectionTasks(section.children)])
}

/** The sections that still hold a task, in themselves or in their own sections (17.2). */
function withoutEmptySections(sections: SectionData[]): SectionData[] {
  return sections.flatMap((section) => {
    const children = withoutEmptySections(section.children)
    return section.tasks.length > 0 || children.length > 0 ? [{ ...section, children }] : []
  })
}

const NO_LABELS: number[] = []

interface InsertIndicator {
  containerId: string // 'parent' or section project ID as string
  index: number
}

export function ProjectView() {
  const { t } = useTranslation()
  const { projectId } = useParams({ from: '/project/$projectId' })
  const pid = Number(projectId)
  const { restore } = useSharedProjectActions()
  // The rows are listed inside this project: none of them names it.
  const rowView = useMemo(() => ({ projectId: pid }), [pid])
  const { data: projectData, isLoading: projectsLoading } = useProjects()
  const activeProject = projectData?.flat.find((p) => p.id === pid)
  const archivedProject = projectData?.archived.find((p) => p.id === pid)
  const projectName = activeProject?.title ?? archivedProject?.title ?? t('views.project.fallbackName')

  const { data: everyTask = [], isLoading: tasksLoading, viewId, order: taskOrder } = useProjectTasks(activeProject?.id)
  const { sections: everySection, hasSections, isLoading: sectionsLoading } = useProjectSections(pid)
  // Work and Personal (22.4): the screen lists the tasks the mode shows, and says how many it holds
  // back (a task of the project can carry the work label), with a way to show them until it is left.
  const work = useWorkMode()
  const [shownAllFor, setShownAllFor] = useState<number | null>(null)
  const showAll = shownAllFor === pid
  const { allTasks, allSections, workHidden } = useMemo(() => {
    if (showAll || work.mode === 'all') return { allTasks: everyTask, allSections: everySection, workHidden: 0 }
    const own = work.filter(everyTask, parentTaskId)
    const inSections = filterSections(everySection, (tasks) => work.filter(tasks, parentTaskId))
    return { allTasks: own, allSections: inSections.sections, workHidden: everyTask.length - own.length + inSections.removed }
  }, [everyTask, everySection, work.filter, work.mode, showAll])
  // Pro: Available, Remaining or All (cross-app semantics 21.2). Off, `filter` keeps every task.
  const availability = useAvailabilityView(`project.${pid}`)
  const viewTasks = useMemo(() => availability.filter(allTasks), [availability, allTasks])
  const viewSections = useMemo(() => {
    if (!availability.on) return allSections
    const keep = (section: SectionData): SectionData => ({ ...section, tasks: availability.filter(section.tasks), children: section.children.map(keep) })
    return allSections.map(keep)
  }, [availability, allSections])
  // Labels (cross-app semantics 17.2): a filter for while the page is open, after everything else
  // that decides what it lists. Leaving the project forgets it.
  const { data: knownLabels = [] } = useLabels()
  const [labelFilter, setLabelFilter] = useState<{ pid: number; picked: number[]; open: boolean }>({ pid, picked: NO_LABELS, open: false })
  // Another project: the filter of the last one is forgotten, not kept for coming back to it.
  // A new project forgets the label filter and the other mode's tasks shown (17.2, 22.4: until the view is left).
  if (labelFilter.pid !== pid) {
    setLabelFilter({ pid, picked: NO_LABELS, open: false })
    if (shownAllFor !== null) setShownAllFor(null)
  }
  const pickedLabels = labelFilter.pid === pid ? labelFilter.picked : NO_LABELS
  const labelBarOpen = labelFilter.pid === pid && labelFilter.open
  const setPickedLabels = (picked: number[]) => setLabelFilter({ pid, picked, open: labelBarOpen })
  const labelBarId = useId()
  const labelButtonRef = useRef<HTMLButtonElement>(null)
  const labelChoices = useMemo(
    () => labelFilterChoices([...viewTasks, ...sectionTasks(viewSections)], pickedLabels, knownLabels),
    [viewTasks, viewSections, pickedLabels, knownLabels],
  )
  const { tasks, sections, labelHidden } = useMemo(() => {
    if (pickedLabels.length === 0) return { tasks: viewTasks, sections: viewSections, labelHidden: 0 }
    const own = shownWithLabels(viewTasks, pickedLabels, parentTaskId)
    const inSections = filterSections(viewSections, (list) => shownWithLabels(list, pickedLabels, parentTaskId))
    return { tasks: own, sections: withoutEmptySections(inSections.sections), labelHidden: viewTasks.length - own.length + inSections.removed }
  }, [viewTasks, viewSections, pickedLabels])
  const hiddenCount = useMemo(() => {
    if (!availability.on) return 0
    const count = (list: SectionData[]): number => list.reduce((sum, section) => sum + availability.hidden(section.tasks) + count(section.children), 0)
    return availability.hidden(allTasks) + count(allSections)
  }, [availability, allTasks, allSections])
  const setReorderContext = useReorderStore((s) => s.setReorderContext)
  const clearSectionContexts = useReorderStore((s) => s.clearSectionContexts)

  const [insertIndicator, setInsertIndicator] = useState<InsertIndicator | null>(null)

  // Push parent-project reorder context whenever its tasks shift.
  useEffect(() => {
    setReorderContext(viewId ?? null, tasks, taskOrder)
  }, [viewId, tasks, taskOrder, setReorderContext])

  // Clear section reorder contexts only when navigating to a different project
  // (or unmounting). Tying clearance to `tasks` would wipe contexts on every
  // re-render, but a SectionGroup only re-pushes its own context when ITS
  // tasks reference changes — so untouched siblings would silently lose their
  // entry until the next time their tasks happened to update, and any drop
  // targeting one of them would fail to resolve a destination.
  useEffect(() => {
    return () => clearSectionContexts()
  }, [pid, clearSectionContexts])

  usePrintable(
    useMemo(
      () => ({
        viewTitle: projectName,
        sections: [
          ...(tasks.length > 0 ? [{ groups: [{ tasks }] }] : []),
          ...flattenForPrint(sections),
        ],
      }),
      [projectName, tasks, sections]
    )
  )

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
      } else if (overData?.type === 'section-bottom') {
        // Hovering at the bottom of a section — insert at the end
        overContainerId = String(overData.projectId)
        overIndex = (overData.taskCount as number | undefined) ?? 0
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
          const sectionResult = findSectionForTask(sections, targetTaskId)
          if (sectionResult) {
            overContainerId = sectionResult.containerId
            overIndex = sectionResult.index
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
        const dragResult = findSectionForTask(sections, draggedTask.id)
        if (dragResult) dragContainerId = dragResult.containerId
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

  const isLoading = projectsLoading || tasksLoading || sectionsLoading

  if (isLoading) {
    return <ListSkeleton title={projectName} />
  }

  if (projectData && !activeProject) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
        <h1 className="text-lg font-semibold text-[var(--text-primary)]">
          {archivedProject ? t('views.project.archived') : t('views.project.unavailable')}
        </h1>
        <p className="max-w-sm text-sm text-[var(--text-secondary)]">
          {archivedProject
            ? t('views.project.archivedHint')
            : t('views.project.unavailableHint')}
        </p>
        {archivedProject && (
          <Button variant="primary" className="mt-2" onClick={() => restore(archivedProject)}>
            {t('views.project.restore')}
          </Button>
        )}
      </div>
    )
  }

  const sectionProjects = sections.map((s) => s.project)
  const parentInsertIndex =
    insertIndicator?.containerId === 'parent' ? insertIndicator.index : undefined

  return (
    <RowViewProvider value={rowView}>
    <TaskList
      title={projectName}
      tasks={tasks}
      projectId={pid}
      sortable
      taskOrder={taskOrder}
      viewId={viewId}
      empty={tasks.length === 0 && !hasSections && hiddenCount === 0 && labelHidden === 0}
      headerContent={availability.on || activeProject ? (
        <>
          {labelBarOpen && labelChoices.length > 0 && (
            <LabelFilterBar
              id={labelBarId}
              choices={labelChoices}
              picked={pickedLabels}
              onToggle={(id) => setPickedLabels(pickedLabels.includes(id) ? pickedLabels.filter((x) => x !== id) : [...pickedLabels, id])}
              onClear={() => setPickedLabels([])}
              onClose={() => {
                setLabelFilter({ pid, picked: pickedLabels, open: false })
                labelButtonRef.current?.focus()
              }}
            />
          )}
          <InitiativePanel projectId={pid} />
          <ProjectPlanLink projectId={pid} />
          {availability.on && <ViewSwitch view={availability.view} onChange={availability.setView} />}
        </>
      ) : undefined}
      emptyTitle={t('views.project.emptyTitle')}
      emptySubtitle={t('views.project.emptySubtitle')}
      headerActions={activeProject && (
        <>
          {labelChoices.length > 0 && (
            <LabelFilterButton
              ref={labelButtonRef}
              picked={pickedLabels.length}
              open={labelBarOpen}
              controls={labelBarId}
              onToggle={() => setLabelFilter({ pid, picked: pickedLabels, open: !labelBarOpen })}
            />
          )}
          <ProjectHeaderMenu project={activeProject} />
        </>
      )}
      insertIndex={parentInsertIndex}
      newTaskPlacement="after-tasks"
    >
      <div className="px-2">
        {hasSections && <ParentDropZone projectId={pid} />}
        {hasSections && (
          <SortableContext
            items={sectionProjects.map((p) => `section-${p.id}`)}
            strategy={verticalListSortingStrategyForeignSafe}
          >
            {sections.map((section, i) => (
              <Fragment key={section.project.id}>
                {i > 0 && <AddSectionButton parentProjectId={pid} siblings={sectionProjects} index={i} />}
              <SectionGroup
                project={section.project}
                tasks={section.tasks}
                viewId={section.viewId}
                siblings={sectionProjects}
                childSections={section.children}
                depth={0}
                insertIndicator={insertIndicator}
                taskOrder={section.order}
              />
              </Fragment>
            ))}
          </SortableContext>
        )}
        <AddSectionButton parentProjectId={pid} siblings={sectionProjects} index={sectionProjects.length} />
      </div>
      {pickedLabels.length > 0 && <LabelFilterMore count={labelHidden} onShowAll={() => setPickedLabels([])} />}
      <WorkModeMore count={workHidden} mode={work.mode} onShow={() => setShownAllFor(pid)} />
      {availability.on && availability.view === 'available' && (
        <HiddenSummary count={hiddenCount} onShow={() => availability.setView('remaining')} />
      )}
    </TaskList>
    </RowViewProvider>
  )
}
