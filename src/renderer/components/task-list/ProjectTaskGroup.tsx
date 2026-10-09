import type { Task } from '@/lib/vikunja-types'
import { openCount, showsGroupHeader } from '@/lib/list-sections'
import { ListSectionHeader } from './ListSectionHeader'
import { TaskRow } from './TaskRow'
import { TaskRowGroup } from './TaskRowGroup'

interface ProjectTaskGroupProps {
  level: 1 | 2
  name: string
  /** The project colour (`#RRGGBB`), if it has one. */
  color?: string
  tasks: Task[]
}

/**
 * The tasks of one project inside a list view: a header with the open count and the project dot,
 * unless the group is a single task. That row gets no header and carries the project on its meta
 * line instead (`projectMeta`).
 */
export function ProjectTaskGroup({ level, name, color, tasks }: ProjectTaskGroupProps) {
  if (!showsGroupHeader(tasks)) {
    return (
      <TaskRowGroup>
        {tasks.map((task) => (
          <TaskRow key={task.id} task={task} projectMeta={{ title: name, color }} />
        ))}
      </TaskRowGroup>
    )
  }
  return (
    <div>
      <ListSectionHeader level={level} title={name} count={openCount(tasks)} dotColor={color ?? ''} />
      <TaskRowGroup>
        {tasks.map((task) => (
          <TaskRow key={task.id} task={task} />
        ))}
      </TaskRowGroup>
    </div>
  )
}
