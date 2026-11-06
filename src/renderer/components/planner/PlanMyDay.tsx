import { useState } from 'react'
import { Sparkles, Sun, Undo2 } from 'lucide-react'
import { Button } from '@/components/shared/Button'
import { Checkbox } from '@/components/shared/Checkbox'
import { cn } from '@/lib/cn'
import { normalizeHex } from '@/lib/constants'
import { formatDateDisplay } from '@/lib/date-display'
import { formatLength, plannedMinutes } from '@/lib/planner-timeline'
import { useDateFormat } from '@/hooks/use-date-format'
import { useProjects } from '@/hooks/use-projects'
import { PLAN_STEPS, usePlanSession, type PlanSession } from '@/hooks/use-plan-session'
import type { Task } from '@/lib/vikunja-types'
import { formatBlockRange } from '../../../shared/date-display'
import { isDateOnly, isNoDueDate, isOverdue, localDateOf, startOfLocalDay, type LocalDate } from '../../../shared/due-dates'
import { atClock, blockOf, busyOfDay, freeMinutes } from '../../../shared/time-blocks'
import type { LeftoverAction } from '../../../shared/plan-day'
import { Timeline } from './Timeline'
import { BlockPopover } from './BlockPopover'

const LEFTOVER_BUTTONS: { action: LeftoverAction; label: string }[] = [
  { action: 'today', label: 'Today' },
  { action: 'tomorrow', label: 'Tomorrow' },
  { action: 'no_date', label: 'No date' },
  { action: 'done', label: 'Done' },
]

const SUGGESTED = 'border-dashed border-accent-blue'

function dayName(day: LocalDate, session: PlanSession, fmt: ReturnType<typeof useDateFormat>): string {
  if (day === session.today) return 'Today'
  if (day === session.tomorrow) return 'Tomorrow'
  return startOfLocalDay(day).toLocaleDateString(fmt.locale, { weekday: 'long' })
}

function WhyLine({ text }: { text: string }) {
  return (
    <span className="flex min-w-0 items-start gap-1 text-caption text-accent-blue">
      <Sparkles className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
      <span className="min-w-0">{text}</span>
    </span>
  )
}

function TaskMeta({ task }: { task: Task }) {
  const fmt = useDateFormat()
  const { data: projects } = useProjects()
  const project = projects?.flat.find((candidate) => candidate.id === task.project_id)
  const now = new Date()
  const hasDue = !isNoDueDate(task.due_date)
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2 text-caption text-text-secondary">
      {project && (
        <span className="flex min-w-0 items-center gap-1">
          <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: normalizeHex(project.hex_color) ?? 'var(--text-secondary)' }} />
          <span className="truncate">{project.title}</span>
        </span>
      )}
      {hasDue && (
        <span className={cn(isOverdue(task.due_date, now) && 'text-status-overdue')}>
          {formatDateDisplay('row', new Date(task.due_date as string), now, isDateOnly(task.due_date as string), fmt)}
        </span>
      )}
    </span>
  )
}

