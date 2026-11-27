import type { RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { Menu, MenuRadioItem, MenuSeparator } from '@/components/overlay/Menu'
import type { PopoverCloseReason } from '@/components/overlay/Popover'
import { useTaskOrderResolver, useTaskOrderSettings } from '@/hooks/use-task-order'
import type { Project } from '@/lib/vikunja-types'
import { TASK_ORDER_KEYS } from '../../../shared/task-order'
import { TASK_ORDER_LABEL_KEYS } from '@/lib/task-order-labels'

interface TaskOrderMenuProps {
  /** The project whose tasks it orders (for the Inbox: the Inbox project). */
  project: Project
  anchorRef: RefObject<HTMLElement | null>
  placement?: 'right-start' | 'bottom-end'
  onClose: (reason?: PopoverCloseReason) => void
}

/**
 * "Sort tasks" for one project (cross-app semantics section 12): Default follows the parent project,
 * then the global order in Settings; any other choice is the project's own and syncs to every device.
 */
export function TaskOrderMenu({ project, anchorRef, placement = 'right-start', onClose }: TaskOrderMenuProps) {
  const { t } = useTranslation()
  const { projectOwn, setProject } = useTaskOrderSettings(project.id)
  const resolve = useTaskOrderResolver()
  // What "Default" means here: the parent's order, else the global one.
  const inherited = resolve(project.parent_project_id > 0 ? project.parent_project_id : undefined)
  return (
    <Menu anchorRef={anchorRef} placement={placement} label={t('projects.order.sortTasks')} onClose={onClose}>
      <MenuRadioItem checked={projectOwn === null} onSelect={() => setProject(null)}>
        {t('projects.order.default', { order: t(TASK_ORDER_LABEL_KEYS[inherited]) })}
      </MenuRadioItem>
      <MenuSeparator />
      {TASK_ORDER_KEYS.map((key) => (
        <MenuRadioItem key={key} checked={projectOwn === key} onSelect={() => setProject(key)}>
          {t(TASK_ORDER_LABEL_KEYS[key])}
        </MenuRadioItem>
      ))}
    </Menu>
  )
}
