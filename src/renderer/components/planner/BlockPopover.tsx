import { useRef } from 'react'
import { Button } from '@/components/shared/Button'
import { Popover } from '@/components/overlay/Popover'
import { TaskCheckbox } from '@/components/task-list/TaskCheckbox'
import { cn } from '@/lib/cn'
import { useDateFormat } from '@/hooks/use-date-format'
import { DAY_MINUTES, formatLength } from '@/lib/planner-timeline'
import { formatDateDisplay } from '@/lib/date-display'
import type { Task } from '@/lib/vikunja-types'
import { formatBlockRange } from '../../../shared/date-display'
import { isNoDueDate, isDateOnly, toLocalDate } from '../../../shared/due-dates'
import {
  BLOCK_LENGTHS,
  atClock,
  blockOf,
  minutesOfDay,
  placeBlock,
  removeTime,
  resizeBlockEnd,
  type BlockChanges,
} from '../../../shared/time-blocks'

const LENGTHS = [...BLOCK_LENGTHS, 120]

interface BlockPopoverProps {
  task: Task
  element: HTMLElement
  canChange: boolean
  defaultLength: number
  onChange: (task: Task, changes: BlockChanges) => void
  onOpenTask?: (task: Task) => void
  /** Plan my day keeps a block as a draft: leaving it out of the plan instead of removing a saved time. */
  removeLabel?: string
  /** Off for a draft, which is not a saved block yet. */
  canComplete?: boolean
  onClose: () => void
}

/** Click a block: exact lengths and nudges. A task with only a due time can be given a block here. */
export function BlockPopover({
  task,
  element,
  canChange,
  defaultLength,
  onChange,
  onOpenTask,
  removeLabel = 'Remove time',
  canComplete = true,
  onClose,
}: BlockPopoverProps) {
  const fmt = useDateFormat()
  const anchorRef = useRef<HTMLElement | null>(element)
  const block = blockOf(task)
  const hasDueTime = !isNoDueDate(task.due_date) && !isDateOnly(task.due_date as string)

  const move = (step: number) => {
    if (!block) return
    const start = Math.max(0, Math.min(DAY_MINUTES - block.minutes, minutesOfDay(block.start) + step))
    onChange(task, placeBlock(task.due_date, atClock(block.day, start), block.minutes))
  }
  const setLength = (minutes: number) => {
    if (!block) return
    onChange(task, resizeBlockEnd(block, new Date(block.start.getTime() + minutes * 60_000)))
  }

  return (
    <Popover
      anchorRef={anchorRef}
      label={`Time for ${task.title}`}
      role="dialog"
      placement="right-start"
      onClose={onClose}
      className="w-72 p-3"
    >
      <div data-plan-popover={task.id}>
        <div className="flex min-w-0 items-center gap-2">
          {canChange && canComplete && <TaskCheckbox task={task} />}
          <p className="min-w-0 truncate text-task-title text-text">{task.title}</p>
        </div>
        {block ? (
          <p className="mt-0.5 text-meta text-text-secondary">
            {formatBlockRange(block.start, block.end, fmt)} · {formatLength(block.minutes)}
          </p>
        ) : (
          hasDueTime && (
            <p className="mt-0.5 text-meta text-text-secondary">
              Due {formatDateDisplay('row', new Date(task.due_date as string), new Date(), false, fmt)}
            </p>
          )
        )}

        {block && canChange && (
          <>
            <p className="mt-3 text-caption text-text-secondary">Length</p>
            <div className="mt-1 flex flex-wrap gap-1" role="group" aria-label="Length">
              {LENGTHS.map((minutes) => (
                <button
                  key={minutes}
                  type="button"
                  aria-pressed={block.minutes === minutes}
                  onClick={() => setLength(minutes)}
                  className={cn(
                    'rounded-chip border px-2 py-0.5 text-meta',
                    block.minutes === minutes
                      ? 'border-accent-blue bg-accent-blue/12 text-accent-blue'
                      : 'border-border text-text-secondary hover:bg-bg-hover',
                  )}
                >
                  {formatLength(minutes)}
                </button>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-1">
              <Button variant="secondary" onClick={() => setLength(Math.max(15, block.minutes - 15))} aria-label="15 minutes shorter">
                Shorter
              </Button>
              <Button variant="secondary" onClick={() => setLength(block.minutes + 15)} aria-label="15 minutes longer">
                Longer
              </Button>
            </div>
            <p className="mt-3 text-caption text-text-secondary">Move</p>
            <div className="mt-1 flex items-center gap-1">
              <Button variant="secondary" onClick={() => move(-15)} aria-label="15 minutes earlier">
                Earlier
              </Button>
              <Button variant="secondary" onClick={() => move(15)} aria-label="15 minutes later">
                Later
              </Button>
            </div>
          </>
        )}

        <div className="mt-3 flex flex-wrap items-center justify-end gap-1">
          {!block && hasDueTime && canChange && (
            <Button
              variant="secondary"
              onClick={() => {
                const due = new Date(task.due_date as string)
                onChange(task, placeBlock(task.due_date, atClock(toLocalDate(due), minutesOfDay(due)), defaultLength))
                onClose()
              }}
            >
              Add {formatLength(defaultLength)} block
            </Button>
          )}
          {block && canChange && (
            <Button
              variant="quiet"
              onClick={() => {
                onChange(task, removeTime(task))
                onClose()
              }}
            >
              {removeLabel}
            </Button>
          )}
          {onOpenTask && (
            <Button
              variant="quiet"
              onClick={() => {
                onOpenTask(task)
                onClose()
              }}
            >
              Open task
            </Button>
          )}
        </div>
      </div>
    </Popover>
  )
}
