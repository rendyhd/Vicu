import type { RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { Check } from 'lucide-react'
import { cn } from '@/lib/cn'
import { canMemberWrite, displayName } from '@/lib/collaboration'
import { useMemberPermissions } from '@/hooks/use-project-shares'
import { useToggleAssignee } from '@/hooks/use-assignee-mutations'
import type { PersonRef, Task } from '@/lib/vikunja-types'
import { Avatar } from '../shared/Avatar'
import { Popover, type PopoverCloseReason } from '../overlay/Popover'

interface AssignPopoverProps {
  anchorRef: RefObject<HTMLElement | null>
  task: Task
  /** Everyone who can see the project, you first. */
  members: readonly PersonRef[]
  me: PersonRef | null
  projectTitle: string
  onClose: (reason?: PopoverCloseReason) => void
}

/**
 * Who the task is assigned to (collaboration D4): the project's members, you first. A choice
 * toggles at once and the list stays open; a member who can only view the project is shown but
 * cannot be picked ("Can view only").
 */
export function AssignPopover({ anchorRef, task, members, me, projectTitle, onClose }: AssignPopoverProps) {
  const { t } = useTranslation()
  const toggle = useToggleAssignee()
  const permissionOf = useMemberPermissions(task.project_id, true)
  const assigned = new Set((task.assignees ?? []).map((a) => a.id))

  return (
    <Popover anchorRef={anchorRef} onClose={onClose} role="listbox" multiselectable label={t('task.assign.assignTo')} placement="bottom-start" className="w-[248px] p-1">
      <div aria-hidden="true" className="px-2.5 pb-1.5 pt-2 text-caption text-text-secondary">
        {t('task.assign.assignTo')}
      </div>
      {members.length === 0 ? (
        <div className="px-2.5 py-2 text-meta text-text-secondary">{t('task.assign.loadingPeople')}</div>
      ) : (
        members.map((person) => {
          const isAssigned = assigned.has(person.id)
          const canWrite = canMemberWrite(permissionOf(person.id))
          // Someone who can only view stays removable if they were assigned before.
          const disabled = !canWrite && !isAssigned
          const isMe = person.id === me?.id
          return (
            <button
              key={person.id}
              type="button"
              role="option"
              tabIndex={-1}
              aria-selected={isAssigned}
              aria-disabled={disabled || undefined}
              data-typeahead={displayName(person)}
              onClick={() => {
                if (disabled) return
                toggle.mutate({ task, person, assign: !isAssigned })
              }}
              className={cn(
                'flex min-h-[34px] w-full items-center gap-2.5 rounded-control px-2.5 text-left transition-colors duration-fade-fast',
                disabled ? 'cursor-default opacity-55' : 'hover:bg-bg-hover',
              )}
            >
              <Avatar person={person} size={20} />
              <span className="min-w-0 flex-1 truncate text-task-title text-text">
                {displayName(person)}
                {isMe && <span className="text-text-secondary"> {t('task.assign.you')}</span>}
              </span>
              {!canWrite && <span className="shrink-0 text-caption text-text-secondary">{t('task.assign.viewOnly')}</span>}
              {isAssigned && <Check className="h-3.5 w-3.5 shrink-0 text-accent-blue" aria-hidden="true" />}
            </button>
          )
        })
      )}
      <div aria-hidden="true" className="vicu-hairline mx-1 my-1 h-px bg-border" />
      <p className="px-2.5 pb-2 pt-1 text-caption text-text-secondary">
        {t('task.assign.sharedWithProject', { project: projectTitle })}
      </p>
    </Popover>
  )
}
