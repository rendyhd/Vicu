import { useRef, useState, type RefObject } from 'react'
import { Popover } from '@/components/overlay/Popover'
import { useDateFormat } from '@/hooks/use-date-format'
import { formatBlockRange } from '../../../shared/date-display'

interface DrawTitleProps {
  anchorRef: RefObject<HTMLElement | null>
  start: Date
  end: Date
  /** The project it goes into, for the line under the field. */
  projectName?: string
  onSubmit: (title: string) => void
  onCancel: () => void
}

/** The name of a task drawn on an empty time. Enter adds it; Escape or a press outside drops it. */
export function DrawTitle({ anchorRef, start, end, projectName, onSubmit, onCancel }: DrawTitleProps) {
  const fmt = useDateFormat()
  const [title, setTitle] = useState('')
  const submitted = useRef(false)
  return (
    <Popover
      anchorRef={anchorRef}
      label="New task"
      role="dialog"
      placement="right-start"
      onClose={() => {
        if (!submitted.current) onCancel()
      }}
      className="w-72 p-3"
    >
      <form
        data-plan-draw-title
        onSubmit={(event) => {
          event.preventDefault()
          const text = title.trim()
          if (!text) {
            onCancel()
            return
          }
          submitted.current = true
          onSubmit(text)
        }}
      >
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="New task"
          aria-label="Task title"
          className="w-full rounded-control border border-border bg-transparent px-2 py-1.5 text-task-title text-text placeholder:text-text-secondary"
        />
        <p className="mt-1.5 text-caption text-text-secondary">
          {formatBlockRange(start, end, fmt)}
          {projectName ? ` · ${projectName}` : ''}
        </p>
      </form>
    </Popover>
  )
}