function LeftoversStep({ session }: { session: PlanSession }) {
  const suggested = session.leftovers.filter((task) => session.leftoverSuggestion.has(task.id) && !session.handled.has(task.id))
  return (
    <>
      <p className="text-caption text-text-secondary">Unfinished tasks from before. Nothing moves on its own: decide each one, or skip.</p>
      {session.assistantActive && suggested.length > 1 && (
        <button
          type="button"
          data-plan-apply-all
          onClick={() => {
            for (const task of suggested) session.doLeftover(task, session.leftoverSuggestion.get(task.id)!.action)
          }}
          className={cn('flex items-center gap-1 justify-self-start rounded-chip border px-2 py-1 text-meta text-accent-blue hover:bg-bg-hover', SUGGESTED)}
        >
          <Sparkles className="h-3 w-3" aria-hidden="true" />
          Apply the {suggested.length} suggestions
        </button>
      )}
      {session.leftoverRows.length === 0 && <p className="py-4 text-center text-meta text-text-secondary">Nothing left over.</p>}
      {session.leftoverRows.map((task) => {
        const done = session.handled.get(task.id)
        const suggestion = done ? undefined : session.leftoverSuggestion.get(task.id)
        return (
          <div key={task.id} data-plan-leftover={task.id} className={cn('grid gap-1 rounded-control border border-border p-2', done && 'opacity-60')}>
            <span className="min-w-0 truncate text-meta font-medium text-text">{task.title}</span>
            <TaskMeta task={task} />
            {suggestion && suggestion.reason && <WhyLine text={suggestion.reason} />}
            {done ? (
              <span className="text-caption text-text-secondary">{done.label}</span>
            ) : (
              <div className="mt-0.5 flex flex-wrap gap-1">
                {LEFTOVER_BUTTONS.map(({ action, label }) => (
                  <button
                    key={action}
                    type="button"
                    data-plan-leftover-action={action}
                    onClick={() => session.doLeftover(task, action)}
                    className={cn(
                      'rounded-chip border border-border px-2 py-0.5 text-meta text-text hover:bg-bg-hover',
                      suggestion?.action === action && SUGGESTED,
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}

function LengthChip({ session, id }: { session: PlanSession; id: number }) {
  const minutes = session.draftOf.get(id) && session.step === 2
    ? session.draftOf.get(id)!.end - session.draftOf.get(id)!.start
    : session.lengthOf(id)
  const suggested = session.assistantActive && session.lengthIsSuggested(id)
  return (
    <button
      type="button"
      data-plan-length-chip={id}
      aria-label={`Length ${formatLength(minutes)}. Change it.`}
      title={suggested ? "The assistant's estimate. Click to change." : 'Click to change the length'}
      onClick={(event) => {
        event.stopPropagation()
        event.preventDefault()
        session.cycleLength(id)
      }}
      className={cn('shrink-0 rounded-chip border border-border px-1.5 py-0.5 text-caption text-text-secondary hover:bg-bg-hover', suggested && SUGGESTED)}
    >
      {formatLength(minutes)}
    </button>
  )
}

function CandidateRow({ session, task, suggested, reason }: { session: PlanSession; task: Task; suggested?: boolean; reason?: string }) {
  const placed = blockOf(task)?.day === session.day
  return (
    <label
      data-plan-candidate={task.id}
      className={cn(
        'flex cursor-pointer items-start gap-2 rounded-control border border-transparent px-1.5 py-1 hover:bg-bg-hover',
        session.ticked.has(task.id) && 'bg-bg-selected',
        suggested && SUGGESTED,
      )}
    >
      <Checkbox checked={session.ticked.has(task.id)} onChange={() => session.toggleTick(task.id)} className="mt-0.5" />
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="truncate text-meta text-text">{task.title}</span>
        <TaskMeta task={task} />
        {reason && <WhyLine text={reason} />}
      </span>
      {!placed && <LengthChip session={session} id={task.id} />}
    </label>
  )
}

function GroupHeading({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 text-caption font-medium text-text-secondary first:mt-0">{children}</p>
}

function ChooseStep({ session }: { session: PlanSession }) {
  const fmt = useDateFormat()
  const { data: projects } = useProjects()
  const { meter } = session
  const name = dayName(session.day, session, fmt)
  const lowerName = name.toLowerCase()
  const nextDay = dayName(addDays(session.day, 1), session, fmt).toLowerCase()

  const on = new Set([...session.onDay, ...session.inboxTasks, ...session.comingUp].map((task) => task.id))
  const suggestedAdds = session.assistantActive
    ? [...session.pickOf.values()].filter((pick) => !session.ticked.has(pick.task_id) && on.has(pick.task_id)).slice(0, 3)
    : []
  const suggestedIds = new Set(suggestedAdds.map((pick) => pick.task_id))

  const percent = (minutes: number) => `${Math.min(100, (minutes / Math.max(1, meter.free)) * 100)}%`

  return (
    <>
      <div className="grid gap-1 rounded-control border border-border p-2" data-plan-meter>
        <p className="text-meta font-medium text-text">
          {meter.tasks} {meter.tasks === 1 ? 'task' : 'tasks'} · {formatLength(meter.toPlace)} to place · {formatLength(meter.free)} free
        </p>
        <div aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-bg-hover">
          <div className={cn('h-full rounded-full', meter.over > 0 ? 'bg-status-overdue' : 'bg-accent-blue')} style={{ width: percent(meter.toPlace) }} />
        </div>
        {meter.over > 0 ? (
          <p className="text-caption text-status-overdue">About {formatLength(meter.over)} more than your free time.</p>
        ) : (
          <p className="text-caption text-text-secondary">
            Free time inside your work hours ({session.prefs.hours[0]}–{session.prefs.hours[1]}){session.day === session.today ? ', from now' : ''}.
          </p>
        )}
        {session.assistantActive && meter.over > 0 &&
          session.canWait
            .filter((item) => session.ticked.has(item.task_id) && session.byId.has(item.task_id))
            .map((item) => {
              const task = session.byId.get(item.task_id)!
              return (
                <div key={item.task_id} data-plan-can-wait={item.task_id} className="flex items-center gap-1">
                  <span className="min-w-0 flex-1">
                    <WhyLine text={`Move ${task.title} to ${nextDay}${item.reason ? `: ${item.reason}` : ''}`} />
                  </span>
                  <button
                    type="button"
                    onClick={() => session.moveToNextDay(task)}
                    className={cn('shrink-0 rounded-chip border px-2 py-0.5 text-caption text-accent-blue', SUGGESTED)}
                  >
                    Move
                  </button>
                </div>
              )
            })}
        {session.assistantActive && (
          <div className="flex items-center gap-2 pt-0.5">
            {session.suggestions.loading && <span className="text-caption text-text-secondary">Asking for suggestions…</span>}
            {session.suggestions.failure && <span className="text-caption text-text-secondary">{session.suggestions.failure}</span>}
            {!session.suggestions.loading && (
              <button type="button" data-plan-ask-again onClick={session.suggestions.askAgain} className="text-caption text-accent-blue hover:underline">
                Ask again
              </button>
            )}
          </div>
        )}
      </div>

      <GroupHeading>{name}</GroupHeading>
      {session.onDay.length === 0 && <p className="px-1.5 text-caption text-text-secondary">Nothing yet.</p>}
      {session.onDay.map((task) => (
        <CandidateRow key={task.id} session={session} task={task} reason={session.assistantActive ? session.pickOf.get(task.id)?.reason : undefined} />
      ))}

      {suggestedAdds.length > 0 && (
        <>
          <GroupHeading>Suggested</GroupHeading>
          {suggestedAdds.flatMap((pick) => {
            const task = session.byId.get(pick.task_id)
            return task ? [<CandidateRow key={task.id} session={session} task={task} suggested reason={pick.reason} />] : []
          })}
        </>
      )}

      {session.inboxTasks.some((task) => !suggestedIds.has(task.id)) && <GroupHeading>Inbox</GroupHeading>}
      {session.inboxTasks.filter((task) => !suggestedIds.has(task.id)).map((task) => (
        <CandidateRow key={task.id} session={session} task={task} />
      ))}

      {session.comingUp.some((task) => !suggestedIds.has(task.id)) && <GroupHeading>Coming up</GroupHeading>}
      {session.comingUp.filter((task) => !suggestedIds.has(task.id)).map((task) => (
        <CandidateRow key={task.id} session={session} task={task} />
      ))}

      <div className="mt-2 flex items-center gap-2">
        <p className="text-caption font-medium text-text-secondary">From a project</p>
        <select
          aria-label="Project"
          data-plan-project
          value={session.projectId ?? ''}
          onChange={(event) => session.setProjectId(event.target.value ? Number(event.target.value) : null)}
          className="min-w-0 flex-1 rounded-control border border-border bg-bg-card px-1.5 py-0.5 text-caption text-text"
        >
          <option value="">Pick one</option>
          {(projects?.flat ?? []).map((project) => (
            <option key={project.id} value={project.id}>
              {project.title}
            </option>
          ))}
        </select>
      </div>
      {session.projectId !== null && session.fromProject.length === 0 && (
        <p className="px-1.5 text-caption text-text-secondary">Nothing else open in this project.</p>
      )}
      {session.fromProject.map((task) => (
        <CandidateRow key={task.id} session={session} task={task} />
      ))}
    </>
  )
}

function addDays(day: LocalDate, days: number): LocalDate {
  const date = startOfLocalDay(day)
  date.setDate(date.getDate() + days)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function ArrangeStep({ session }: { session: PlanSession }) {
  const fmt = useDateFormat()
  const name = dayName(session.day, session, fmt).toLowerCase()
  const planned = session.chosen.filter((task) => blockOf(task)?.day === session.day)
  return (
    <>
      {session.assistantActive && session.suggestions.result && (
        <div role="radiogroup" aria-label="Order" className="flex justify-self-start rounded-full border border-border p-0.5">
          {([
            ['assistant', "Assistant's order"],
            ['first', 'First free slots'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={session.arrangeBy === value}
              data-plan-arrange={value}
              onClick={() => session.setArrangeBy(value)}
              className={cn('rounded-full px-2 py-0.5 text-caption', session.arrangeBy === value ? 'bg-bg-selected text-text' : 'text-text-secondary')}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <p className="text-caption text-text-secondary">
        The dashed blocks are a draft. Drag them, or drag their edges to change the length. Nothing is saved until you accept.
      </p>
      {session.toPlaceAll.map((task) => {
        const placed = session.draftOf.get(task.id)
        const kept = session.keep.has(task.id)
        return (
          <div key={task.id} data-plan-arrange-row={task.id} className="flex items-start gap-2 rounded-control border border-border p-2">
            <span className="grid min-w-0 flex-1 gap-0.5">
              <span className="truncate text-meta text-text">{task.title}</span>
              {kept ? (
                <span className="text-caption text-text-secondary">No time, on {name}</span>
              ) : placed ? (
                <span className="text-caption text-accent-blue">{formatBlockRange(atClock(session.day, placed.start), atClock(session.day, placed.end), fmt)}</span>
              ) : (
                <span className="text-caption text-status-overdue">No free slot left</span>
              )}
              {!kept && placed?.reason && session.assistantActive && <WhyLine text={placed.reason} />}
            </span>
            {!kept && <LengthChip session={session} id={task.id} />}
            <button
              type="button"
              aria-pressed={kept}
              data-plan-keep={task.id}
              onClick={() => session.toggleKeep(task.id)}
              className={cn('shrink-0 rounded-chip border px-1.5 py-0.5 text-caption', kept ? 'border-accent-blue bg-accent-blue/12 text-accent-blue' : 'border-border text-text-secondary hover:bg-bg-hover')}
            >
              No time
            </button>
          </div>
        )
      })}
      {planned.length > 0 && (
        <>
          <GroupHeading>Already planned</GroupHeading>
          {planned.map((task) => {
            const block = blockOf(task)!
            return (
              <div key={task.id} className="flex items-center gap-2 rounded-control border border-border p-2">
                <span className="min-w-0 flex-1 truncate text-meta text-text">{task.title}</span>
                <span className="shrink-0 text-caption text-text-secondary">{formatBlockRange(block.start, block.end, fmt)}</span>
              </div>
            )
          })}
        </>
      )}
    </>
  )
}

function ReadyStep({ session, onDone }: { session: PlanSession; onDone: () => void }) {
  const fmt = useDateFormat()
  const tasks = session.range.tasks.filter((task) => !task.done)
  const withTime = tasks
    .filter((task) => blockOf(task)?.day === session.day)
    .sort((a, b) => blockOf(a)!.start.getTime() - blockOf(b)!.start.getTime())
  const withoutTime = session.onDay.filter((task) => blockOf(task)?.day !== session.day && !task.done)
  const free = freeMinutes(new Date(), session.day, session.prefs.hours, busyOfDay(session.range.tasks, session.day))
  return (
    <div className="grid gap-1.5" data-plan-ready>
      <p className="text-section text-text">{dayName(session.day, session, fmt)} is planned</p>
      <p className="text-caption text-text-secondary">
        {withTime.length} with a time · {withoutTime.length} without · {formatLength(free)} still free
      </p>
      {withTime.map((task) => {
        const block = blockOf(task)!
        return (
          <div key={task.id} className="flex items-center gap-2 rounded-control border border-border px-2 py-1">
            <span className="shrink-0 text-caption text-accent-blue">{formatBlockRange(block.start, block.end, fmt)}</span>
            <span className="min-w-0 flex-1 truncate text-meta text-text">{task.title}</span>
            <span className="shrink-0 text-caption text-text-secondary">{formatLength(block.minutes)}</span>
          </div>
        )
      })}
      {withoutTime.map((task) => {
        // A due time on the day is no "any time".
        const due = task.due_date as string
        const atTime = !isNoDueDate(due) && !isDateOnly(due) && localDateOf(due) === session.day
        return (
          <div key={task.id} className="flex items-center gap-2 rounded-control border border-border px-2 py-1">
            <span className="shrink-0 text-caption text-text-secondary">
              {atTime ? formatDateDisplay('logbook.time', new Date(due), new Date(), false, fmt) : 'Any time'}
            </span>
            <span className="min-w-0 flex-1 truncate text-meta text-text">{task.title}</span>
          </div>
        )
      })}
      <label className="mt-1 flex cursor-pointer items-center gap-2">
        <Checkbox data-plan-remind checked={session.remindersOn} onChange={(event) => session.setBlockReminders(event.target.checked)} />
        <span className="text-meta text-text">Remind me when each block starts</span>
      </label>
      <label className="flex cursor-pointer items-center gap-2">
        <Checkbox data-plan-nudge checked={session.nudgeOn} onChange={(event) => session.setNudge(event.target.checked)} />
        <span className="text-meta text-text">Ask me to plan tomorrow at {session.nudgeTime}</span>
      </label>
      <div className="mt-2 flex items-center gap-2">
        <Button variant="secondary" data-plan-undo-all onClick={session.undoAll}>
          <Undo2 className="h-4 w-4" aria-hidden="true" />
          Undo all
        </Button>
        <Button variant="primary" data-plan-done onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  )
}

/** Plan my day (contract 14.10): a panel in place of the task list, with the timeline next to it. */
export function PlanMyDaySession({ onExit, listRef }: { onExit: () => void; listRef: React.RefObject<HTMLElement | null> }) {
  const session = usePlanSession()
  const [pressed, setPressed] = useState<{ id: number; element: HTMLElement } | null>(null)
  const pressedTask = pressed ? session.timelineTasks.find((task) => task.id === pressed.id) : undefined
  const { step } = session
  const next = [() => session.setStep(1), () => session.setStep(2), session.accept][step]
  const planned = plannedMinutes(session.timelineTasks, session.day)
  return (
    <div className="flex min-h-0 flex-1" data-plan-session>
      <aside ref={listRef as React.RefObject<HTMLElement>} aria-label="Plan my day" className="flex w-[380px] shrink-0 flex-col border-r border-border">
        <div className="grid shrink-0 gap-2 border-b border-border p-3">
          <div className="flex items-center gap-2">
            <Sun className="h-4 w-4 shrink-0" style={{ color: 'var(--status-today)' }} aria-hidden="true" />
            <h2 className="text-section text-text">Plan my day</h2>
            <div role="radiogroup" aria-label="Day" className="flex rounded-full border border-border p-0.5">
              {([
                [session.today, 'Today'],
                [session.tomorrow, 'Tomorrow'],
              ] as const).map(([day, label]) => (
                <button
                  key={day}
                  type="button"
                  role="radio"
                  aria-checked={session.day === day}
                  disabled={step > 1}
                  data-plan-target={label.toLowerCase()}
                  onClick={() => session.setDay(day)}
                  className={cn('rounded-full px-2 py-0.5 text-caption font-medium disabled:opacity-60', session.day === day ? 'bg-bg-selected text-text' : 'text-text-secondary')}
                >
                  {label}
                </button>
              ))}
            </div>
            <button type="button" data-plan-exit onClick={onExit} className="ml-auto rounded-control px-2 py-0.5 text-meta text-text hover:bg-bg-hover">
              Exit
            </button>
          </div>
          <div aria-hidden="true" className="flex gap-1">
            {PLAN_STEPS.map((name, index) => (
              <span key={name} className={cn('h-1 flex-1 rounded-full', index <= step ? 'bg-accent-blue' : 'bg-bg-hover')} />
            ))}
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-caption text-text-secondary" data-plan-step>
              Step {step + 1} of 4 · {PLAN_STEPS[step]}
            </p>
            {session.assistantReady && (
              <label className="flex cursor-pointer items-center gap-1 text-caption text-text-secondary">
                <Checkbox data-plan-assistant checked={session.assistantOn} onChange={(event) => session.setAssistantOn(event.target.checked)} />
                <Sparkles className="h-3 w-3" aria-hidden="true" />
                Assistant
              </label>
            )}
          </div>
        </div>

        <div className="grid min-h-0 flex-1 content-start gap-1.5 overflow-y-auto p-3">
          {step === 0 && <LeftoversStep session={session} />}
          {step === 1 && <ChooseStep session={session} />}
          {step === 2 && <ArrangeStep session={session} />}
          {step === 3 && <ReadyStep session={session} onDone={onExit} />}
        </div>

        {step < 3 && (
          <div className="flex shrink-0 items-center gap-2 border-t border-border p-3">
            {step > 0 && (
              <Button variant="secondary" data-plan-back onClick={() => session.setStep(step - 1)}>
                Back
              </Button>
            )}
            <span className="flex-1 text-caption text-text-secondary">
              {step === 2 ? `${formatLength(planned)} planned` : ''}
            </span>
            <Button variant="primary" data-plan-next-step onClick={next}>
              {['Next', 'Arrange', 'Accept the plan'][step]}
            </Button>
          </div>
        )}
      </aside>

      <Timeline
        days={[session.day]}
        selectedDay={session.day}
        onSelectDay={() => {}}
        tasks={session.timelineTasks}
        routines={session.routines}
        defaultLength={session.prefs.defaultLength}
        hours={session.prefs.hours}
        isLoading={session.range.isLoading}
        listRef={listRef}
        onChange={session.timelineChange}
        onPressBlock={(task, element) => setPressed({ id: task.id, element })}
        dashedIds={session.dashedIds}
        draft={step === 2}
        reasonOf={session.assistantActive ? (task) => session.reasons.get(task.id) : undefined}
        note={step === 2 ? 'draft, not saved yet' : undefined}
      />

      {pressed && pressedTask && (
        <BlockPopover
          key={pressed.id}
          task={pressedTask}
          element={pressed.element}
          canChange={session.canChange(pressedTask)}
          defaultLength={session.prefs.defaultLength}
          onChange={session.timelineChange}
          removeLabel={session.dashedIds.has(pressed.id) ? 'No time' : 'Remove time'}
          canComplete={!session.dashedIds.has(pressed.id)}
          onClose={() => setPressed(null)}
        />
      )}
    </div>
  )
}
