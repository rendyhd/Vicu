import type { RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import type { Task } from '@/lib/vikunja-types'
import { formatAbsoluteDateTime, isNullDate } from '@/lib/date-utils'
import { useDateFormat } from '@/hooks/use-date-format'
import { Popover, type PopoverCloseReason } from '../overlay/Popover'

interface InfoPopoverProps {
  anchorRef: RefObject<HTMLElement | null>
  task: Task
  onClose: (reason?: PopoverCloseReason) => void
}

export function InfoPopover({ anchorRef, task, onClose }: InfoPopoverProps) {
  const { t } = useTranslation()
  const identifier = task.identifier && task.identifier.length > 0 ? task.identifier : '—'
  const fmt = useDateFormat()
  const created = formatAbsoluteDateTime(task.created, fmt) || '—'
  const updated = formatAbsoluteDateTime(task.updated, fmt) || '—'

  const creatorName =
    task.created_by && (task.created_by.name?.trim() || task.created_by.username)
  const showCreator = !!creatorName

  const showCompleted = task.done && !isNullDate(task.done_at)
  const completed = showCompleted ? formatAbsoluteDateTime(task.done_at, fmt) : ''

  return (
    <Popover anchorRef={anchorRef} onClose={onClose} role="dialog" label={t('task.info.title')} initialFocus="container" className="w-64 p-3">
      <div className="flex flex-col gap-2">
        <Row label={t('task.info.identifier')} value={identifier} />
        <Row label={t('task.info.created')} value={created} />
        <Row label={t('task.info.updated')} value={updated} />
        {showCreator && <Row label={t('task.info.createdBy')} value={creatorName!} />}
        {showCompleted && <Row label={t('task.info.completed')} value={completed} />}
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
