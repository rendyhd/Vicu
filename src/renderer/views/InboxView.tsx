import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
import { ArrowUpDown, Layers } from 'lucide-react'
import { useProjectTasks } from '@/hooks/use-project-tasks'
import { useProjects } from '@/hooks/use-projects'
import { useAppConfig } from '@/hooks/use-app-config'
import { useReorderStore } from '@/stores/reorder-store'
import { usePrintable } from '@/stores/print-store'
import { TaskList } from '@/components/task-list/TaskList'
import { RowViewProvider } from '@/components/task-list/RowViewContext'
import { ProjectCompletedRow } from '@/components/projects/ProjectCompletedRow'
import { ListSkeleton } from '@/components/shared/ListSkeleton'
import { TaskOrderMenu } from '@/components/projects/TaskOrderMenu'
import { Button } from '@/components/shared/Button'
import type { Project } from '@/lib/vikunja-types'

/** The Inbox's "Sort tasks": the order of the Inbox project (cross-app semantics 12.3). */
function InboxSortButton({ project }: { project: Project }) {
  const { t } = useTranslation()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={t('views.inbox.sortTasks')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex h-7 w-7 items-center justify-center rounded-control text-[var(--text-secondary)] transition-colors duration-fade-fast hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
      >
        <ArrowUpDown aria-hidden="true" className="h-4 w-4" />
      </button>
      {open && <TaskOrderMenu project={project} anchorRef={buttonRef} placement="bottom-end" onClose={() => setOpen(false)} />}
    </>
  )
}

/** Opens the guided Inbox session (cross-app semantics 14.2): one task at a time. */
function SortInboxButton() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  return (
    <Button variant="quiet" className="px-2" onClick={() => void navigate({ to: '/guided/$session', params: { session: 'inbox' } })}>
      <Layers aria-hidden="true" className="h-4 w-4" />
      {t('views.inbox.sortInbox')}
    </Button>
  )
}

export function InboxView() {
  const { t } = useTranslation()
  // The Inbox is a synced setting: it can change while the view is open (another device chose one).
  const { data: config } = useAppConfig()
  const inboxProjectId = config?.inbox_project_id || undefined
  const { data: projects, isLoading: projectsLoading } = useProjects()

  const inboxProject = inboxProjectId ? projects?.flat.find((project) => project.id === inboxProjectId) : undefined
  const activeInboxId = inboxProject?.id
  // The Inbox uses the order of the Inbox project (cross-app semantics 12.3).
  const { data: tasks = [], isLoading, viewId, order: taskOrder } = useProjectTasks(activeInboxId, true, true)
  const rowView = useMemo(() => ({ projectId: activeInboxId }), [activeInboxId])
  const setReorderContext = useReorderStore((s) => s.setReorderContext)

  useEffect(() => {
    setReorderContext(viewId ?? null, tasks, taskOrder)
  }, [viewId, tasks, taskOrder, setReorderContext])

  usePrintable(
    useMemo(() => ({ viewTitle: t('views.inbox.title'), sections: [{ groups: [{ tasks }] }] }), [tasks, t])
  )

  if (isLoading || projectsLoading) {
    return <ListSkeleton title={t('views.inbox.title')} identity="inbox" />
  }

  return (
    <RowViewProvider value={rowView}>
      <TaskList
        title={t('views.inbox.title')}
        identity="inbox"
        tasks={tasks}
        projectId={activeInboxId}
        sortable
        taskOrder={taskOrder}
        viewId={viewId}
        headerActions={inboxProject && (
          <>
            {tasks.some((task) => !task.done) && <SortInboxButton />}
            <InboxSortButton project={inboxProject} />
          </>
        )}
        emptyTitle={inboxProjectId && !activeInboxId ? t('views.inbox.archivedTitle') : t('views.inbox.emptyTitle')}
        emptySubtitle={inboxProjectId && !activeInboxId ? t('views.inbox.archivedSubtitle') : t('views.inbox.emptySubtitle')}
        // The Completed row (12.6) comes after the new-task row and does not make the list non-empty.
        empty={tasks.length === 0}
        newTaskPlacement="after-tasks"
      >
        {activeInboxId && <ProjectCompletedRow key={activeInboxId} projectId={activeInboxId} shownAbove={tasks} />}
      </TaskList>
    </RowViewProvider>
  )
}
