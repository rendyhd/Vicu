import { useState, useRef, useMemo } from 'react'
import type { PopoverCloseReason } from '../overlay/Popover'
import {
  CalendarClock,
  CalendarRange,
  CalendarX,
  CheckCircle2,
  Copy,
  FlagOff,
  Folder,
  FolderInput,
  Star,
  Sun,
  Sunrise,
  Tag,
  Trash2,
} from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { isNullDate } from '@/lib/date-utils'
import { normalizeHex, NULL_DATE } from '@/lib/constants'
import { useAppConfig } from '@/hooks/use-app-config'
import { useTaskActions } from '@/hooks/use-task-actions'
import { useProjects } from '@/hooks/use-projects'
import { useLabels } from '@/hooks/use-labels'
import { useSelectionStore } from '@/stores/selection-store'
import { resolveSelectedTasks } from '@/lib/task-selection'
import type { Task } from '@/lib/vikunja-types'
import { DatePickerPopover } from './DatePickerPopover'
import { ProjectPickerPopover } from './ProjectPickerPopover'
import { LabelPickerPopover } from './LabelPickerPopover'
import { PRIORITY_OPTIONS } from './PriorityPickerPopover'
import { PriorityMark } from '../shared/PriorityMark'
import { Menu, MenuHeading, MenuItem, MenuRadioItem, MenuSeparator } from '../overlay/Menu'
import { shortcutHint } from '@/lib/shortcut-hint'

interface TaskContextMenuProps {
  /** The right-clicked row — guarantees at least one target if the cache can't resolve the selection. */
  fallbackTask: Task
  x: number
  y: number
  onClose: () => void
}

type SubMenu = 'date' | 'project' | 'label' | null

