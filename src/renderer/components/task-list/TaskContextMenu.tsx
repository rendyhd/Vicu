import { useState, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { PopoverCloseReason } from '../overlay/Popover'
import {
  Flag,
  Inbox as InboxIcon,
  ArrowDown,
  ArrowUp,
  CalendarClock,
  CalendarRange,
  CalendarX,
  CheckCircle2,
  Copy,
  CopyPlus,
  FileText,
  FlagOff,
  Folder,
  FolderInput,
  Star,
  Sun,
  Sunrise,
  Tag,
  Trash2,
  Sparkles,
  UserPlus,
} from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { isNullDate } from '@/lib/date-utils'
import { normalizeHex, NULL_DATE } from '@/lib/constants'
import { useAppConfig } from '@/hooks/use-app-config'
import { useTaskActions } from '@/hooks/use-task-actions'
import { useDuplicateTasks } from '@/hooks/use-duplicate-tasks'
import { useTemplateActions } from '@/hooks/use-task-templates'
import { canStepTask, useTaskStep } from '@/hooks/use-task-step'
import { useProjects } from '@/hooks/use-projects'
import { useLabels } from '@/hooks/use-labels'
import { useSelectionStore } from '@/stores/selection-store'
import { resolveSelectedTasks } from '@/lib/task-selection'
import type { Task } from '@/lib/vikunja-types'
import { DatePickerPopover } from './DatePickerPopover'
import { ProjectPickerPopover } from './ProjectPickerPopover'
import { BulkAssignPopover } from './BulkAssignPopover'
import { useProjectAccessMap } from '@/hooks/use-project-access'
import { canAssignSelection } from '@/lib/bulk-assign'
import { LabelPickerPopover } from './LabelPickerPopover'
import { PRIORITY_OPTIONS } from './PriorityPickerPopover'
import { PriorityMark } from '../shared/PriorityMark'
import { Menu, MenuHeading, MenuItem, MenuRadioItem, MenuSeparator } from '../overlay/Menu'
import { shortcutHint } from '@/lib/shortcut-hint'
import { useAiReady } from '@/hooks/use-ai'
import { breakIntoSteps } from '@/lib/ai/break-into-steps'
import { usePro } from '@/hooks/use-pro'
import { flagActionLabel, useToggleFlags } from '@/hooks/use-flag'
import { useProUiStore } from '@/stores/pro-ui-store'
import { useWhenChoices } from '@/hooks/use-when-choices'
import { useDateFormat } from '@/hooks/use-date-format'
import { formatWeekdayDay } from '@/lib/date-display'
import { localDateOf, startOfLocalDay, toLocalDate } from '@/lib/due-dates'
import { moveDay, moveStep, type MoveStepId } from '../../../shared/when-choices'

interface TaskContextMenuProps {
  /** The right-clicked row — guarantees at least one target if the cache can't resolve the selection. */
  fallbackTask: Task
  x: number
  y: number
  /** The row can be dragged in its list (its order allows it): the menu offers Move up and Move down. */
  reorderable?: boolean
  onClose: () => void
}

type SubMenu = 'postpone' | 'date' | 'project' | 'label' | 'assign' | null

export function TaskContextMenu({ fallbackTask, x, y, reorderable = false, onClose }: TaskContextMenuProps) {
  const scheduleRef = useRef<HTMLButtonElement>(null)
  const postponeRef = useRef<HTMLButtonElement>(null)
  const whenChoices = useWhenChoices()
  const { t } = useTranslation()
  const projectRef = useRef<HTMLButtonElement>(null)
  const assignRef = useRef<HTMLButtonElement>(null)
  const access = useProjectAccessMap()
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
  const taskIdSet = useMemo(() => new Set(tasks.map((t) => t.id)), [tasks])

  // Where the menu was opened from (the row): a confirmation a menu entry opens gives focus back
  // there, since the entry itself is gone by then.
  const [opener] = useState<Element | null>(() => document.activeElement)
  const actions = useTaskActions(tasks, {
    returnFocusTo: opener instanceof HTMLElement && opener !== document.body ? opener : null,
  })

  const [sub, setSub] = useState<SubMenu>(null)
  const stepTask = useTaskStep()
  const duplicate = useDuplicateTasks()
  const templateActions = useTemplateActions()
  // Pro's flag (21.4), in the availability layer.
  const flagsOn = usePro().layer('availability')
  const triageOn = usePro().layer('portfolio')
  const toggleFlags = useToggleFlags()
  const clearSelection = useSelectionStore((s) => s.clearSelection)

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
  // Assign for a selection (semantics 9.2); one task is assigned in its card.
  const canAssign = multi && canAssignSelection(tasks, access)
  // Move up and Move down, for one row, only where it can go (like a drag; cross-app semantics 12.4).
  const [canMoveUp, canMoveDown] = useMemo(
    () => (reorderable && !multi ? [canStepTask(fallbackTask.id, 'up'), canStepTask(fallbackTask.id, 'down')] : [false, false]),
    [reorderable, multi, fallbackTask.id],
  )

  const hint = (spec: string) => shortcutHint(spec, window.api.platform === 'darwin')
  const fmt = useDateFormat()
  // "+1 week" for a selection (each moves from its own date), "+1 week · Fri 27" for one task.
  const moveByLabel = (step: MoveStepId) => {
    const label = moveStep(step).label
    if (multi || isNullDate(tasks[0].due_date)) return label
    const day = moveDay(localDateOf(tasks[0].due_date), step, toLocalDate(new Date()))
    return `${label} \u00b7 ${formatWeekdayDay(startOfLocalDay(day), fmt)}`
  }
  // The assistant's "Break into steps" (docs/ai-assistant-v1.md section 4): one saved task.
  const ai = useAiReady()
  const canBreak = ai.dictation && !multi && fallbackTask.id > 0 && !fallbackTask.done

  return (
    <Menu
      anchorPoint={{ x, y }}
      label={multi ? t('task.menu.count', { count: tasks.length }) : t('task.menu.actions')}
      onClose={onClose}
    >
      {multi && <MenuHeading>{t('task.menu.count', { count: tasks.length })}</MenuHeading>}

      {/* When: the top entry follows the "What does urgent mean?" setting */}
      {urgencyImportant ? (
        <MenuItem icon={<Star />} onSelect={actions.setUrgentPriority}>
          {t('task.menu.setImportant')}
        </MenuItem>
      ) : (
        <MenuItem icon={<Sun />} shortcut={hint('Mod+T')} onSelect={actions.setDueToday}>
          {t('task.menu.setToday')}
        </MenuItem>
      )}
      <MenuItem
        ref={postponeRef}
        icon={<Sunrise />}
        popup="menu"
        expanded={sub === 'postpone'}
        onSelect={() => setSub((s) => (s === 'postpone' ? null : 'postpone'))}
      >
        {t('when.postpone')}
      </MenuItem>
      {sub === 'postpone' && (
        // Tomorrow and Next week keep each task's time; Move by moves each from its own due date
        // (cross-app semantics 23.3). Rendered inside the menu, so it is a nested layer.
        <Menu anchorRef={postponeRef} placement="right-start" label={t('when.postpone')} onClose={closeSubAndMenu}>
          <MenuItem icon={<Sunrise />} onSelect={actions.postponeTomorrow}>
            {t('when.tomorrow')}
          </MenuItem>
          <MenuItem icon={<CalendarRange />} onSelect={actions.postponeNextWeek}>
            {t('when.nextWeek')}
          </MenuItem>
          {anyHasDate && whenChoices.moveBy.length > 0 && <MenuSeparator />}
          {anyHasDate &&
            whenChoices.moveBy.map((step) => (
              <MenuItem key={step} icon={<CalendarClock />} onSelect={() => actions.moveTasksBy(step)}>
                {moveByLabel(step)}
              </MenuItem>
            ))}
        </Menu>
      )}
      <MenuItem
        ref={scheduleRef}
        icon={<CalendarClock />}
        popup="dialog"
        expanded={sub === 'date'}
        onSelect={() => setSub((s) => (s === 'date' ? null : 'date'))}
      >
        {t('task.menu.schedule')}
      </MenuItem>
      {sub === 'date' && (
        <DatePickerPopover
          anchorRef={scheduleRef}
          placement="right-start"
          currentDate={datePickerCurrent}
          offerMoveBy={!multi}
          onDateChange={actions.setDueDateIso}
          onClose={closeSubAndMenu}
        />
      )}
      {anyHasDate && (
        <MenuItem icon={<CalendarX />} onSelect={actions.clearDate}>
          {t('task.menu.clearDate')}
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
          {t(option.label)}
        </MenuRadioItem>
      ))}
      {anyHasPriority && (
        <MenuItem icon={<FlagOff />} onSelect={actions.clearPriority}>
          {t('task.menu.clearPriority')}
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
          {t('task.menu.applyLabel', { label: lastLabel.title })}
        </MenuItem>
      )}
      <MenuItem
        ref={labelRef}
        icon={<Tag />}
        popup="dialog"
        expanded={sub === 'label'}
        onSelect={() => setSub((s) => (s === 'label' ? null : 'label'))}
      >
        {t('task.menu.applyLabelMore')}
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
          {t('task.menu.moveTo', { project: lastProject.title })}
        </MenuItem>
      )}
      <MenuItem
        ref={projectRef}
        icon={<FolderInput />}
        popup="listbox"
        expanded={sub === 'project'}
        onSelect={() => setSub((s) => (s === 'project' ? null : 'project'))}
      >
        {t('task.menu.moveToProject')}
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

      {canAssign && (
        <MenuItem
          ref={assignRef}
          icon={<UserPlus />}
          popup="menu"
          expanded={sub === 'assign'}
          onSelect={() => setSub((s) => (s === 'assign' ? null : 'assign'))}
        >
          {t('task.menu.assign')}
        </MenuItem>
      )}
      {sub === 'assign' && (
        <BulkAssignPopover anchorRef={assignRef} taskIds={taskIdSet} placement="right-start" onClose={closeSubAndMenu} />
      )}

      {canMoveUp && (
        <MenuItem icon={<ArrowUp />} shortcut={hint('Alt+Shift+↑')} onSelect={() => stepTask(fallbackTask.id, 'up')}>
          {t('task.menu.moveUp')}
        </MenuItem>
      )}
      {canMoveDown && (
        <MenuItem icon={<ArrowDown />} shortcut={hint('Alt+Shift+↓')} onSelect={() => stepTask(fallbackTask.id, 'down')}>
          {t('task.menu.moveDown')}
        </MenuItem>
      )}

      {canBreak && (
        <MenuItem icon={<Sparkles />} onSelect={() => breakIntoSteps(fallbackTask, projectData?.all.find((p) => p.id === fallbackTask.project_id)?.title)}>
          {t('task.menu.breakIntoSteps')}
        </MenuItem>
      )}

      <MenuSeparator />

      {/* Bulk-friendly actions */}
      <MenuItem icon={<Copy />} shortcut={hint('Mod+C')} onSelect={actions.copyAll}>
        {t('task.menu.copyTask', { count: multi ? 2 : 1 })}
      </MenuItem>
      <MenuItem
        icon={<CopyPlus />}
        shortcut={hint('Mod+D')}
        onSelect={() => {
          void duplicate(tasks)
          clearSelection()
        }}
      >
        {t('task.menu.duplicateTask', { count: multi ? 2 : 1 })}
      </MenuItem>
      {anyNotDone && (
        <MenuItem icon={<CheckCircle2 />} shortcut={hint('Mod+K')} onSelect={actions.completeAll}>
          {t('task.menu.completeTask', { count: multi ? 2 : 1 })}
        </MenuItem>
      )}
      {triageOn && !multi && !fallbackTask.done && (
        <MenuItem icon={<InboxIcon />} onSelect={() => useProUiStore.getState().setTriageTask(fallbackTask)}>
          {t('task.menu.treatAsRequest')}
        </MenuItem>
      )}
      {flagsOn && (
        <MenuItem icon={<Flag />} shortcut={hint('Mod+Shift+F')} onSelect={() => toggleFlags(tasks)}>
          {flagActionLabel(tasks)}
        </MenuItem>
      )}

      <MenuSeparator />

      {!multi && (
        <MenuItem
          icon={<FileText />}
          onSelect={() => {
            void templateActions.saveFrom(tasks[0])
            clearSelection()
          }}
        >
          {t('task.menu.saveAsTemplate')}
        </MenuItem>
      )}
      <MenuItem icon={<Trash2 />} danger shortcut={hint('Delete')} onSelect={actions.deleteAll}>
        {t('task.menu.deleteTask', { count: multi ? 2 : 1 })}
      </MenuItem>
    </Menu>
  )
}
