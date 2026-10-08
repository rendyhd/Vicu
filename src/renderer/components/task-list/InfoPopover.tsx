import type { RefObject } from 'react'
import type { Task } from '@/lib/vikunja-types'
import { formatAbsoluteDateTime, isNullDate } from '@/lib/date-utils'
import { Popover, type PopoverCloseReason } from '../overlay/Popover'

interface InfoPopoverProps {
  anchorRef: RefObject<HTMLElement | null>
  task: Task
  onClose: (reason?: PopoverCloseReason) => void
}

export function InfoPopover({ anchorRef, task, onClose }: InfoPopoverProps) {
  const identifier = task.identifier && task.identifier.length > 0 ? task.identifier : '—'
  const created = formatAbsoluteDateTime(task.created) || '—'
  const updated = formatAbsoluteDateTime(task.updated) || '—'

  const creatorName =
    task.created_by && (task.created_by.name?.trim() || task.created_by.username)
  const showCreator = !!creatorName

  const showCompleted = task.done && !isNullDate(task.done_at)
  const completed = showCompleted ? formatAbsoluteDateTime(task.done_at) : ''

  return (
    <Popover anchorRef={anchorRef} onClose={onClose} label="Task info" initialFocus="container" className="w-64 p-3">
      <div className="flex flex-col gap-2">
        <Row label="Identifier" value={identifier} />
        <Row label="Created" value={created} />
        <Row label="Updated" value={updated} />
        {showCreator && <Row label="Created by" value={creatorName!} />}
        {showCompleted && <Row label="Completed" value={completed} />}
      </div>
    </Popover>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs text-[var(--text-secondary)]">{label}</span>
      <span className="text-right text-xs text-[var(--text-primary)]">{value}</span>
    </div>
  )
}
