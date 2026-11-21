import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useParams } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ArrowRight, Check, ChevronRight, Circle, Clock, Pencil, Plus, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { api } from '@/lib/api'
import { formatDateDisplay, formatDayMonthYear, formatWeekdayDate } from '@/lib/date-display'
import { cellFacts, planPhase, type PlanCellFact } from '@/lib/pro/plan-display'
import { isTempTaskId } from '@/lib/pending-cache'
import { refreshTasks } from '@/lib/task-refresh'
import type { Task } from '@/lib/vikunja-types'
import { useDateFormat } from '@/hooks/use-date-format'
import { useGroups } from '@/hooks/use-groups'
import { useProjects } from '@/hooks/use-projects'
import { usePlanData, useProjectPlans, type PlanData } from '@/hooks/use-project-plans'
import { useSelectionStore } from '@/stores/selection-store'
import { toast } from '@/stores/toast-store'
import { ReadingScroll } from '@/components/layout/ReadingScroll'
import { ListSkeleton } from '@/components/shared/ListSkeleton'
import { Button } from '@/components/shared/Button'
import { Tooltip } from '@/components/overlay/Tooltip'
import { TaskRow } from '@/components/task-list/TaskRow'
import { TaskRowGroup } from '@/components/task-list/TaskRowGroup'
import { NewTaskComposer } from '@/components/task-list/NewTaskComposer'
import { ProOffNotice } from '@/components/pro/ProOffNotice'
import { PlanDialog } from '@/components/pro/PlanDialog'
import { ClosePlanDialog } from '@/components/pro/ClosePlanDialog'
import { startOfLocalDay, type LocalDate } from '../../../shared/due-dates'
import { recordValue } from '../../../shared/pro/ledger'
import { effectiveDue } from '../../../shared/pro/promises'
import { YOU } from '../../../shared/pro/groups'
import type { PlanCell, PlanItem, ProjectPlan } from '../../../shared/pro/project-plan'

const ACTION = 'inline-flex items-center gap-1.5 rounded-control border border-border px-2.5 py-1 text-meta text-text hover:bg-bg-hover'
const LINK = 'text-accent-blue hover:underline'

/** The width of an element, followed as it changes (the milestones panel keeps to the visible part of the table). */
function useWidth<T extends HTMLElement>(): [(element: T | null) => void, number] {
  const [element, setElement] = useState<T | null>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    if (!element) return
    setWidth(element.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => setWidth(element.clientWidth))
    observer.observe(element)
    return () => observer.disconnect()
  }, [element])
  return [setElement, width]
}

/** One fact of a cell drawn with a shape and its count; the words are in the cell's hidden label. */
function FactMark({ fact, count }: { fact: PlanCellFact; count: number }) {
  const icon = 'h-3 w-3 shrink-0'
  const mark: Record<PlanCellFact, ReactNode> = {
    due: <Circle className={icon} aria-hidden strokeWidth={2} />,
    delivered: <Check className={icon} aria-hidden strokeWidth={2.5} />,
    late: <Clock className={icon} aria-hidden strokeWidth={2} />,
    slipped: <ArrowRight className={icon} aria-hidden strokeWidth={2} />,
    dropped: <X className={icon} aria-hidden strokeWidth={2} />,
  }
  return (
    <span className="inline-flex items-center gap-0.5" data-pro-plan-fact={fact}>
      {mark[fact]}
      <span className={cn('tabular-nums', fact === 'dropped' && 'line-through')}>{count}</span>
    </span>
  )
}

/**
 * A project's 90-day plan (cross-app semantics 21.20): its items as rows, its weeks as columns,
 * each cell the facts of that week counted from the tasks and the verdicts. Nothing here is a
 * status: no colours for good or bad, only counts.
 */
export function ProjectPlanView() {
  const { projectId } = useParams({ from: '/project-plan/$projectId' })
  const id = Number(projectId)
  const { t } = useTranslation()
  const plans = useProjectPlans()
  const plan = plans.byProject.get(id) ?? null
  const data = usePlanData(id, plan)
  const { data: projects, isLoading: projectsLoading } = useProjects()
  const project = projects?.flat.find((entry) => entry.id === id)
  const [editing, setEditing] = useState(false)
  const heading = t('pro.plan.title')

  if (!plans.on) return <ProOffNotice title={heading} />
  if (projectsLoading) return <ListSkeleton title={heading} />
  if (!project) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
        <h1 className="text-page-title text-text">{heading}</h1>
        <p className="max-w-sm text-meta text-text-secondary">{t('pro.plan.noProject')}</p>
      </div>
    )
  }
  if (!plan) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center" data-pro-plan-none>
        <h1 className="text-page-title text-text">{project.title}</h1>
        <p className="max-w-sm text-meta text-text-secondary">{t('pro.plan.none')}</p>
        <Button variant="primary" className="mt-2" onClick={() => setEditing(true)} data-pro-plan-make>{t('pro.plan.make')}</Button>
        {editing && <PlanDialog projectId={id} onClose={() => setEditing(false)} />}
      </div>
    )
  }
  if (data.isLoading || !data.view) return <ListSkeleton title={project.title} />
  return <PlanPage projectId={id} projectTitle={project.title} project={project} plan={plan} data={data} />
}

