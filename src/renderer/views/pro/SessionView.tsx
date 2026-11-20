import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { cn } from '@/lib/cn'
import { useGroups, useGroupWorld } from '@/hooks/use-groups'
import { useAppConfig } from '@/hooks/use-app-config'
import { useCollabMe } from '@/hooks/use-project-access'
import { useWeekStart } from '@/hooks/use-week-start'
import { useAddLabel, useCreateTask } from '@/hooks/use-task-mutations'
import { buildCreateExtras } from '@/lib/composer-queue'
import { isTempTaskId } from '@/lib/pending-cache'
import { newLedgerId, setRecord, writeLedger } from '@/hooks/use-pro-ledger'
import { toast } from '@/stores/toast-store'
import { ReadingScroll } from '@/components/layout/ReadingScroll'
import { PageHeader } from '@/components/shared/PageHeader'
import { Checkbox } from '@/components/shared/Checkbox'
import { TaskRow } from '@/components/task-list/TaskRow'
import { TaskRowGroup } from '@/components/task-list/TaskRowGroup'
import { ListSectionHeader } from '@/components/task-list/ListSectionHeader'
import { NewTaskComposer } from '@/components/task-list/NewTaskComposer'
import { ProOffNotice } from '@/components/pro/ProOffNotice'
import { GroupLog } from '@/components/pro/GroupLog'
import { NoOwnerList } from '@/components/pro/NoOwnerList'
import { SessionRecapDialog } from '@/components/pro/SessionRecapDialog'
import { renderProDocument } from '@/lib/pro/text'
import { loadSession, RUNNING_SESSION_END, saveSession, sessionEndTime, type SessionState } from '@/lib/pro/session-state'
import type { Task } from '@/lib/vikunja-types'
import { toLocalDate } from '../../../shared/due-dates'
import { ledgerSettings, recordValue } from '../../../shared/pro/ledger'
import { readBackDocument, textLanguage } from '../../../shared/pro/documents'
import type { LogEntry } from '../../../shared/pro/groups'
import { endSession, sessionActions, sessionContents, sessionKindOf, SESSION_STEPS, type SessionStep } from '../../../shared/pro/sessions'

const ACTION = 'inline-flex items-center gap-1.5 rounded-control border border-border px-2.5 py-1 text-meta text-text hover:bg-bg-hover'
const PRIMARY = 'rounded-control bg-accent-fill px-3 py-1 text-meta font-medium text-on-accent disabled:opacity-40'
const SCORES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

/**
 * A session of a group (cross-app semantics 21.17): the kind's steps in order. Verdicts, issues and
 * new actions are written as they happen; what the session held is worked out from its times.
 * Ending writes the round under the id chosen at the start and opens the recap.
 */
