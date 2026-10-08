import { Fragment, useRef, type ReactNode, type RefObject } from 'react'
import { Calendar, Bell, Repeat, Paperclip, ListChecks, FolderOpen, MoreHorizontal, Info, Trash2, Plus } from 'lucide-react'
import { cn } from '@/lib/cn'
import { isNullDate } from '@/lib/date-utils'
import { labelChipStyle } from '@/lib/label-style'
import { checklistLabel } from '@/lib/row-anatomy'
import { formatRecurrenceLabel } from '@/lib/recurrence'
import { formatDueDate } from '@/lib/date-utils'
import { useDateFormat } from '@/hooks/use-date-format'
import { subtaskProgress } from '@/lib/task-hierarchy'
import { useIsDark } from '@/hooks/use-is-dark'
import { useProjects } from '@/hooks/use-projects'
import type { Task, TaskReminder } from '@/lib/vikunja-types'
import { priorityMark } from '../../../shared/priority-mark-svg'
import { PriorityMark } from '../shared/PriorityMark'
import { Popover } from '../overlay/Popover'
import { Tooltip } from '../overlay/Tooltip'
import { TaskDueBadge, DueDateContextProvider } from './TaskDueBadge'
import { WhenPopover } from './WhenPopover'
import { PriorityPickerPopover } from './PriorityPickerPopover'
import { LabelPickerPopover } from './LabelPickerPopover'
import { ReminderPickerPopover } from './ReminderPickerPopover'
import { RecurrencePickerPopover } from './RecurrencePickerPopover'
import { AttachmentPickerPopover } from './AttachmentPickerPopover'
import { ProjectPickerPopover } from './ProjectPickerPopover'
import { InfoPopover } from './InfoPopover'

/** The one editor of the card that is open, if any. */
export type CardPopover =
  | 'date'
  | 'priority'
  | 'label'
  | 'subtasks'
  | 'reminder'
  | 'repeat'
  | 'attachment'
  | 'project'
  | 'more'
  | 'info'
  | null

type OpenPopover = Exclude<CardPopover, null>

interface TaskCardBarProps {
  task: Task
  active: CardPopover
  onToggle: (popover: OpenPopover) => void
  /** Opens an editor directly (the More menu opens Task info). */
  onOpen: (popover: OpenPopover) => void
  onClose: () => void
  /** Other buttons that toggle the attachment popover (the paperclip in the card header). */
  attachmentInvokers: RefObject<HTMLElement | null>[]
  onDateChange: (isoDate: string) => void
  onRecurrenceChange: (repeatAfter: number, repeatMode: number) => void
  onPriorityChange: (priority: number) => void
  onReminderChange: (reminders: TaskReminder[]) => void
  onProjectChange: (projectId: number) => void
  onDelete: () => void
}

const BUTTON = 'inline-flex min-h-7 shrink-0 items-center gap-1 rounded-control px-2 text-meta transition-colors duration-fade-fast'
const SET = 'border border-[var(--border-color)] text-text hover:bg-bg-hover'
const UNSET = 'border border-transparent text-text-secondary hover:bg-bg-hover hover:text-text'
const OPEN = 'border border-transparent bg-accent-blue/10 text-accent-blue'

interface PropertyButtonProps {
  /** The stable hook for scenarios; the accessible name is `name`. */
  prop: string
  /** The property's name. A set chip is named "<name>: <value>", so its name contains the text it shows. */
  name: string
  /** What the chip shows, as text. */
  value?: string
  /** The name of the unset "+" button when it differs from `name` (it must contain the visible words). */
  unsetName?: string
  tip?: string
  shortcut?: string
  isSet: boolean
  open: boolean
  haspopup?: 'dialog' | 'listbox' | 'menu'
  buttonRef: RefObject<HTMLButtonElement>
  onClick: () => void
  /** What an unset property says after the plus. */
  unsetLabel?: string
  /** The icon-only form (attachments, More). */
  iconOnly?: boolean
  icon?: ReactNode
  children?: ReactNode
  className?: string
}

function PropertyButton({ prop, name, value, unsetName, tip, shortcut, isSet, open, haspopup, buttonRef, onClick, unsetLabel, iconOnly, icon, children, className }: PropertyButtonProps) {
  return (
    <Tooltip label={tip ?? name} shortcut={shortcut}>
      <button
        ref={buttonRef}
        type="button"
        data-prop={prop}
        aria-label={isSet && value ? `${name}: ${value}` : !isSet && !iconOnly ? (unsetName ?? name) : name}
        aria-haspopup={haspopup}
        aria-expanded={haspopup ? open : undefined}
        onClick={onClick}
        className={cn(BUTTON, iconOnly && 'w-7 justify-center px-0', open ? OPEN : isSet ? SET : UNSET, className)}
      >
        {isSet || iconOnly ? (
          <>
            {icon}
            {children}
          </>
        ) : (
          <>
            <Plus className="h-3 w-3" aria-hidden="true" />
            <span>{unsetLabel}</span>
          </>
        )}
      </button>
    </Tooltip>
  )
}

