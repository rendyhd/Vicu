import { useMemo } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { usePromiseWorld } from '@/hooks/use-promise-world'
import { usePrintable } from '@/stores/print-store'
import { TaskList } from '@/components/task-list/TaskList'
import { TaskRow } from '@/components/task-list/TaskRow'
import { TaskRowGroup } from '@/components/task-list/TaskRowGroup'
import { ListSectionHeader } from '@/components/task-list/ListSectionHeader'
import { ListSkeleton } from '@/components/shared/ListSkeleton'
import { ProOffNotice } from '@/components/pro/ProOffNotice'
import { waitingOn } from '../../../shared/pro/promises'

/**
 * Waiting on (cross-app semantics 21.6): open promises of theirs and tasks with an on-hold label,
 * grouped by person, the earliest due first.
 */
export function WaitingOnView() {
  const world = usePromiseWorld()
  const navigate = useNavigate()
  const groups = useMemo(() => {
    // A promise outside the area does not count as one (21.1).
    const tasks = world.open.filter((task) => !world.ledger.promises[String(task.id)] || world.promiseFor(task) !== null)
    return waitingOn(tasks, world.ledger, world.isOnHoldLabel, world.isPerson).map((group) => ({
      person: group.person,
      name: world.nameOf(group.person),
      tasks: group.tasks.flatMap((id) => world.openById.get(id) ?? []),
    }))
  }, [world])

  usePrintable(useMemo(() => ({ viewTitle: 'Waiting on', sections: [{ groups: groups.map((g) => ({ heading: g.name, tasks: g.tasks })) }] }), [groups]))

  if (!world.on) return <ProOffNotice title="Waiting on" />
  if (world.isLoading) return <ListSkeleton title="Waiting on" />

  return (
    <TaskList
      title="Waiting on"
      tasks={[]}
      showNewTask={false}
      empty={groups.length === 0}
      emptyTitle="Nothing to wait for"
      emptySubtitle={'Type "Jan: send the deck" to note what someone promised you'}
    >
      {groups.map((group) => (
        <div key={group.person ?? 'none'} data-pro-waiting-group={group.person ?? 'none'}>
          <ListSectionHeader level={1} title={group.name} count={group.tasks.length} />
          {group.person !== null && (
            <button
              type="button"
              className="ml-6 text-meta text-accent-blue hover:underline"
              onClick={() => navigate({ to: '/person/$labelId', params: { labelId: String(group.person) } })}
            >
              Open {group.name}
            </button>
          )}
          <TaskRowGroup>
            {group.tasks.map((task) => <TaskRow key={task.id} task={task} />)}
          </TaskRowGroup>
        </div>
      ))}
    </TaskList>
  )
}
