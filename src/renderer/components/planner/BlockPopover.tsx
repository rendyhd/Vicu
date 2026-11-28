import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/shared/Button'
import { Popover } from '@/components/overlay/Popover'
import { TaskCheckbox } from '@/components/task-list/TaskCheckbox'
import { MonthCalendar } from '@/components/task-list/MonthCalendar'
import { cn } from '@/lib/cn'
import { useDateFormat } from '@/hooks/use-date-format'
import { DAY_MINUTES, canPlaceOn, formatLength } from '@/lib/planner-timeline'
import { formatDateDisplay } from '@/lib/date-display'
import type { Task } from '@/lib/vikunja-types'
import { formatBlockRange } from '../../../shared/date-display'
import { addLocalDays, isNoDueDate, isDateOnly, startOfLocalDay, toLocalDate, type LocalDate } from '../../../shared/due-dates'
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
/** Today and the five days after it have a chip of their own; any other day is in the calendar. */
const DAY_CHIPS = 6

interface BlockPopoverProps {
  task: Task
  element: HTMLElement
  canChange: boolean
  defaultLength: number
  onChange: (task: Task, changes: BlockChanges) => void
  onOpenTask?: (task: Task) => void
  /** Move the block to another day at the same times (contract 16.2). Without it there is no Day row. */
  onMoveToDay?: (task: Task, day: LocalDate) => void
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
  onMoveToDay,
  removeLabel,
  canComplete = true,
  onClose,
}: BlockPopoverProps) {
  const { t } = useTranslation()
  const fmt = useDateFormat()
  const anchorRef = useRef<HTMLElement | null>(element)
  const block = blockOf(task)
  const hasDueTime = !isNoDueDate(task.due_date) && !isDateOnly(task.due_date as string)
  const [picking, setPicking] = useState(false)
  const now = new Date()
  const today = toLocalDate(now)
  const dayChips = Array.from({ length: DAY_CHIPS }, (_, i) => addLocalDays(today, i))

  const move = (step: number) => {
    if (!block) return
    const start = Math.max(0, Math.min(DAY_MINUTES - block.minutes, minutesOfDay(block.start) + step))
    onChange(task, placeBlock(task.due_date, atClock(block.day, start), block.minutes))
  }
  const setLength = (minutes: number) => {
    if (!block) return
    onChange(task, resizeBlockEnd(block, new Date(block.start.getTime() + minutes * 60_000)))
  }
  const moveToDay = (day: LocalDate) => {
    setPicking(false)
    if (!block || !onMoveToDay || day === block.day || !canPlaceOn(day, today)) return
    onMoveToDay(task, day)
    onClose()
  }

  return (
    <Popover
      anchorRef={anchorRef}
      label={t('planner.blockPopover.label', { title: task.title })}
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
              {t('planner.blockPopover.due', { when: formatDateDisplay('row', new Date(task.due_date as string), new Date(), false, fmt) })}
            </p>
          )
        )}

        {block && canChange && onMoveToDay && (
          <>
            <p className="mt-3 text-caption text-text-secondary">{t('planner.blockPopover.day')}</p>
            <div className="mt-1 flex flex-wrap gap-1" role="group" aria-label={t('planner.blockPopover.moveToDay')}>
              {dayChips.map((day) => (
                <button
                  key={day}
                  type="button"
                  data-plan-move-day={day}
                  aria-pressed={block.day === day}
                  title={formatDateDisplay('header.full', startOfLocalDay(day), now, true, fmt)}
                  onClick={() => moveToDay(day)}
                  className={cn(
                    'rounded-chip border px-2 py-0.5 text-meta',
                    block.day === day
                      ? 'border-accent-blue bg-accent-blue/12 text-accent-blue'
                      : 'border-border text-text-secondary hover:bg-bg-hover',
                  )}
                >
                  {formatDateDisplay('header.day', startOfLocalDay(day), now, true, fmt)}
                </button>
              ))}
              <button
                type="button"
                data-plan-move-pick
                aria-expanded={picking}
                onClick={() => setPicking((value) => !value)}
                className={cn(
                  'rounded-chip border px-2 py-0.5 text-meta',
                  picking ? 'border-accent-blue text-accent-blue' : 'border-border text-text-secondary hover:bg-bg-hover',
                )}
              >
                {t('planner.blockPopover.pickDate')}
              </button>
            </div>
            {picking && (
              <div
                className="mt-2 border-t border-border pt-2"
                data-plan-move-calendar
                // The arrows move the calendar's focus; the list behind has window-level shortcuts on them.
                onKeyDown={(event) => {
                  if (!event.ctrlKey && !event.metaKey && event.key !== 'Escape') event.stopPropagation()
                }}
              >
                <MonthCalendar
                  selected={block.day}
                  today={today}
                  onPick={moveToDay}
                  isDisabled={(day) => !canPlaceOn(day, today)}
                />
              </div>
            )}
          </>
        )}

        {block && canChange && (
          <>
            <p className="mt-3 text-caption text-text-secondary">{t('planner.blockPopover.length')}</p>
            <div className="mt-1 flex flex-wrap gap-1" role="group" aria-label={t('planner.blockPopover.length')}>
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
              <Button variant="secondary" onClick={() => setLength(Math.max(15, block.minutes - 15))} aria-label={t('planner.blockPopover.shorterLabel')}>
                {t('planner.blockPopover.shorter')}
              </Button>
              <Button variant="secondary" onClick={() => setLength(block.minutes + 15)} aria-label={t('planner.blockPopover.longerLabel')}>
                {t('planner.blockPopover.longer')}
              </Button>
            </div>
            <p className="mt-3 text-caption text-text-secondary">{t('planner.blockPopover.move')}</p>
            <div className="mt-1 flex items-center gap-1">
              <Button variant="secondary" onClick={() => move(-15)} aria-label={t('planner.blockPopover.earlierLabel')}>
                {t('planner.blockPopover.earlier')}
              </Button>
              <Button variant="secondary" onClick={() => move(15)} aria-label={t('planner.blockPopover.laterLabel')}>
                {t('planner.blockPopover.later')}
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
              {t('planner.blockPopover.addBlock', { length: formatLength(defaultLength) })}
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
              {removeLabel ?? t('planner.blockPopover.removeTime')}
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
              {t('planner.blockPopover.openTask')}
            </Button>
          )}
        </div>
      </div>
    </Popover>
  )
}