interface PlanPageProps {
  projectId: number
  projectTitle: string
  project: NonNullable<ReturnType<typeof useProjects>['data']>['flat'][number]
  plan: ProjectPlan
  data: PlanData
}

function PlanPage({ projectId, projectTitle, project, plan, data }: PlanPageProps) {
  const { t, i18n } = useTranslation()
  const fmt = useDateFormat()
  const plans = useProjectPlans()
  const groups = useGroups()
  const { data: projects } = useProjects()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [closing, setClosing] = useState(false)
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set())
  const [addingItem, setAddingItem] = useState(false)
  const [addingMilestone, setAddingMilestone] = useState<number | null>(null)
  // The field takes the focus when it opens, and again after each task it made.
  const itemInput = useRef<HTMLInputElement>(null)
  const milestoneInput = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (addingItem) itemInput.current?.focus()
  }, [addingItem])
  useEffect(() => {
    if (addingMilestone !== null) milestoneInput.current?.focus()
  }, [addingMilestone])
  const [scrollRef, width] = useWidth<HTMLDivElement>()
  const view = data.view!
  const now = new Date()
  const day = (value: LocalDate) => formatDayMonthYear(startOfLocalDay(value), fmt)
  const shortDay = (value: LocalDate) => formatWeekdayDate(startOfLocalDay(value), now, fmt)
  const projectName = (pid: number) => projects?.flat.find((entry) => entry.id === pid)?.title ?? projects?.archived.find((entry) => entry.id === pid)?.title ?? ''
  const phase = planPhase(plan, view.week, view.weeks.length, data.today)
  const followOn = plans.followOn(projectId)
  const list = new Intl.ListFormat(i18n.language, { type: 'unit', style: 'long' })

  const phaseText =
    phase.kind === 'closed' ? t('pro.plan.phase.closed', { day: day(phase.day) })
    : phase.kind === 'before' ? t('pro.plan.phase.before', { day: day(phase.day) })
    : phase.kind === 'after' ? t('pro.plan.phase.after', { day: day(phase.day) })
    : t('pro.plan.phase.week', { week: phase.week, weeks: phase.weeks })

  const factText = (fact: PlanCellFact, count: number): string => {
    switch (fact) {
      case 'due': return t('pro.plan.cell.due', { count })
      case 'delivered': return t('pro.plan.cell.delivered', { count })
      case 'late': return t('pro.plan.cell.late', { count })
      case 'slipped': return t('pro.plan.cell.slipped', { count })
      case 'dropped': return t('pro.plan.cell.dropped', { count })
    }
  }

  const ownerName = (owner: number | null): string | null =>
    owner === null ? null : owner === YOU ? t('pro.plan.you') : data.world.people.get(owner)?.title ?? t('pro.plan.someone')

  const dueOf = (taskId: number): LocalDate | null => {
    const task = data.byId.get(taskId)
    return task ? effectiveDue(task, recordValue(data.ledger.promises, taskId)) : null
  }

  const toggle = (itemId: number, open?: boolean) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (open ?? !next.has(itemId)) next.add(itemId)
      else next.delete(itemId)
      return next
    })
  }

  const openItem = (itemId: number) => {
    toggle(itemId, true)
    useSelectionStore.getState().requestOpenTask(itemId)
  }

  /** A task made in the milestone field becomes a subtask of its item (21.20). */
  const linkMilestone = async (item: Task, created: Task) => {
    if (isTempTaskId(item.id) || isTempTaskId(created.id)) {
      toast.info(t('pro.plan.milestoneOffline', { title: created.title }))
      return
    }
    const result = await api.createTaskRelation(item.id, created.id, 'subtask')
    if (!result.success) toast.error(t('pro.plan.milestoneLinkFailed', { title: created.title, error: result.error }))
    refreshTasks(queryClient)
  }

  const cell = (entry: PlanCell, index: number, itemId: number) => {
    const facts = cellFacts(entry)
    const current = view.week === index
    const label = facts.length ? list.format(facts.map((fact) => factText(fact.fact, fact.count))) : ''
    return (
      <td
        key={index}
        className={cn('border-b border-l border-border px-1 py-1.5 text-center align-top text-caption text-text', current && 'border-x-2 border-x-text-secondary')}
        data-pro-plan-cell={`${itemId}:${index}`}
        title={label || undefined}
      >
        {facts.length > 0 && (
          <>
            <span className="flex flex-col items-center gap-0.5" aria-hidden>
              {facts.map((fact) => <FactMark key={fact.fact} fact={fact.fact} count={fact.count} />)}
            </span>
            <span className="sr-only">{label}</span>
          </>
        )}
      </td>
    )
  }

  const itemRow = (item: PlanItem) => {
    const task = data.byId.get(item.id)
    if (!task) return null
    const open = expanded.has(item.id)
    const owner = ownerName(item.owner)
    const nextTask = item.next !== null ? data.byId.get(item.next) : undefined
    const nextDue = item.next !== null ? dueOf(item.next) : null
    const nextDay = nextDue ? formatDateDisplay('row', startOfLocalDay(nextDue), now, true, fmt) : null
    const panelId = `pro-plan-item-${item.id}`
    const milestones = item.milestones.flatMap((mid) => (mid === item.id ? [] : data.byId.get(mid) ?? []))
    return [
      <tr key={item.id} data-pro-plan-item={item.id}>
        <th scope="row" className="sticky left-0 z-10 w-64 min-w-64 border-b border-border bg-bg-page px-2 py-1.5 text-left align-top font-normal">
          <div className="flex items-start gap-1">
            <button
              type="button"
              aria-expanded={open}
              aria-controls={panelId}
              aria-label={t('pro.plan.table.milestonesOf', { title: task.title })}
              onClick={() => toggle(item.id)}
              className="mt-0.5 rounded-control p-0.5 text-text-secondary hover:bg-bg-hover"
              data-pro-plan-expand={item.id}
            >
              <ChevronRight className={cn('h-3.5 w-3.5 transition-transform duration-fade-fast', open && 'rotate-90')} aria-hidden />
            </button>
            <div className="min-w-0 flex-1">
              <button
                type="button"
                onClick={() => openItem(item.id)}
                className={cn('block max-w-full truncate rounded-control text-left text-task-title text-text hover:underline', item.done && 'line-through')}
                data-pro-plan-title={item.id}
              >
                {task.title}
              </button>
              <p className="flex flex-wrap gap-x-2 text-caption text-text-secondary">
                {item.done && <span>{t('pro.plan.itemDone')}</span>}
                {owner && <span data-pro-plan-owner>{owner}</span>}
                <span className="tabular-nums" data-pro-plan-count>{t('pro.plan.itemCount', { delivered: item.delivered, total: item.total })}</span>
                {nextTask && nextDay && (item.next === item.id
                  ? <span>{t('pro.plan.nextDay', { day: nextDay })}</span>
                  : <span className="min-w-0 truncate">{t('pro.plan.next', { title: nextTask.title, day: nextDay })}</span>)}
                {nextTask && !nextDay && item.next !== item.id && <span className="min-w-0 truncate">{t('pro.plan.nextUndated', { title: nextTask.title })}</span>}
              </p>
            </div>
          </div>
        </th>
        {item.weeks.map((entry, index) => cell(entry, index, item.id))}
      </tr>,
      open && (
        <tr key={`${item.id}-panel`} id={panelId}>
          <td colSpan={view.weeks.length + 1} className="border-b border-border p-0">
            <div className="sticky left-0 py-1" style={width ? { width } : undefined} data-pro-plan-milestones={item.id}>
              <TaskRowGroup>
                <TaskRow task={task} />
                {milestones.map((milestone) => <TaskRow key={milestone.id} task={milestone} nestedDepth={1} />)}
              </TaskRowGroup>
              {plan.closed !== null ? null : addingMilestone === item.id ? (
                <div className="pl-5">
                  <NewTaskComposer
                    projectId={projectId}
                    // In a group's plan a milestone is one of the group's actions (21.16).
                    defaultLabelIds={plan.group !== null ? [plan.group] : undefined}
                    inputRef={milestoneInput}
                    onCancel={() => setAddingMilestone(null)}
                    onCreated={(created) => {
                      milestoneInput.current?.focus()
                      void linkMilestone(task, created)
                    }}
                  />
                </div>
              ) : (
                <button type="button" className={cn(ACTION, 'my-1 ml-9 border-transparent')} onClick={() => setAddingMilestone(item.id)} data-pro-plan-add-milestone={item.id}>
                  <Plus className="h-3.5 w-3.5" aria-hidden /> {t('pro.plan.addMilestone')}
                </button>
              )}
            </div>
          </td>
        </tr>
      ),
    ]
  }

  return (
    <ReadingScroll columnClassName="flex flex-col pb-8">
      <header className="flex items-start justify-between gap-3 px-6 pb-3 pt-6" data-pro-plan={projectId}>
        <div className="min-w-0">
          <p className="text-meta text-text-secondary">{t('pro.plan.title')}</p>
          <h1 className="truncate text-page-title text-text">
            <Link to="/project/$projectId" params={{ projectId: String(projectId) }} className="hover:underline">{projectTitle}</Link>
          </h1>
          <p className="mt-0.5 text-meta text-text-secondary">{t('pro.plan.days', { start: day(plan.start), end: day(plan.end) })}</p>
          <p className="text-meta text-text" data-pro-plan-phase>{phaseText}</p>
          <p className="text-meta text-text" data-pro-plan-totals>
            {t('pro.plan.totals', { delivered: view.delivered, total: view.total })}
            {view.overdue > 0 && <> · {t('pro.plan.overdue', { count: view.overdue })}</>}
          </p>
          <p className="flex flex-wrap gap-x-3 text-meta">
            {plan.group !== null && (
              <Link to="/group/$labelId" params={{ labelId: String(plan.group) }} className={LINK} data-pro-plan-group-link>
                {t('pro.plan.forGroup', { name: groups.nameOf(plan.group) || t('pro.plan.dialog.unknownGroup') })}
              </Link>
            )}
            {plan.from !== null && (
              <Link to="/project-plan/$projectId" params={{ projectId: String(plan.from) }} className={LINK} data-pro-plan-from>
                {t('pro.plan.from', { name: projectName(plan.from) || t('pro.plan.earlierPlan') })}
              </Link>
            )}
            {followOn && (
              <Link to="/project-plan/$projectId" params={{ projectId: String(followOn.project) }} className={LINK} data-pro-plan-follow-on>
                {t('pro.plan.followOn', { name: projectName(followOn.project) || t('pro.plan.laterPlan') })}
              </Link>
            )}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
          <button type="button" className={ACTION} onClick={() => setEditing(true)} data-pro-plan-edit>
            <Pencil className="h-3.5 w-3.5" aria-hidden /> {t('pro.plan.edit')}
          </button>
          {plan.closed === null && (
            <button type="button" className={ACTION} onClick={() => setClosing(true)} data-pro-plan-close>
              <Check className="h-3.5 w-3.5" aria-hidden /> {t('pro.plan.close.button')}
            </button>
          )}
        </div>
      </header>

      {view.items.length === 0 ? (
        <p className="px-6 py-4 text-meta text-text-secondary" data-pro-plan-empty>{t('pro.plan.noItems')}</p>
      ) : (
        <div
          ref={scrollRef}
          className="mx-6 overflow-x-auto rounded-card border border-border"
          tabIndex={0}
          role="region"
          aria-label={t('pro.plan.table.label', { name: projectTitle })}
          data-pro-plan-table
        >
          <table className="w-max min-w-full border-separate border-spacing-0">
            <caption className="sr-only">{t('pro.plan.table.caption', { name: projectTitle })}</caption>
            <thead>
              <tr>
                <th scope="col" className="sticky left-0 z-10 w-64 min-w-64 border-b border-border bg-bg-page px-2 py-1.5 text-left text-group text-text-secondary">
                  {t('pro.plan.table.item')}
                </th>
                {view.weeks.map((week, index) => {
                  const current = view.week === index
                  const dates = t('pro.plan.table.weekDates', { from: shortDay(week.from), to: shortDay(week.to) })
                  return (
                    <th
                      key={week.from}
                      scope="col"
                      aria-current={current ? 'date' : undefined}
                      className={cn(
                        'min-w-10 border-b border-l border-border px-1 py-1.5 text-center text-caption tabular-nums text-text-secondary',
                        current && 'border-x-2 border-x-text-secondary font-semibold text-text',
                      )}
                      data-pro-plan-week={index + 1}
                    >
                      <Tooltip label={dates}>
                        <span className="inline-block">
                          <span aria-hidden>{index + 1}</span>
                          <span className="sr-only">
                            {current ? t('pro.plan.table.thisWeek', { number: index + 1, dates }) : t('pro.plan.table.week', { number: index + 1, dates })}
                          </span>
                        </span>
                      </Tooltip>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>{view.items.flatMap(itemRow)}</tbody>
          </table>
        </div>
      )}

      {plan.closed === null && <div className="px-6 pt-3">
        {addingItem ? (
          <NewTaskComposer projectId={projectId} inputRef={itemInput} onCancel={() => setAddingItem(false)} onCreated={() => itemInput.current?.focus()} />
        ) : (
          <button type="button" className={ACTION} onClick={() => setAddingItem(true)} data-pro-plan-add-item>
            <Plus className="h-3.5 w-3.5" aria-hidden /> {t('pro.plan.addItem')}
          </button>
        )}
      </div>}

      {editing && <PlanDialog projectId={projectId} onClose={() => setEditing(false)} />}
      {closing && <ClosePlanDialog project={project} plan={plan} data={data} onClose={() => setClosing(false)} />}
    </ReadingScroll>
  )
}
