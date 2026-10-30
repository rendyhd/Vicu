import { Fragment, useRef, type ReactNode, type RefObject } from 'react'
import { Calendar, CalendarClock, Bell, Repeat, Paperclip, ListChecks, FolderOpen, MoreHorizontal, Info, Trash2, Plus, MessageSquare, Clock3 } from 'lucide-react'
import { cn } from '@/lib/cn'
import { isNullDate } from '@/lib/date-utils'
import { labelChipSolidStyle } from '@/lib/label-style'
import { checklistLabel } from '@/lib/row-anatomy'
import { formatRecurrenceLabel } from '@/lib/recurrence'
import { formatDueDate } from '@/lib/date-utils'
import { useDateFormat } from '@/hooks/use-date-format'
import { subtaskProgress } from '@/lib/task-hierarchy'
import { useIsDark } from '@/hooks/use-is-dark'
import { useProjects } from '@/hooks/use-projects'
import { useLocationReminders } from '@/hooks/use-location-reminders'
import { assignChipLabel, nameList, orderPeople } from '@/lib/collaboration'
import type { ProjectAccess } from '@/hooks/use-project-access'
import { commentsButtonId } from '@/stores/comments-pane-store'
import type { PersonRef, Task, TaskReminder } from '@/lib/vikunja-types'
import { priorityMark } from '../../../shared/priority-mark-svg'
import { locationReminderLabel } from '../../../shared/synced-prefs'
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
import { AssignPopover } from './AssignPopover'
import { AvatarStack } from '../shared/Avatar'
import { formatTaskDuration, parseTaskDuration } from '@/lib/task-duration'
import { DurationPickerPopover } from './DurationPickerPopover'

/** The one editor of the card that is open, if any. */
export type CardPopover =
  | 'date'
  | 'start'
  | 'priority'
  | 'duration'
  | 'label'
  | 'subtasks'
  | 'reminder'
  | 'repeat'
  | 'attachment'
  | 'project'
  | 'assign'
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
  onStartDateChange: (isoDate: string) => void
  onDurationChange: (minutes: number | null) => void
  onRecurrenceChange: (repeatAfter: number, repeatMode: number) => void
  onPriorityChange: (priority: number) => void
  onReminderChange: (reminders: TaskReminder[]) => void
  onProjectChange: (projectId: number) => void
  onDelete: () => void
  /** Collaboration on the task's project; Assign and Comments only show while it is shared. */
  collab?: CardCollab
}

export interface CardCollab {
  access: ProjectAccess
  me: PersonRef | null
  /** The comments pane is showing this task's thread. */
  commentsOpen: boolean
  onToggleComments: () => void
}

const BUTTON = 'inline-flex min-h-7 shrink-0 items-center gap-1 rounded-control px-2 text-meta transition-colors duration-fade-fast'
const SET = 'border border-[var(--border-color)] text-text hover:bg-bg-hover'
const UNSET = 'border border-transparent text-text-secondary hover:bg-bg-hover hover:text-text'
const OPEN = 'border border-transparent bg-bg-selected text-accent-blue'

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
 * The properties of an open card: date, start time, duration, priority, labels, checklist,
 * reminder, repeat, project, assign, attachments, then comments and
 * More on the right. Assign and Comments exist only on a shared project. A set property is a chip
 * that opens its editor; an unset one is a quiet "+" button that does the same. Task info and
 * Delete live under More. Each button has a tooltip (400 ms, with its shortcut where there is one).
 */
