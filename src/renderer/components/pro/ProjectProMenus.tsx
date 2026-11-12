import type { RefObject } from 'react'
import { Menu, MenuItem, MenuRadioItem, MenuSeparator } from '@/components/overlay/Menu'
import type { PopoverCloseReason } from '@/components/overlay/Popover'
import { useProPrefs } from '@/hooks/use-pro-prefs'
import { useTaskOrderResolver, useTaskOrderSettings } from '@/hooks/use-task-order'
import type { Project } from '@/lib/vikunja-types'
import type { ProjectMode } from '../../../shared/pro/prefs'

const MODES: Array<{ mode: ProjectMode; label: string }> = [
  { mode: 'parallel', label: 'Parallel' },
  { mode: 'sequential', label: 'Sequential' },
  { mode: 'single', label: 'Single actions' },
]

interface SubProps {
  project: Project
  anchorRef: RefObject<HTMLElement | null>
  onClose: (reason?: PopoverCloseReason) => void
}

/**
 * A project's type (cross-app semantics 21.2): parallel (the default), sequential (only the first
 * task is available) or single actions. A sequential project follows the task order; when that is
 * not Manual, the menu offers to switch (decision 18). Synced.
 */
export function ProjectTypeMenu({ project, anchorRef, onClose }: SubProps) {
  const prefs = useProPrefs()
  const current = prefs.projectMode(project.id)
  const order = useTaskOrderResolver()(project.id)
  const { setProject } = useTaskOrderSettings(project.id)
  return (
    <Menu anchorRef={anchorRef} placement="right-start" label="Type" onClose={onClose}>
      {MODES.map(({ mode, label }) => (
        <MenuRadioItem key={mode} checked={current === mode} onSelect={() => void prefs.setProjectMode(project.id, mode)}>
          {label}
        </MenuRadioItem>
      ))}
      {current === 'sequential' && order !== 'manual' && (
        <>
          <MenuSeparator />
          <MenuItem onSelect={() => setProject('manual')}>Order tasks by hand (Manual)</MenuItem>
        </>
      )}
    </Menu>
  )
}

/** Active or On hold (21.2): a project on hold makes its tasks wait. Synced. */
export function ProjectStatusMenu({ project, anchorRef, onClose }: SubProps) {
  const prefs = useProPrefs()
  const held = prefs.projectOnHold(project.id)
  return (
    <Menu anchorRef={anchorRef} placement="right-start" label="Status" onClose={onClose}>
      <MenuRadioItem checked={!held} onSelect={() => void prefs.setProjectOnHold(project.id, false)}>
        Active
      </MenuRadioItem>
      <MenuRadioItem checked={held} onSelect={() => void prefs.setProjectOnHold(project.id, true)}>
        On hold
      </MenuRadioItem>
    </Menu>
  )
}
