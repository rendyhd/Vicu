import { useEffect, useMemo, useState } from 'react'
import { useTasks } from '@/hooks/use-tasks'
import { useFilters } from '@/hooks/use-filters'
import { useProjects } from '@/hooks/use-projects'
import { usePrintable } from '@/stores/print-store'
import { TaskList } from '@/components/task-list/TaskList'
import { TaskRow } from '@/components/task-list/TaskRow'
import { TaskRowGroup } from '@/components/task-list/TaskRowGroup'
import { ListSectionHeader } from '@/components/task-list/ListSectionHeader'
import { ProjectTaskGroup } from '@/components/task-list/ProjectTaskGroup'
import { openCount, showsGroupHeader } from '@/lib/list-sections'
import { api } from '@/lib/api'
import type { Task } from '@/lib/vikunja-types'
import { ListSkeleton } from '@/components/shared/ListSkeleton'

export function AnytimeView() {
  const params = useFilters({ view: 'anytime' })
  const { data: tasks = [], isLoading } = useTasks(params)
  const { data: projectData, isLoading: projectsLoading } = useProjects()
  const [inboxProjectId, setInboxProjectId] = useState<number | undefined>()

  useEffect(() => {
    api.getConfig().then((config) => {
      if (config?.inbox_project_id) {
        setInboxProjectId(config.inbox_project_id)
      }
    })
  }, [])

  const groups = useMemo(() => {
    const projectMap = new Map(projectData?.flat.map((p) => [p.id, p]))

    // Group tasks by their root (top-level) project
    const getRootId = (id: number): number => {
      const p = projectMap.get(id)
      if (!p || !p.parent_project_id) return id
      return getRootId(p.parent_project_id)
    }

    interface SubGroup {
      projectId: number
      projectName: string
      color?: string
      tasks: Task[]
    }
    interface RootGroup {
      projectId: number
      projectName: string
      color?: string
      subGroups: SubGroup[]
    }

    // Group tasks by root project, then by direct project
    const byRoot = new Map<number, Map<number, Task[]>>()
    for (const task of tasks) {
      if (!projectMap.has(task.project_id)) continue
      if (inboxProjectId && task.project_id === inboxProjectId) continue
      const rootId = getRootId(task.project_id)
      if (!byRoot.has(rootId)) byRoot.set(rootId, new Map())
      const sub = byRoot.get(rootId)!
      const pid = task.project_id
      if (!sub.has(pid)) sub.set(pid, [])
      sub.get(pid)!.push(task)
    }

    return Array.from(byRoot.entries()).map(([rootId, subMap]): RootGroup => ({
      projectId: rootId,
      projectName: projectMap.get(rootId)?.title ?? `Project ${rootId}`,
      color: projectMap.get(rootId)?.hex_color,
      subGroups: Array.from(subMap.entries()).map(([pid, tasks]) => ({
        projectId: pid,
        projectName: projectMap.get(pid)?.title ?? `Project ${pid}`,
        color: projectMap.get(pid)?.hex_color,
        tasks,
      })),
    }))
  }, [tasks, projectData, inboxProjectId])

  usePrintable(
    useMemo(
      () => ({
        viewTitle: 'Anytime',
        sections: groups.map((group) => ({
          heading: group.projectName,
          groups: group.subGroups.map((sub) => ({
            heading: sub.projectId === group.projectId ? undefined : sub.projectName,
            tasks: sub.tasks,
          })),
        })),
      }),
      [groups]
    )
  )

  if (isLoading || projectsLoading) {
    return <ListSkeleton title="Anytime" identity="anytime" />
  }

  return (
    <TaskList
      title="Anytime"
      identity="anytime"
      tasks={[]}
      projectId={inboxProjectId}
      showNewTask={!!inboxProjectId && projectData?.flat.some((project) => project.id === inboxProjectId)}
      emptyTitle="Nothing here"
      emptySubtitle="Open tasks from all projects"
    >
      {groups.map((group) => {
        const groupTasks = group.subGroups.flatMap((sub) => sub.tasks)
        // A project with a single open task gets no header: the project goes on the row's meta line.
        if (!showsGroupHeader(groupTasks)) {
          return (
            <TaskRowGroup key={group.projectId}>
              {groupTasks.map((task) => (
                <TaskRow key={task.id} task={task} projectMeta={{ title: group.projectName, color: group.color }} />
              ))}
            </TaskRowGroup>
          )
        }
        return (
          <div key={group.projectId}>
            <ListSectionHeader level={1} title={group.projectName} count={openCount(groupTasks)} dotColor={group.color ?? ''} />
            {group.subGroups.map((sub) =>
              sub.projectId === group.projectId ? (
                <TaskRowGroup key={sub.projectId}>
                  {sub.tasks.map((task) => <TaskRow key={task.id} task={task} />)}
                </TaskRowGroup>
              ) : (
                <ProjectTaskGroup key={sub.projectId} level={2} name={sub.projectName} color={sub.color} tasks={sub.tasks} />
              )
            )}
          </div>
        )
      })}
    </TaskList>
  )
}
