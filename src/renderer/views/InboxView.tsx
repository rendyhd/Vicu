import { useEffect, useMemo, useState } from 'react'
import { useProjectTasks } from '@/hooks/use-project-tasks'
import { useProjects } from '@/hooks/use-projects'
import { useReorderStore } from '@/stores/reorder-store'
import { usePrintable } from '@/stores/print-store'
import { api } from '@/lib/api'
import { TaskList } from '@/components/task-list/TaskList'

export function InboxView() {
  const [inboxProjectId, setInboxProjectId] = useState<number | undefined>()
  const { data: projects, isLoading: projectsLoading } = useProjects()

  useEffect(() => {
    api.getConfig().then((config) => {
      if (config?.inbox_project_id) {
        setInboxProjectId(config.inbox_project_id)
      }
    })
  }, [])

  const activeInboxId = inboxProjectId && projects?.flat.some((project) => project.id === inboxProjectId)
    ? inboxProjectId
    : undefined
  const { data: tasks = [], isLoading, viewId } = useProjectTasks(activeInboxId)
  const setReorderContext = useReorderStore((s) => s.setReorderContext)

  useEffect(() => {
    setReorderContext(viewId ?? null, tasks)
  }, [viewId, tasks, setReorderContext])

  usePrintable(
    useMemo(() => ({ viewTitle: 'Inbox', sections: [{ groups: [{ tasks }] }] }), [tasks])
  )

  if (isLoading || projectsLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-[var(--text-secondary)]">
        Loading...
      </div>
    )
  }

  return (
    <TaskList
      title="Inbox"
      tasks={tasks}
      projectId={activeInboxId}
      sortable
      viewId={viewId}
      emptyTitle={inboxProjectId && !activeInboxId ? 'Inbox project is archived' : 'Nothing in Inbox'}
      emptySubtitle={inboxProjectId && !activeInboxId ? 'Select an active Inbox project in Settings' : 'Tasks added here will be sorted later'}
    />
  )
}
