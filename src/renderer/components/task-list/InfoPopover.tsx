import { useRef, useEffect } from 'react'
import type { Task } from '@/lib/vikunja-types'
import { formatAbsoluteDateTime, isNullDate } from '@/lib/date-utils'

interface InfoPopoverProps {
  task: Task
  onClose: () => void
}

export function InfoPopover({ task, onClose }: InfoPopoverProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onClose])

  const identifier = task.identifier && task.identifier.length > 0 ? task.identifier : '—'
  const created = formatAbsoluteDateTime(task.created) || '—'
  const updated = formatAbsoluteDateTime(task.updated) || '—'

  const creatorName =
    task.created_by && (task.created_by.name?.trim() || task.created_by.username)
  const showCreator = !!creatorName

  const showCompleted = task.done && !isNullDate(task.done_at)
  const completed = showCompleted ? formatAbsoluteDateTime(task.done_at) : ''

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full z-50 mt-1 w-64 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 shadow-lg"
    >
      <div className="flex flex-col gap-2">
        <Row label="Identifier" value={identifier} />
        <Row label="Created" value={created} />
        <Row label="Updated" value={updated} />
        {showCreator && <Row label="Created by" value={creatorName!} />}
        {showCompleted && <Row label="Completed" value={completed} />}
      </div>
    </div>
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
