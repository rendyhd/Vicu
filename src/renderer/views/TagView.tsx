import { useMemo } from 'react'
import { useParams } from '@tanstack/react-router'
import { useTasks } from '@/hooks/use-tasks'
import { useLabels } from '@/hooks/use-labels'
import { useProjects } from '@/hooks/use-projects'
import { useFilters } from '@/hooks/use-filters'
import { useAppConfig } from '@/hooks/use-app-config'
import { useAddLabel } from '@/hooks/use-task-mutations'
import { usePrintable } from '@/stores/print-store'
import { withoutNestedSubtasks } from '@/lib/nested-subtasks'
import { TaskList } from '@/components/task-list/TaskList'
import { ProjectTaskGroup } from '@/components/task-list/ProjectTaskGroup'
import { RowViewProvider } from '@/components/task-list/RowViewContext'
import { ListSkeleton } from '@/components/shared/ListSkeleton'
import { useAvailabilityView } from '@/hooks/use-availability'
import { HiddenSummary, ViewSwitch } from '@/components/pro/ViewSwitch'
import { Link } from '@tanstack/react-router'
import { usePro } from '@/hooks/use-pro'
import { useProPrefs } from '@/hooks/use-pro-prefs'

export function TagView() {
  const { labelId } = useParams({ from: '/tag/$labelId' })
  const lid = Number(labelId)
  const { data: labels } = useLabels()
  const { data: projects } = useProjects()
  const { data: config } = useAppConfig()
  const addLabel = useAddLabel()
  // A task added here goes to the Inbox (like Today) and gets this tag.
  const inboxProjectId = config?.inbox_project_id
  // The rows are all about this tag: they do not repeat it as a chip.
  const rowView = useMemo(() => ({ labelId: lid }), [lid])
  const labelName = labels?.find((l) => l.id === lid)?.title ?? 'Tag'

  const params = useFilters({ view: 'tag', labelId: lid })
  const { data: tasks = [], isLoading } = useTasks(params)

  const availability = useAvailabilityView(`tag.${lid}`)
  // Pro (21.5): a person label links to the person's page.
  const personPage = usePro().layer('promises') && useProPrefs().isPerson(lid)
  const labeledAll = useMemo(() => {
    const activeIds = new Set(projects?.flat.map((project) => project.id) ?? [])
    const labeled = tasks.filter((t) => activeIds.has(t.project_id) && t.labels?.some((l) => l.id === lid))
    // Filter first, then hide nested subtasks: a labeled subtask is shown even when its parent
    // lacks the label, and nests under its parent only when the parent is in the list too.
    return withoutNestedSubtasks(labeled, { hideChildrenOfCompletedParents: false })
  }, [tasks, lid, projects?.flat])
  const filtered = useMemo(() => availability.filter(labeledAll), [availability, labeledAll])
  const hiddenCount = availability.hidden(labeledAll)

  const groups = useMemo(() => {
    const projectMap = new Map<number, { name: string; color?: string; tasks: typeof filtered }>()
    for (const task of filtered) {
      const pid = task.project_id
      if (!projectMap.has(pid)) {
        const project = projects?.flat.find((p) => p.id === pid)
        projectMap.set(pid, {
          name: project?.title ?? 'Unknown Project',
          color: project?.hex_color,
          tasks: [],
        })
      }
      projectMap.get(pid)!.tasks.push(task)
    }
    return Array.from(projectMap.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    )
  }, [filtered, projects?.flat])

  usePrintable(
    useMemo(
      () => ({
        viewTitle: labelName,
        sections: [{ groups: groups.map((g) => ({ heading: g.name, tasks: g.tasks })) }],
      }),
      [labelName, groups]
    )
  )

  if (isLoading) {
    return <ListSkeleton title={labelName} />
  }

  return (
    <RowViewProvider value={rowView}>
      <TaskList
        title={labelName}
        tasks={[]}
        projectId={inboxProjectId}
        showNewTask={!!inboxProjectId && !!projects?.flat.some((project) => project.id === inboxProjectId)}
        onTaskCreated={(task) => {
          if (!task.labels?.some((l) => l.id === lid)) addLabel.mutate({ taskId: task.id, labelId: lid })
        }}
        emptyTitle={`No tasks tagged "${labelName}"`}
        empty={availability.on ? groups.length === 0 && hiddenCount === 0 : undefined}
        headerContent={availability.on || personPage ? (
          <>
            {personPage && (
              <Link to="/person/$labelId" params={{ labelId: String(lid) }} className="mx-6 mb-2 inline-block text-meta font-medium text-accent-blue hover:underline">
                Open {labelName}'s page
              </Link>
            )}
            {availability.on && <ViewSwitch view={availability.view} onChange={availability.setView} />}
          </>
        ) : undefined}
      >
        {groups.map((group) => (
          <ProjectTaskGroup key={group.name} level={1} name={group.name} color={group.color} tasks={group.tasks} />
        ))}
        {availability.on && availability.view === 'available' && (
          <HiddenSummary count={hiddenCount} onShow={() => availability.setView('remaining')} />
        )}
      </TaskList>
    </RowViewProvider>
  )
}
