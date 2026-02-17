import { useEffect, useState } from 'react'
import { useProjectTasks } from '@/hooks/use-project-tasks'
import { useReorderStore } from '@/stores/reorder-store'
import { api } from '@/lib/api'
import { TaskList } from '@/components/task-list/TaskList'

export function InboxView() {
  const [inboxProjectId, setInboxProjectId] = useState<number | undefined>()

  useEffect(() => {
    api.getConfig().then((config) => {
      if (config?.inbox_project_id) {
        setInboxProjectId(config.inbox_project_id)
      }
    })
  }, [])

  const { data: tasks = [], isLoading, viewId } = useProjectTasks(inboxProjectId)
  const setReorderContext = useReorderStore((s) => s.setReorderContext)

  useEffect(() => {
    setReorderContext(viewId ?? null, tasks)
  }, [viewId, tasks, setReorderContext])

  if (isLoading) {
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
      projectId={inboxProjectId}
      sortable
      viewId={viewId}
      emptyTitle="Nothing in Inbox"
      emptySubtitle="Tasks added here will be sorted later"
    />
  )
}