export function SessionView() {
  const { meetingId, kind: kindParam } = useParams({ from: '/session/$meetingId/$kind' })
  const kind = sessionKindOf(kindParam)
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const groups = useGroups()
  const group = groups.byMeeting.get(meetingId) ?? null
  const view = useGroupWorld(group?.label ?? 0)
  const { data: config } = useAppConfig()
  const me = useCollabMe()
  const weekStart = useWeekStart()
  const createTask = useCreateTask()
  const addLabel = useAddLabel()
  const [state, setStateValue] = useState<SessionState | null>(() => loadSession(meetingId, kind))
  const [recap, setRecap] = useState<string | null>(null)
  const [readBack, setReadBack] = useState('')
  const steps = SESSION_STEPS[kind]
  const step: SessionStep = steps[Math.min(state?.step ?? 0, steps.length - 1)]
  const inbox = config?.inbox_project_id
  const myName = me?.name || me?.username || t('pro.group.you')

  const setState = (next: SessionState | null) => {
    setStateValue(next)
    saveSession(meetingId, kind, next)
  }

  const actions = useMemo(
    () => (group ? sessionActions({ group, tasks: view.tasks, ledger: view.ledger, today: view.today, kind, weekStart }) : { verdicts: [], others: [] }),
    [group, view.tasks, view.ledger, view.today, kind, weekStart],
  )
  // What the session holds so far: the same rule as its recap, up to now.
  const contents = useMemo(
    () => (group && state ? sessionContents({ round: state.round, started: state.started, ended: RUNNING_SESSION_END, group, tasks: view.tasks, ledger: view.ledger }) : null),
    [group, state, view.tasks, view.ledger],
  )

  const language = textLanguage(group, ledgerSettings(view.ledger))
  useEffect(() => {
    let live = true
    if (!group || !state || step !== 'readback') return
    const document = readBackDocument({
      group,
      kind,
      date: toLocalDate(new Date(state.started)),
      tasks: view.tasks,
      ledger: view.ledger,
      names: { person: view.world.nameOf, me: myName },
      round: state.round,
      started: state.started,
      ended: RUNNING_SESSION_END,
    })
    void renderProDocument(document, language).then((rendered) => { if (live) setReadBack(rendered.text) })
    return () => { live = false }
  }, [group, state, step, kind, view.tasks, view.ledger, view.world.nameOf, myName, language])

  const kindName = kind === 'standup' ? t('pro.group.kind.standup') : t('pro.group.kind.weekly')
  const title = group ? t('pro.session.title', { group: group.name, kind: kindName }) : t('pro.session.notFound')
  if (!view.world.on) return <ProOffNotice title={title} />
  if (!group) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
        <h1 className="text-lg font-semibold text-text">{t('pro.session.notFound')}</h1>
        <button type="button" className="text-sm text-accent-blue hover:underline" onClick={() => void navigate({ to: '/people' })}>{t('pro.session.back')}</button>
      </div>
    )
  }

  const toGroup = () => void navigate({ to: '/group/$labelId', params: { labelId: String(group.label) } })
  const tasksOf = (ids: readonly number[]): Task[] => ids.flatMap((id) => view.byId.get(id) ?? [])
  const start = () => setState({ round: newLedgerId(), started: new Date().toISOString(), step: 0, absent: [], readBack: false, score: null })
  const end = async () => {
    if (!state) return
    const round = endSession({
      meeting: meetingId,
      kind,
      at: toLocalDate(new Date(state.started)),
      started: state.started,
      ended: sessionEndTime(new Date(), state.started, view.tasks.map((task) => task.created)),
      absent: state.absent,
      readBack: state.readBack,
      score: state.score,
    })
    await writeLedger(queryClient, [setRecord('rounds', state.round, round)])
    const id = state.round
    setState(null)
    setRecap(id)
  }
  const makeAction = async (entry: LogEntry) => {
    if (!inbox) return
    // A create queued offline carries the label; online it is added once the task has its id.
    const label = groups.labelOf(group.label)
    const extras = buildCreateExtras({ explicitLabels: label ? [label] : [], parsedLabelNames: [], knownLabels: label ? [label] : [], attachments: [], description: '' })
    const task = await createTask.mutateAsync({ projectId: inbox, task: { title: entry.value.text }, extras })
    if (label && !isTempTaskId(task.id)) addLabel.mutate({ taskId: task.id, labelId: label.id })
    toast.success(t('pro.session.actionMade', { title: task.title }))
  }

  const stepName: Record<SessionStep, string> = {
    actions: t('pro.session.step.actions'),
    issues: t('pro.session.step.issues'),
    new: t('pro.session.step.new'),
    readback: t('pro.session.step.readback'),
  }
  const captured = contents ? tasksOf(contents.created) : []
  const withoutOwner = captured.filter((task) => !task.done && !recordValue(view.ledger.promises, task.id))

  return (
    <ReadingScroll className="bg-[var(--bg-primary)]" columnClassName="flex flex-col">
      <PageHeader
        title={title}
        inScroll
        actions={
          <div className="flex gap-1.5">
            {state ? (
              <>
                <button type="button" className={ACTION} onClick={() => { setState(null); toGroup() }} data-pro-session-discard>{t('pro.session.discard')}</button>
                <button type="button" className={cn(ACTION, 'border-accent-blue text-accent-blue')} onClick={() => void end()} data-pro-session-end>{t('pro.session.end')}</button>
              </>
            ) : (
              <>
                <button type="button" className={ACTION} onClick={toGroup}>{t('pro.session.toGroup')}</button>
                <button type="button" className={PRIMARY} onClick={start} data-pro-session-start>{t('pro.session.start')}</button>
              </>
            )}
          </div>
        }
      />
      <div className="mx-auto w-full max-w-reading pb-10" data-pro-session={state?.round ?? ''}>
        <div className="mb-3 flex flex-wrap items-center gap-1.5 px-6">
          <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label={t('pro.session.steps')}>
            {steps.map((entry, index) => (
              <button
                key={entry}
                type="button"
                role="tab"
                aria-selected={!!state && step === entry}
                disabled={!state}
                onClick={() => state && setState({ ...state, step: index })}
                className={cn(
                  'rounded-chip border px-2.5 py-0.5 text-meta',
                  state && step === entry ? 'border-accent-blue bg-accent-blue/12 text-accent-blue' : 'border-border text-text',
                  !state && 'text-text-secondary',
                )}
                data-pro-session-step={entry}
              >
                {index + 1}. {stepName[entry]}
              </button>
            ))}
          </div>
          {state && state.step < steps.length - 1 && (
            <button type="button" className={cn(PRIMARY, 'ml-auto')} onClick={() => setState({ ...state, step: state.step + 1 })} data-pro-session-next>{t('pro.session.next')}</button>
          )}
        </div>

        {state && group.people.length > 0 && step === 'actions' && (
          <div className="mb-3 flex flex-wrap items-center gap-1.5 px-6" data-pro-session-absent>
            <span className="text-meta text-text-secondary">{t('pro.session.absent')}</span>
            {group.people.map((person) => {
              const away = state.absent.includes(person)
              return (
                <button
                  key={person}
                  type="button"
                  aria-pressed={away}
                  onClick={() => setState({ ...state, absent: away ? state.absent.filter((id) => id !== person) : [...state.absent, person] })}
                  className={cn('rounded-chip border border-border px-2 py-0.5 text-meta', away ? 'bg-bg-selected text-text line-through' : 'text-text')}
                >
                  {view.world.nameOf(person)}
                </button>
              )
            })}
          </div>
        )}

        {(!state || step === 'actions') && (
          <section data-pro-session-actions>
            <ListSectionHeader level={1} title={t('pro.session.needVerdict')} count={actions.verdicts.length} />
            <TaskRowGroup>{tasksOf(actions.verdicts).map((task) => <TaskRow key={task.id} task={task} />)}</TaskRowGroup>
            <ListSectionHeader level={1} title={t('pro.session.otherOpen')} count={actions.others.length} />
            <TaskRowGroup>{tasksOf(actions.others).map((task) => <TaskRow key={task.id} task={task} />)}</TaskRowGroup>
            {actions.verdicts.length + actions.others.length === 0 && <p className="px-6 py-3 text-meta text-text-secondary">{t('pro.session.nothingOpen')}</p>}
            <p className="px-6 pt-3 text-caption text-text-secondary">{state ? t('pro.session.verdictHint') : t('pro.session.startHint')}</p>
          </section>
        )}

        {state && step === 'issues' && (
          <GroupLog label={group.label} issues={view.issues} decisions={view.decisions} questions={view.questions} session={state.round} nameOf={view.world.nameOf} show={['issue']} onMakeAction={(entry) => void makeAction(entry)} />
        )}

        {state && step === 'new' && (
          <section data-pro-session-new>
            {inbox ? (
              <div className="px-2 pb-3">
                <NewTaskComposer projectId={inbox} defaultLabelIds={[group.label]} onCancel={() => undefined} />
              </div>
            ) : null}
            <ListSectionHeader level={1} title={t('pro.session.captured')} count={captured.length} />
            <TaskRowGroup>{captured.map((task) => <TaskRow key={task.id} task={task} />)}</TaskRowGroup>
            {captured.length === 0 && <p className="px-6 py-3 text-meta text-text-secondary">{t('pro.session.noCaptured')}</p>}
            <div className="pt-3"><NoOwnerList tasks={withoutOwner} group={group.label} /></div>
            <GroupLog label={group.label} issues={view.issues} decisions={view.decisions} questions={view.questions} session={state.round} nameOf={view.world.nameOf} show={['decision', 'unknown']} />
          </section>
        )}

        {state && step === 'readback' && (
          <section className="px-6" data-pro-session-readback>
            <p className="mb-2 text-meta text-text-secondary">{t('pro.session.readBackHint')}</p>
            <pre className="max-h-[45vh] overflow-y-auto whitespace-pre-wrap rounded-card border border-border bg-bg-hover p-3 font-sans text-task-title text-text" data-pro-read-back>{readBack}</pre>
            <label className="mt-3 flex items-center gap-2 text-meta text-text">
              <Checkbox checked={state.readBack} onChange={(event) => setState({ ...state, readBack: event.target.checked })} />
              {t('pro.session.readBackDone')}
            </label>
            <label className="mt-3 flex items-center gap-2 text-meta text-text">
              {t('pro.session.score')}
              <select
                value={state.score ?? ''}
                onChange={(event) => setState({ ...state, score: event.target.value ? Number(event.target.value) : null })}
                className="rounded-control border border-border bg-bg-page px-2 py-1 text-meta text-text"
                data-pro-session-score
              >
                <option value="">{t('pro.session.scoreNone')}</option>
                {SCORES.map((score) => <option key={score} value={score}>{score}</option>)}
              </select>
              <span className="text-caption text-text-secondary">{t('pro.group.scoreHint')}</span>
            </label>
            <button type="button" className={cn(PRIMARY, 'mt-4')} onClick={() => void end()} data-pro-session-finish>{t('pro.session.end')}</button>
          </section>
        )}
      </div>
      {recap && <SessionRecapDialog roundId={recap} onClose={() => { setRecap(null); toGroup() }} />}
    </ReadingScroll>
  )
}
