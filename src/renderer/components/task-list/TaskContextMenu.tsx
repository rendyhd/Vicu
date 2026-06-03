import { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { Check } from 'lucide-react'
import { cn } from '@/lib/cn'
import { isNullDate } from '@/lib/date-utils'
import { normalizeHex } from '@/lib/constants'
import { useAppConfig } from '@/hooks/use-app-config'
import { useTaskActions } from '@/hooks/use-task-actions'
import { useProjects } from '@/hooks/use-projects'
import { useLabels } from '@/hooks/use-labels'
import type { Task } from '@/lib/vikunja-types'
import { DatePickerPopover } from './DatePickerPopover'
import { ProjectPickerPopover } from './ProjectPickerPopover'
import { LabelPickerPopover } from './LabelPickerPopover'
import { PRIORITY_OPTIONS } from './PriorityPickerPopover'

interface TaskContextMenuProps {
  task: Task
  x: number
  y: number
  onClose: () => void
}

type SubMenu = 'date' | 'project' | 'label' | null

const itemClass =
  'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'

function Divider() {
  return <div className="my-1 h-px bg-[var(--border-color)]" />
}

export function TaskContextMenu({ task, x, y, onClose }: TaskContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const { data: config } = useAppConfig()
  const { data: projectData } = useProjects()
  const { data: labels } = useLabels()
  const actions = useTaskActions(task)

  const [sub, setSub] = useState<SubMenu>(null)
  const [pos, setPos] = useState({ left: x, top: y })
  const [measured, setMeasured] = useState(false)

  // Position at the cursor, flipping left/up when the menu would overflow.
  // Rendered hidden until measured so it never flashes at an overflowing spot.
  useLayoutEffect(() => {
    const el = menuRef.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const m = 8
    let left = x
    let top = y
    if (x + width > window.innerWidth - m) left = Math.max(m, x - width)
    if (y + height > window.innerHeight - m) top = Math.max(m, y - height)
    setPos({ left, top })
    setMeasured(true)
  }, [x, y])

  // Close on outside mousedown + Escape. Using mousedown (the same phase the
  // nested popovers use) means a click inside an open popover — which lives
  // inside menuRef — is ignored here, so the popover alone decides.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const closeSubAndMenu = () => {
    setSub(null)
    onClose()
  }

  const run = (fn: () => void) => () => {
    fn()
    onClose()
  }

  const urgencyImportant = config?.urgency_mode === 'important'

  const lastProjectId = config?.last_used_project_id
  const lastProject =
    lastProjectId != null ? projectData?.flat.find((p) => p.id === lastProjectId) : undefined

  const lastLabelId = config?.last_used_label_id
  const lastLabel = lastLabelId != null ? labels?.find((l) => l.id === lastLabelId) : undefined

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[200px] rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] py-1 shadow-lg"
      style={{ left: pos.left, top: pos.top, visibility: measured ? 'visible' : 'hidden' }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Adaptive top item — driven by the "What does urgent mean?" setting */}
      <button
        type="button"
        className={itemClass}
        onClick={run(urgencyImportant ? actions.setUrgentPriority : actions.setDueToday)}
      >
        {urgencyImportant ? 'Set Important' : 'Set Today'}
      </button>

      <Divider />

      {/* Date */}
      <button type="button" className={itemClass} onClick={run(actions.postponeTomorrow)}>
        Postpone to tomorrow
      </button>
      <button type="button" className={itemClass} onClick={run(actions.postponeNextMonday)}>
        Postpone to next Monday
      </button>
      <div className="relative">
        <button
          type="button"
          className={itemClass}
          onClick={() => setSub((s) => (s === 'date' ? null : 'date'))}
        >
          Schedule…
        </button>
        {sub === 'date' && (
          <DatePickerPopover
            currentDate={task.due_date}
            onDateChange={actions.setDueDateIso}
            onClose={closeSubAndMenu}
          />
        )}
      </div>
      {!isNullDate(task.due_date) && (
        <button type="button" className={itemClass} onClick={run(actions.clearDate)}>
          Clear date
        </button>
      )}

      <Divider />

      {/* Priority */}
      {PRIORITY_OPTIONS.filter((o) => o.value > 0).map((option) => (
        <button
          key={option.value}
          type="button"
          className={itemClass}
          onClick={run(() => actions.setPriority(option.value))}
        >
          <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', option.dot)} />
          <span className="min-w-0 flex-1 truncate">{option.label}</span>
          {task.priority === option.value && (
            <Check className="h-3.5 w-3.5 shrink-0 text-[var(--accent-blue)]" />
          )}
        </button>
      ))}
      {(task.priority ?? 0) > 0 && (
        <button type="button" className={itemClass} onClick={run(actions.clearPriority)}>
          <span className="h-2.5 w-2.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">Clear priority</span>
        </button>
      )}

      <Divider />

      {/* Project */}
      {lastProject && lastProject.id !== task.project_id && (
        <button
          type="button"
          className={itemClass}
          onClick={run(() => actions.moveToProject(lastProject.id))}
        >
          <span className="min-w-0 flex-1 truncate">{`Move to "${lastProject.title}"`}</span>
        </button>
      )}
      <div className="relative">
        <button
          type="button"
          className={itemClass}
          onClick={() => setSub((s) => (s === 'project' ? null : 'project'))}
        >
          Move to project…
        </button>
        {sub === 'project' && (
          <ProjectPickerPopover
            task={task}
            onPicked={actions.recordLastProject}
            onClose={closeSubAndMenu}
          />
        )}
      </div>

      <Divider />

      {/* Labels */}
      {lastLabel && !(task.labels ?? []).some((l) => l.id === lastLabel.id) && (
        <button
          type="button"
          className={itemClass}
          onClick={run(() => actions.applyLabel(lastLabel.id))}
        >
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: normalizeHex(lastLabel.hex_color) || 'var(--text-secondary)' }}
          />
          <span className="min-w-0 flex-1 truncate">{`Apply "${lastLabel.title}"`}</span>
        </button>
      )}
      <div className="relative">
        <button
          type="button"
          className={itemClass}
          onClick={() => setSub((s) => (s === 'label' ? null : 'label'))}
        >
          Apply label…
        </button>
        {sub === 'label' && (
          <LabelPickerPopover
            taskId={task.id}
            currentLabels={task.labels ?? []}
            onApplied={actions.recordLastLabel}
            onClose={closeSubAndMenu}
          />
        )}
      </div>
    </div>
  )
}