export function TaskCardBar({
  task,
  active,
  onToggle,
  onOpen,
  onClose,
  attachmentInvokers,
  onDateChange,
  onStartDateChange,
  onDurationChange,
  onRecurrenceChange,
  onPriorityChange,
  onReminderChange,
  onProjectChange,
  onDelete,
  collab,
}: TaskCardBarProps) {
  const isDark = useIsDark()
  const dateFormat = useDateFormat()
  const { data: projects } = useProjects()
  const { reminderFor } = useLocationReminders()
  const dateRef = useRef<HTMLButtonElement>(null)
  const startRef = useRef<HTMLButtonElement>(null)
  const durationRef = useRef<HTMLButtonElement>(null)
  const priorityRef = useRef<HTMLButtonElement>(null)
  const labelRef = useRef<HTMLButtonElement>(null)
  const subtasksRef = useRef<HTMLButtonElement>(null)
  const reminderRef = useRef<HTMLButtonElement>(null)
  const repeatRef = useRef<HTMLButtonElement>(null)
  const projectRef = useRef<HTMLButtonElement>(null)
  const attachmentRef = useRef<HTMLButtonElement>(null)
  const moreRef = useRef<HTMLButtonElement>(null)
  const assignRef = useRef<HTMLButtonElement>(null)

  const labels = task.labels ?? []
  const hasDate = !isNullDate(task.due_date)
  const hasStartTime = !isNullDate(task.start_date)
  const durationMinutes = parseTaskDuration(task.description)
  const mark = priorityMark(task.priority)
  const progress = subtaskProgress(task)
  const placeReminder = reminderFor(task.id)
  const reminderCount = (task.reminders?.length ?? 0) + (placeReminder ? 1 : 0)
  const repeats = (task.repeat_after ?? 0) > 0 || (task.repeat_mode ?? 0) > 0
  const attachmentCount = task.attachments?.length ?? 0
  const project = projects?.flat.find((p) => p.id === task.project_id)
  const dueText = hasDate ? (formatDueDate(task.due_date, new Date(), dateFormat, 'row') ?? '') : ''
  const startTimeText = hasStartTime ? (formatDueDate(task.start_date, new Date(), dateFormat, 'row') ?? '') : ''
  const repeatText = formatRecurrenceLabel(task.repeat_after ?? 0, task.repeat_mode ?? 0)
  // A location reminder alone reads as its place ("Arrive: Home"), as on the phone.
  const reminderText = placeReminder && reminderCount === 1
    ? locationReminderLabel(placeReminder.trigger, placeReminder.placeName)
    : reminderCount === 1 ? '1 reminder' : `${reminderCount} reminders`
  const is = (p: OpenPopover) => active === p
  const shared = !!collab?.access.shared
  const me = collab?.me ?? null
  const assignees = shared ? orderPeople(task.assignees ?? [], me?.id) : []
  // Read-only members see who is assigned but cannot change it (section 9.2).
  const canAssign = shared && collab!.access.permission >= 1
  const commentCount = task.comment_count ?? 0

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

      <PropertyButton
        prop="start_time"
        name="Start time"
        value={startTimeText}
        isSet={hasStartTime}
        open={is('start')}
        haspopup="dialog"
        buttonRef={startRef}
        onClick={() => onToggle('start')}
        unsetLabel="Start time"
        icon={<CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />}
      >
        <span>{startTimeText}</span>
      </PropertyButton>
      {is('start') && (
        <WhenPopover
          anchorRef={startRef}
          label="Start time"
          clearLabel="Clear start time"
          currentDate={task.start_date}
          onDateChange={onStartDateChange}
          onClose={onClose}
        />
      )}

      <PropertyButton
        prop="duration"
        name="Duration"
        value={durationMinutes === null ? undefined : formatTaskDuration(durationMinutes)}
        isSet={durationMinutes !== null}
        open={is('duration')}
        haspopup="dialog"
        buttonRef={durationRef}
        onClick={() => onToggle('duration')}
        unsetLabel="Duration"
        icon={<Clock3 className="h-3.5 w-3.5" aria-hidden="true" />}
      >
        {durationMinutes !== null && <span>{formatTaskDuration(durationMinutes)}</span>}
      </PropertyButton>
      {is('duration') && (
        <DurationPickerPopover
          anchorRef={durationRef}
          durationMinutes={durationMinutes}
          onDurationChange={onDurationChange}
          onClose={onClose}
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
            <span className="vicu-chip rounded-chip px-2 py-px text-chip leading-tight" style={labelChipSolidStyle(l.hex_color, isDark)}>
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
        unsetName="Add subtask"
        tip={progress.total > 0 ? 'Subtasks' : 'Add subtask'}
        isSet={progress.total > 0}
        open={is('subtasks')}
        buttonRef={subtasksRef}
        onClick={() => onToggle('subtasks')}
        unsetLabel="Subtasks"
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

      {canAssign && (
        <PropertyButton
          prop="assign"
          name="Assigned"
          unsetName="Assign"
          value={nameList(assignees, me?.id)}
          tip={assignees.length > 0 ? assignChipLabel(assignees, me?.id) : 'Assign'}
          isSet={assignees.length > 0}
          open={is('assign')}
          haspopup="listbox"
          buttonRef={assignRef}
          onClick={() => onToggle('assign')}
          unsetLabel="Assign"
          className={assignees.length > 0 ? 'gap-1.5 pl-1' : undefined}
          icon={<AvatarStack people={assignees} size={16} max={3} surface="card" />}
        >
          <span className="max-w-[12rem] truncate">{nameList(assignees, me?.id)}</span>
        </PropertyButton>
      )}
      {shared && !canAssign && assignees.length > 0 && (
        <span data-prop="assign" aria-label={assignChipLabel(assignees, me?.id)} role="img" className={cn(BUTTON, 'gap-1.5 pl-1 border border-[var(--border-color)] text-text')}>
          <AvatarStack people={assignees} size={16} max={3} surface="card" />
          <span className="max-w-[12rem] truncate">{nameList(assignees, me?.id)}</span>
        </span>
      )}
      {is('assign') && collab && (
        <AssignPopover anchorRef={assignRef} task={task} members={collab.access.members} me={me} projectTitle={project?.title ?? 'this project'} onClose={onClose} />
      )}

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

      <div className="ml-auto flex items-center gap-1">
        {shared && collab && <CommentsButton taskId={task.id} count={commentCount} unread={!!task.is_unread} open={collab.commentsOpen} onClick={collab.onToggleComments} />}
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

/**
 * Shows and hides the comments pane beside the card (collaboration D3). Icon only without comments;
 * with them, a chip with the count; while the pane is open it takes the open style. The unread dot
 * shows until the pane is open.
 */
function CommentsButton({ taskId, count, unread, open, onClick }: { taskId: number; count: number; unread: boolean; open: boolean; onClick: () => void }) {
  const label = count === 0 ? 'Comments' : `Comments, ${count}${unread ? ', new' : ''}`
  return (
    <Tooltip label="Comments" shortcut="Mod+Shift+C">
      <button
        id={commentsButtonId(taskId)}
        type="button"
        data-prop="comments"
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? 'comments-pane' : undefined}
        onClick={onClick}
        className={cn(BUTTON, count === 0 && 'w-7 justify-center px-0', open ? OPEN : count > 0 ? SET : UNSET)}
      >
        <span className="relative inline-flex">
          <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
          {unread && !open && (
            <span aria-hidden="true" className="vicu-unread-dot absolute -right-[3px] -top-[2px] h-1.5 w-1.5 rounded-full bg-accent-blue" style={{ boxShadow: '0 0 0 1.5px var(--bg-card)' }} />
          )}
        </span>
        {count > 0 && <span className={cn(unread && !open && 'font-semibold')}>{count}</span>}
      </button>
    </Tooltip>
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
