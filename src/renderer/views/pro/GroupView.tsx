import { useMemo, useState } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Copy, FileInput, Pencil, Play } from 'lucide-react'
import { useGroupWorld } from '@/hooks/use-groups'
import { useProPrefs } from '@/hooks/use-pro-prefs'
import { useCollabMe } from '@/hooks/use-project-access'
import { useAppConfig } from '@/hooks/use-app-config'
import { useProjects } from '@/hooks/use-projects'
import { useWeekStart } from '@/hooks/use-week-start'
import { toast } from '@/stores/toast-store'
import { useProUiStore } from '@/stores/pro-ui-store'
import { TaskList } from '@/components/task-list/TaskList'
import { TaskRow } from '@/components/task-list/TaskRow'
import { TaskRowGroup } from '@/components/task-list/TaskRowGroup'
import { ListSectionHeader } from '@/components/task-list/ListSectionHeader'
import { ListSkeleton } from '@/components/shared/ListSkeleton'
import { ProOffNotice } from '@/components/pro/ProOffNotice'
import { GroupDialog } from '@/components/pro/GroupDialog'
import { GroupLog } from '@/components/pro/GroupLog'
import { NoOwnerList } from '@/components/pro/NoOwnerList'
import { copyRendered, renderProDocument } from '@/lib/pro/text'
import type { Task } from '@/lib/vikunja-types'
import { ledgerSettings } from '../../../shared/pro/ledger'
import { agendaDocument, textLanguage } from '../../../shared/pro/documents'
import { YOU, type OwnerActions } from '../../../shared/pro/groups'
import { sessionKindOf, SESSION_KINDS, type SessionKind } from '../../../shared/pro/sessions'

const ACTION = 'inline-flex items-center gap-1.5 rounded-control border border-border px-2.5 py-1 text-meta text-text hover:bg-bg-hover'

/**
 * A group's page (cross-app semantics 21.16): its actions by part and owner, the reliability line
 * in counts, its issues, decisions and open questions, and its past sessions. A session starts
 * from here.
 */
