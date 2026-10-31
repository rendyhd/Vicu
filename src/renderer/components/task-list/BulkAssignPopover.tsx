import { useMemo, type RefObject } from 'react'
import { Check, Minus } from 'lucide-react'
import { cn } from '@/lib/cn'
import { assignablePeople, assignChanges, assignMark } from '@/lib/bulk-assign'
import { canMemberWrite, displayName } from '@/lib/collaboration'
import { useMembersPermissions } from '@/hooks/use-project-shares'
import { useCollabMe, useProjectAccessMap } from '@/hooks/use-project-access'
import { useProjects } from '@/hooks/use-projects'
import { useSelectedTasks } from '@/hooks/use-selected-tasks'
import { useToggleAssignee } from '@/hooks/use-assignee-mutations'
import { Avatar } from '../shared/Avatar'
import { Popover, type PopoverCloseReason } from '../overlay/Popover'

interface BulkAssignPopoverProps {
  anchorRef: RefObject<HTMLElement | null>
  taskIds: ReadonlySet<number>
  placement?: 'bottom-start' | 'top-start' | 'right-start'
  onClose: (reason?: PopoverCloseReason) => void
}

/**
 * Assign for a selection (cross-app semantics 9.2): the members of every selected task's project,
 * you first, each ticked, partly ticked or not. A choice assigns the person to every task that
 * lacks them, or removes a ticked person from all, through the single task's assign; the list
 * stays open and follows the cache.
 */
export function BulkAssignPopover({ anchorRef, taskIds, placement = 'top-start', onClose }: BulkAssignPopoverProps) {
  const ids = useMemo(() => new Set(taskIds), [taskIds])
  const tasks = useSelectedTasks(ids)
  const access = useProjectAccessMap()
  const me = useCollabMe()
  const toggle = useToggleAssignee()
  const { data: projects } = useProjects()
  const projectIds = useMemo(() => [...new Set(tasks.map((t) => t.project_id))], [tasks])
  const permissionOf = useMembersPermissions(projectIds, true)
  const people = assignablePeople(tasks, access)
  const onlyProject = projectIds.length === 1 ? projects?.all.find((p) => p.id === projectIds[0])?.title : undefined

  return (
    <Popover anchorRef={anchorRef} onClose={onClose} role="menu" label="Assign to" placement={placement} className="w-[248px] p-1">
      <div aria-hidden="true" className="px-2.5 pb-1.5 pt-2 text-caption text-text-secondary">
        Assign {tasks.length} tasks to
      </div>
      {people.length === 0 ? (
        <div className="px-2.5 py-2 text-meta text-text-secondary">Loading people…</div>
      ) : (
        people.map((person) => {
          const mark = assignMark(person, tasks)
          const canWrite = projectIds.every((id) => canMemberWrite(permissionOf(id, person.id)))
          // Someone who can only view stays removable where they were assigned before.
          const disabled = !canWrite && mark === 'none'
          const isMe = person.id === me?.id
          return (
            <button
              key={person.id}
              type="button"
              role="menuitemcheckbox"
              tabIndex={-1}
              aria-checked={mark === 'all' ? true : mark === 'some' ? 'mixed' : false}
              aria-disabled={disabled || undefined}
              data-typeahead={displayName(person)}
              onClick={() => {
                if (disabled) return
                for (const { task, assign } of assignChanges(person, tasks)) toggle.mutate({ task, person, assign })
              }}
              className={cn(
                'flex min-h-[34px] w-full items-center gap-2.5 rounded-control px-2.5 text-left transition-colors duration-fade-fast',
                disabled ? 'cursor-default opacity-55' : 'hover:bg-bg-hover',
              )}
            >
              <Avatar person={person} size={20} />
              <span className="min-w-0 flex-1 truncate text-task-title text-text">
                {displayName(person)}
                {isMe && <span className="text-text-secondary"> (you)</span>}
              </span>
              {!canWrite && <span className="shrink-0 text-caption text-text-secondary">Can view only</span>}
              {mark === 'all' && <Check className="h-3.5 w-3.5 shrink-0 text-accent-blue" aria-hidden="true" />}
              {mark === 'some' && <Minus className="h-3.5 w-3.5 shrink-0 text-accent-blue" aria-hidden="true" />}
            </button>
          )
        })
      )}
      <div aria-hidden="true" className="vicu-hairline mx-1 my-1 h-px bg-border" />
      <p className="px-2.5 pb-2 pt-1 text-caption text-text-secondary">
        {onlyProject ? `People ${onlyProject} is shared with.` : 'People these projects are shared with.'} Assigned people get a notification.
      </p>
    </Popover>
  )
}