/**
 * The properties of an open card, in the order of the Android editor: date, priority, labels,
 * checklist, reminder, repeat, project, attachments. A set property is a chip that opens its
 * editor; an unset one is a quiet "+" button that does the same. Task info and Delete live under
 * More. Each button has a tooltip (400 ms, with its shortcut where there is one).
 */
export function TaskCardBar({
  task,
  active,
  onToggle,
  onOpen,
  onClose,
  attachmentInvokers,
  onDateChange,
  onRecurrenceChange,
  onPriorityChange,
  onReminderChange,
  onProjectChange,
  onDelete,
}: TaskCardBarProps) {
  const isDark = useIsDark()
  const dateFormat = useDateFormat()
  const { data: projects } = useProjects()
  const dateRef = useRef<HTMLButtonElement>(null)
  const priorityRef = useRef<HTMLButtonElement>(null)
  const labelRef = useRef<HTMLButtonElement>(null)
  const subtasksRef = useRef<HTMLButtonElement>(null)
  const reminderRef = useRef<HTMLButtonElement>(null)
  const repeatRef = useRef<HTMLButtonElement>(null)
  const projectRef = useRef<HTMLButtonElement>(null)
  const attachmentRef = useRef<HTMLButtonElement>(null)
  const moreRef = useRef<HTMLButtonElement>(null)

  const labels = task.labels ?? []
  const hasDate = !isNullDate(task.due_date)
  const mark = priorityMark(task.priority)
  const progress = subtaskProgress(task)
  const reminderCount = task.reminders?.length ?? 0
  const repeats = (task.repeat_after ?? 0) > 0 || (task.repeat_mode ?? 0) > 0
  const attachmentCount = task.attachments?.length ?? 0
  const project = projects?.flat.find((p) => p.id === task.project_id)
  const dueText = hasDate ? (formatDueDate(task.due_date, new Date(), dateFormat, 'row') ?? '') : ''
  const repeatText = formatRecurrenceLabel(task.repeat_after ?? 0, task.repeat_mode ?? 0)
  const reminderText = reminderCount === 1 ? '1 reminder' : `${reminderCount} reminders`
  const is = (p: OpenPopover) => active === p

  return (
    <div className="col-start-2 flex flex-wrap items-center gap-1 pb-3 pt-2">
      <PropertyButton
        prop="schedule"
        name="Schedule"
        value={dueText}
        unsetName="Schedule date"
        shortcut="Mod+T"
        isSet={hasDate}
        open={is('date')}
        haspopup="dialog"
        buttonRef={dateRef}
        onClick={() => onToggle('date')}
        unsetLabel="Date"
        icon={<Calendar className="h-3.5 w-3.5" aria-hidden="true" />}
      >
        <DueDateContextProvider value="row">
          <TaskDueBadge dueDate={task.due_date} className="px-0 py-0" />
        </DueDateContextProvider>
      </PropertyButton>
      {is('date') && (
        <WhenPopover
          anchorRef={dateRef}
          currentDate={task.due_date}
          onDateChange={onDateChange}
          onClose={onClose}
          repeatAfter={task.repeat_after ?? 0}
          repeatMode={task.repeat_mode ?? 0}
          onRecurrenceChange={onRecurrenceChange}
        />
      )}

      <PropertyButton prop="priority" name="Priority" value={mark?.name.replace(' priority', '')} isSet={!!mark} open={is('priority')} haspopup="listbox" buttonRef={priorityRef} onClick={() => onToggle('priority')} unsetLabel="Priority">
        <PriorityMark priority={task.priority} decorative />
        <span>{mark?.name.replace(' priority', '')}</span>
      </PropertyButton>
      {is('priority') && <PriorityPickerPopover anchorRef={priorityRef} currentPriority={task.priority} onPriorityChange={onPriorityChange} onClose={onClose} />}

      <PropertyButton prop="labels" name="Labels" unsetName="Add label" value={labels.map((l) => l.title).join(' ')} isSet={labels.length > 0} open={is('label')} haspopup="dialog" buttonRef={labelRef} onClick={() => onToggle('label')} unsetLabel="Label" className="gap-1.5 px-1.5">
        {labels.map((l) => (
          <Fragment key={l.id}>
            <span className="vicu-chip rounded-chip px-2 py-px text-chip leading-tight" style={labelChipStyle(l.hex_color, isDark)}>
              {l.title}
            </span>
            {/* A space between chips, so the visible text reads as separate words. */}
            {' '}
          </Fragment>
        ))}
      </PropertyButton>
      {is('label') && <LabelPickerPopover anchorRef={labelRef} tasks={[task]} onClose={onClose} />}

      <PropertyButton
        prop="checklist"
        name="Subtasks"
        value={checklistLabel(progress.completed, progress.total)}
        unsetName="Checklist"
        tip={progress.total > 0 ? 'Subtasks' : 'Add subtask'}
        isSet={progress.total > 0}
        open={is('subtasks')}
        buttonRef={subtasksRef}
        onClick={() => onToggle('subtasks')}
        unsetLabel="Checklist"
        icon={<ListChecks className="h-3.5 w-3.5" aria-hidden="true" />}
      >
        <span>{checklistLabel(progress.completed, progress.total)}</span>
      </PropertyButton>

      <PropertyButton prop="reminders" name="Reminders" unsetName="Add reminder" value={reminderText} isSet={reminderCount > 0} open={is('reminder')} haspopup="dialog" buttonRef={reminderRef} onClick={() => onToggle('reminder')} unsetLabel="Reminder" icon={<Bell className="h-3.5 w-3.5" aria-hidden="true" />}>
        <span>{reminderText}</span>
      </PropertyButton>
      {is('reminder') && <ReminderPickerPopover anchorRef={reminderRef} task={task} onReminderChange={onReminderChange} onClose={onClose} />}

      <PropertyButton prop="repeat" name="Repeat" value={repeatText} isSet={repeats} open={is('repeat')} haspopup="dialog" buttonRef={repeatRef} onClick={() => onToggle('repeat')} unsetLabel="Repeat" icon={<Repeat className="h-3.5 w-3.5" aria-hidden="true" />}>
        <span>{repeatText}</span>
      </PropertyButton>
      {is('repeat') && (
        <RecurrencePickerPopover
          anchorRef={repeatRef}
          repeatAfter={task.repeat_after ?? 0}
          repeatMode={task.repeat_mode ?? 0}
          onRecurrenceChange={onRecurrenceChange}
          onClose={onClose}
        />
      )}

      {/* A task always has a project, so this one is always a chip. */}
      <PropertyButton prop="project" name="Move to project" value={project?.title ?? 'Project'} isSet open={is('project')} haspopup="listbox" buttonRef={projectRef} onClick={() => onToggle('project')} icon={<FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />}>
        <span className="max-w-[10rem] truncate">{project?.title ?? 'Project'}</span>
      </PropertyButton>
      {is('project') && <ProjectPickerPopover anchorRef={projectRef} currentProjectId={task.project_id} onSelect={onProjectChange} onClose={onClose} />}

      <PropertyButton
        prop="attachments"
        name="Attachments"
        value={String(attachmentCount)}
        tip={attachmentCount > 0 ? 'Attachments' : 'Attach a file'}
        isSet={attachmentCount > 0}
        open={is('attachment')}
        haspopup="dialog"
        buttonRef={attachmentRef}
        onClick={() => onToggle('attachment')}
        iconOnly={attachmentCount === 0}
        icon={<Paperclip className="h-3.5 w-3.5" aria-hidden="true" />}
      >
        {attachmentCount > 0 && <span>{attachmentCount}</span>}
      </PropertyButton>
      {is('attachment') && <AttachmentPickerPopover anchorRef={attachmentRef} invokedBy={attachmentInvokers} taskId={task.id} onClose={onClose} />}

      <div className="ml-auto">
        <PropertyButton prop="more" name="More" isSet={false} open={is('more') || is('info')} haspopup="menu" buttonRef={moreRef} onClick={() => onToggle('more')} iconOnly icon={<MoreHorizontal className="h-4 w-4" aria-hidden="true" />} />
      </div>
      {is('more') && (
        <Popover anchorRef={moreRef} onClose={onClose} label="More" role="menu" placement="bottom-end" className="w-44 p-1">
          <MenuItem icon={<Info className="h-3.5 w-3.5" aria-hidden="true" />} onSelect={() => onOpen('info')}>
            Task info
          </MenuItem>
          <MenuItem icon={<Trash2 className="h-3.5 w-3.5" aria-hidden="true" />} danger onSelect={onDelete}>
            Delete task
          </MenuItem>
        </Popover>
      )}
      {is('info') && <InfoPopover anchorRef={moreRef} task={task} onClose={onClose} />}
    </div>
  )
}

function MenuItem({ icon, danger, onSelect, children }: { icon: ReactNode; danger?: boolean; onSelect: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      className={cn(
        'flex min-h-7 w-full items-center gap-2 rounded-control px-2 text-left text-task-title transition-colors duration-fade-fast',
        danger ? 'text-danger hover:bg-danger/10' : 'text-text hover:bg-bg-hover',
      )}
    >
      {icon}
      {children}
    </button>
  )
}