export function GroupView() {
  const { labelId } = useParams({ from: '/group/$labelId' })
  const id = Number(labelId)
  const { t } = useTranslation()
  const navigate = useNavigate()
  const view = useGroupWorld(id)
  const prefs = useProPrefs()
  const me = useCollabMe()
  const weekStart = useWeekStart()
  const [editing, setEditing] = useState(false)
  const { data: config } = useAppConfig()
  const { data: projects } = useProjects()
  const inbox = config?.inbox_project_id
  const { world, group, page, label } = view
  const name = group?.name || label?.title || t('pro.group.title')

  const kinds = useMemo<SessionKind[]>(() => {
    const have = new Set((group?.sessions ?? []).map((session) => sessionKindOf(session.kind)))
    const listed = SESSION_KINDS.filter((kind) => have.has(kind))
    return listed.length ? listed : ['weekly']
  }, [group])

  if (!world.on) return <ProOffNotice title={name} />
  if (view.isLoading) return <ListSkeleton title={name} />
  if (!group || !page) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
        <h1 className="text-lg font-semibold text-text">{name}</h1>
        <p className="max-w-sm text-sm text-text-secondary">{prefs.isPerson(id) ? t('pro.group.isPerson') : t('pro.group.notGroup')}</p>
        {label && !prefs.isPerson(id) && (
          <button type="button" className="mt-2 text-sm font-medium text-accent-blue hover:underline" onClick={() => setEditing(true)}>
            {t('pro.group.makeGroup')}
          </button>
        )}
        {editing && <GroupDialog label={id} onClose={() => setEditing(false)} />}
      </div>
    )
  }

  const kindName: Record<SessionKind, string> = { weekly: t('pro.group.kind.weekly'), standup: t('pro.group.kind.standup') }
  const ownerName = (owner: number | null) => (owner === null ? t('pro.group.noOwner') : owner === YOU ? t('pro.group.you') : world.nameOf(owner))
  const tasksOf = (ids: readonly number[]): Task[] => ids.flatMap((taskId) => view.byId.get(taskId) ?? [])
  const names = { person: world.nameOf, me: me?.name || me?.username || t('pro.group.you') }

  const copyAgenda = async (kind: SessionKind) => {
    const document = agendaDocument({ group, kind, date: view.today, tasks: view.tasks, ledger: view.ledger, names, today: view.today, weekStart })
    await copyRendered(await renderProDocument(document, textLanguage(group, ledgerSettings(view.ledger))))
    toast.success(t('pro.group.agendaCopied'))
  }

  const rel = view.reliability
  const part = (key: string, title: string, owners: readonly OwnerActions[], tone?: 'overdue') => {
    const count = owners.reduce((sum, entry) => sum + entry.tasks.length, 0)
    if (count === 0) return null
    return (
      <div data-pro-group-part={key}>
        <ListSectionHeader level={1} title={title} count={count} tone={tone} />
        {owners.map((entry) => (
          <div key={String(entry.owner)} data-pro-owner={entry.owner ?? 'none'}>
            <ListSectionHeader level={2} title={ownerName(entry.owner)} count={entry.tasks.length} />
            <TaskRowGroup>{tasksOf(entry.tasks).map((task) => <TaskRow key={task.id} task={task} />)}</TaskRowGroup>
          </div>
        ))}
      </div>
    )
  }

  return (
    <>
      <TaskList
        title={name}
        tasks={[]}
        projectId={inbox}
        showNewTask={!!inbox && !!projects?.flat.some((project) => project.id === inbox)}
        defaultLabelIds={[group.label]}
        newTaskPlacement="after-tasks"
        empty={false}
        headerContent={
          <div className="space-y-3 px-6 pb-3" data-pro-group={id}>
            <p className="text-meta text-text-secondary" data-pro-reliability>
              {rel && rel.total === 0
                ? t('pro.group.reliabilityNone', { count: rel.sessions })
                : rel
                ? <>
                    {t('pro.group.reliability', { count: rel.sessions, onTime: rel.onTime, total: rel.total, late: rel.late, pastDue: rel.openPastDue })}
                    {(rel.dropped > 0 || rel.takenOver > 0) && <> {t('pro.group.reliabilityMore', { dropped: rel.dropped, takenOver: rel.takenOver })}</>}
                  </>
                : t('pro.group.noSession')}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {kinds.map((kind) => (
                <button key={kind} type="button" className={ACTION} data-pro-start-session={kind} onClick={() => void navigate({ to: '/session/$meetingId/$kind', params: { meetingId: group.id, kind } })}>
                  <Play className="h-3.5 w-3.5" aria-hidden /> {t('pro.group.start', { kind: kindName[kind] })}
                </button>
              ))}
              {kinds.map((kind) => (
                <button key={kind} type="button" className={ACTION} data-pro-copy-agenda={kind} onClick={() => void copyAgenda(kind)}>
                  <Copy className="h-3.5 w-3.5" aria-hidden /> {t('pro.group.copyAgenda', { kind: kindName[kind] })}
                </button>
              ))}
              <button type="button" className={ACTION} onClick={() => useProUiStore.getState().open('pro-import', { groupLabel: group.label })} data-pro-group-import><FileInput className="h-3.5 w-3.5" aria-hidden /> {t('pro.group.importNotes')}</button>
              <button type="button" className={ACTION} onClick={() => setEditing(true)} data-pro-edit-group><Pencil className="h-3.5 w-3.5" aria-hidden /> {t('pro.group.edit')}</button>
            </div>
          </div>
        }
      >
        {part('overdue', t('pro.group.part.overdue'), page.overdue, 'overdue')}
        {part('due', page.since ? t('pro.group.part.due') : t('pro.group.part.dueNoSession'), page.due)}
        {part('fresh', t('pro.group.part.fresh'), page.fresh)}
        {part('open', t('pro.group.part.open'), page.open)}
        {page.yours.length > 0 && (
          <div data-pro-group-part="yours">
            <ListSectionHeader level={1} title={t('pro.group.part.yours')} count={page.yours.length} />
            <TaskRowGroup>{tasksOf(page.yours).map((task) => <TaskRow key={task.id} task={task} />)}</TaskRowGroup>
          </div>
        )}
        {part('done', page.since ? t('pro.group.part.done') : t('pro.group.part.doneRecent'), page.done)}
        <NoOwnerList tasks={tasksOf(page.noOwner)} group={group.label} />
        <GroupLog label={group.label} issues={view.issues} decisions={view.decisions} questions={view.questions} nameOf={world.nameOf} />
        {view.sessions.length > 0 && (
          <section className="px-6 pb-8" aria-label={t('pro.group.sessions')} data-pro-group-sessions>
            <h2 className="mb-1 text-group text-text-secondary">{t('pro.group.sessions')}</h2>
            <ul className="divide-y divide-border text-meta text-text">
              {view.sessions.slice(0, 8).map((session) => (
                <li key={session.id} className="flex items-center gap-2 py-1">
                  <span className="min-w-0 flex-1">{kindName[sessionKindOf(session.value.kind)]} · {session.value.at}</span>
                  {(session.value.recap_sent ?? []).length === 0 && <span className="text-text-secondary">{t('pro.group.recapNotCopied')}</span>}
                  {typeof session.value.score === 'number' && <span className="tabular-nums text-text-secondary" title={t('pro.group.scoreHint')}>{session.value.score}</span>}
                </li>
              ))}
            </ul>
          </section>
        )}
      </TaskList>
      {editing && <GroupDialog group={group} onClose={() => setEditing(false)} />}
    </>
  )
}