export function TaskContextMenu({ fallbackTask, x, y, onClose }: TaskContextMenuProps) {
  const scheduleRef = useRef<HTMLButtonElement>(null)
  const projectRef = useRef<HTMLButtonElement>(null)
  const labelRef = useRef<HTMLButtonElement>(null)
  const qc = useQueryClient()
  const { data: config } = useAppConfig()
  const { data: projectData } = useProjects()
  const { data: labels } = useLabels()
  const selectedTaskIds = useSelectionStore((s) => s.selectedTaskIds)

  // Targets = the resolved multi-selection, or just the right-clicked row.
  const tasks = useMemo(() => {
    const resolved = resolveSelectedTasks(qc, selectedTaskIds)
    return resolved.length > 0 ? resolved : [fallbackTask]
  }, [qc, selectedTaskIds, fallbackTask])

  // Where the menu was opened from (the row): a confirmation a menu entry opens gives focus back
  // there, since the entry itself is gone by then.
  const [opener] = useState<Element | null>(() => document.activeElement)
  const actions = useTaskActions(tasks, {
    returnFocusTo: opener instanceof HTMLElement && opener !== document.body ? opener : null,
  })

  const [sub, setSub] = useState<SubMenu>(null)

  // A picker closes the menu too once something was chosen. When the browser dismissed the picker
  // (Escape, or a press that landed elsewhere) only the picker closes: the press may be on a menu
  // entry that still has to receive its click, and Escape closes one layer at a time.
  const closeSubAndMenu = (reason?: PopoverCloseReason) => {
    setSub(null)
    if (reason !== 'dismiss') onClose()
  }

  const urgencyImportant = config?.urgency_mode === 'important'

  const lastProjectId = config?.last_used_project_id
  const lastProject =
    lastProjectId != null ? projectData?.flat.find((p) => p.id === lastProjectId) : undefined

  const lastLabelId = config?.last_used_label_id
  const lastLabel = lastLabelId != null ? labels?.find((l) => l.id === lastLabelId) : undefined

  // Aggregates across the target set.
  const multi = tasks.length > 1
  const anyHasDate = tasks.some((t) => !isNullDate(t.due_date))
  const anyHasPriority = tasks.some((t) => (t.priority ?? 0) > 0)
  const anyNotDone = tasks.some((t) => !t.done)
  const allSameProject = tasks.every((t) => t.project_id === tasks[0].project_id)
  const currentProjectId = allSameProject ? tasks[0].project_id : undefined
  const datePickerCurrent = tasks.length === 1 ? tasks[0].due_date : NULL_DATE

  const hint = (spec: string) => shortcutHint(spec, window.api.platform === 'darwin')

  return (
    <Menu
      anchorPoint={{ x, y }}
      label={multi ? `${tasks.length} tasks` : 'Task actions'}
      onClose={onClose}
    >
      {multi && <MenuHeading>{tasks.length} tasks</MenuHeading>}

      {/* When: the top entry follows the "What does urgent mean?" setting */}
      {urgencyImportant ? (
        <MenuItem icon={<Star />} onSelect={actions.setUrgentPriority}>
          Set Important
        </MenuItem>
      ) : (
        <MenuItem icon={<Sun />} shortcut={hint('Mod+T')} onSelect={actions.setDueToday}>
          Set Today
        </MenuItem>
      )}
      <MenuItem icon={<Sunrise />} onSelect={actions.postponeTomorrow}>
        Postpone to tomorrow
      </MenuItem>
      <MenuItem icon={<CalendarRange />} onSelect={actions.postponeNextMonday}>
        Postpone to next Monday
      </MenuItem>
      <MenuItem
        ref={scheduleRef}
        icon={<CalendarClock />}
        popup="dialog"
        expanded={sub === 'date'}
        onSelect={() => setSub((s) => (s === 'date' ? null : 'date'))}
      >
        Schedule…
      </MenuItem>
      {sub === 'date' && (
        <DatePickerPopover
          anchorRef={scheduleRef}
          placement="right-start"
          currentDate={datePickerCurrent}
          onDateChange={actions.setDueDateIso}
          onClose={closeSubAndMenu}
        />
      )}
      {anyHasDate && (
        <MenuItem icon={<CalendarX />} onSelect={actions.clearDate}>
          Clear date
        </MenuItem>
      )}

      <MenuSeparator />

      {/* Priority: the current one is the checked radio */}
      {PRIORITY_OPTIONS.filter((o) => o.value > 0).map((option) => (
        <MenuRadioItem
          key={option.value}
          icon={<PriorityMark priority={option.value} decorative />}
          checked={tasks.every((t) => t.priority === option.value)}
          onSelect={() => actions.setPriority(option.value)}
        >
          {option.label}
        </MenuRadioItem>
      ))}
      {anyHasPriority && (
        <MenuItem icon={<FlagOff />} onSelect={actions.clearPriority}>
          Clear priority
        </MenuItem>
      )}

      <MenuSeparator />

      {/* Tags */}
      {lastLabel && tasks.some((t) => !(t.labels ?? []).some((l) => l.id === lastLabel.id)) && (
        <MenuItem
          icon={
            <span
              className="!h-2.5 !w-2.5 rounded-full"
              style={{ backgroundColor: normalizeHex(lastLabel.hex_color) || 'var(--text-secondary)' }}
            />
          }
          onSelect={() => actions.applyLabel(lastLabel.id)}
        >
          {`Apply "${lastLabel.title}"`}
        </MenuItem>
      )}
      <MenuItem
        ref={labelRef}
        icon={<Tag />}
        popup="dialog"
        expanded={sub === 'label'}
        onSelect={() => setSub((s) => (s === 'label' ? null : 'label'))}
      >
        Apply label…
      </MenuItem>
      {sub === 'label' && (
        <LabelPickerPopover
          anchorRef={labelRef}
          placement="right-start"
          tasks={tasks}
          onApplied={actions.recordLastLabel}
          onClose={closeSubAndMenu}
        />
      )}

      <MenuSeparator />

      {/* Move */}
      {lastProject && tasks.some((t) => t.project_id !== lastProject.id) && (
        <MenuItem
          icon={<Folder />}
          onSelect={() => {
            actions.moveToProject(lastProject.id)
            actions.recordLastProject(lastProject.id)
          }}
        >
          {`Move to "${lastProject.title}"`}
        </MenuItem>
      )}
      <MenuItem
        ref={projectRef}
        icon={<FolderInput />}
        popup="listbox"
        expanded={sub === 'project'}
        onSelect={() => setSub((s) => (s === 'project' ? null : 'project'))}
      >
        Move to project…
      </MenuItem>
      {sub === 'project' && (
        <ProjectPickerPopover
          anchorRef={projectRef}
          placement="right-start"
          currentProjectId={currentProjectId}
          onSelect={(pid) => {
            actions.moveToProject(pid)
            actions.recordLastProject(pid)
          }}
          onClose={closeSubAndMenu}
        />
      )}

      <MenuSeparator />

      {/* Bulk-friendly actions */}
      <MenuItem icon={<Copy />} shortcut={hint('Mod+C')} onSelect={actions.copyAll}>
        {multi ? 'Copy tasks' : 'Copy task'}
      </MenuItem>
      {anyNotDone && (
        <MenuItem icon={<CheckCircle2 />} shortcut={hint('Mod+K')} onSelect={actions.completeAll}>
          {multi ? 'Complete tasks' : 'Complete task'}
        </MenuItem>
      )}

      <MenuSeparator />

      <MenuItem icon={<Trash2 />} danger shortcut={hint('Delete')} onSelect={actions.deleteAll}>
        {multi ? 'Delete tasks' : 'Delete task'}
      </MenuItem>
    </Menu>
  )
}
