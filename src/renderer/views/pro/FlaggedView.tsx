import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useTasks } from '@/hooks/use-tasks'
import { useProjects } from '@/hooks/use-projects'
import { useAppConfig } from '@/hooks/use-app-config'
import { usePrintable } from '@/stores/print-store'
import { OPEN_TASKS_PARAMS, useAvailabilityView } from '@/hooks/use-availability'
import { usePro } from '@/hooks/use-pro'
import { withoutNestedSubtasks } from '@/lib/nested-subtasks'
import { TaskList } from '@/components/task-list/TaskList'
import { ProjectTaskGroup } from '@/components/task-list/ProjectTaskGroup'
import { ListSkeleton } from '@/components/shared/ListSkeleton'
import { HiddenSummary, ViewSwitch } from '@/components/pro/ViewSwitch'
import { ProOffNotice } from '@/components/pro/ProOffNotice'

/** Flagged (cross-app semantics 21.4): open tasks you flagged, by project. */
export function FlaggedView() {
  const { t } = useTranslation()
  const pro = usePro()
  const on = pro.layer('availability')
  const { data: tasks = [], isLoading } = useTasks(OPEN_TASKS_PARAMS, on, true)
  const { data: projects } = useProjects()
  const { data: config } = useAppConfig()
  const availability = useAvailabilityView('flagged')

  const flagged = useMemo(() => {
    const active = new Set(projects?.flat.map((project) => project.id) ?? [])
    const kept = tasks.filter((task) => task.is_favorite === true && active.has(task.project_id))
    return withoutNestedSubtasks(kept, { hideChildrenOfCompletedParents: false })
  }, [tasks, projects?.flat])
  const shown = useMemo(() => availability.filter(flagged), [availability, flagged])
  const hiddenCount = availability.hidden(flagged)

  const groups = useMemo(() => {
    const byProject = new Map<number, typeof shown>()
    for (const task of shown) byProject.set(task.project_id, [...(byProject.get(task.project_id) ?? []), task])
    return [...byProject.entries()]
      .map(([id, list]) => {
        const project = projects?.flat.find((p) => p.id === id)
        return { id, name: project?.title ?? t('pro.flaggedView.fallbackProject'), color: project?.hex_color, tasks: list }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [shown, projects?.flat, t])

  usePrintable(useMemo(() => ({ viewTitle: t('pro.flaggedView.title'), sections: [{ groups: groups.map((g) => ({ heading: g.name, tasks: g.tasks })) }] }), [groups, t]))

  if (!on) return <ProOffNotice title={t('pro.flaggedView.title')} />
  if (isLoading) return <ListSkeleton title={t('pro.flaggedView.title')} />

  return (
    <TaskList
      title={t('pro.flaggedView.title')}
      tasks={[]}
      projectId={config?.inbox_project_id}
      showNewTask={false}
      empty={groups.length === 0 && hiddenCount === 0}
      emptyTitle={t('pro.flaggedView.emptyTitle')}
      emptySubtitle={t('pro.flaggedView.emptySubtitle')}
      headerContent={<ViewSwitch view={availability.view} onChange={availability.setView} />}
    >
      {groups.map((group) => (
        <ProjectTaskGroup key={group.id} level={1} name={group.name} color={group.color} tasks={group.tasks} />
      ))}
      {availability.view === 'available' && <HiddenSummary count={hiddenCount} onShow={() => availability.setView('remaining')} />}
    </TaskList>
  )
}
