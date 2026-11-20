import { useMemo } from 'react'
import { useParams } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Copy, FileInput, MessageSquareQuote, Send } from 'lucide-react'
import { usePromiseWorld } from '@/hooks/use-promise-world'
import { useProPrefs } from '@/hooks/use-pro-prefs'
import { useGroups } from '@/hooks/use-groups'
import { useLabels } from '@/hooks/use-labels'
import { useProjects } from '@/hooks/use-projects'
import { api } from '@/lib/api'
import { toast } from '@/stores/toast-store'
import { useProUiStore } from '@/stores/pro-ui-store'
import { TaskList } from '@/components/task-list/TaskList'
import { TaskRow } from '@/components/task-list/TaskRow'
import { TaskRowGroup } from '@/components/task-list/TaskRowGroup'
import { ListSectionHeader } from '@/components/task-list/ListSectionHeader'
import { ListSkeleton } from '@/components/shared/ListSkeleton'
import { PersonMark } from '@/components/pro/PersonMark'
import { ProOffNotice } from '@/components/pro/ProOffNotice'
import { openPromises } from '@/lib/pro/export'
import { personAgenda } from '@/lib/pro/agenda'
import { toLocalDate } from '../../../shared/due-dates'
import { finalVerdictOf, recordValue } from '../../../shared/pro/ledger'
import { matchPerson, patternText, personCounts } from '../../../shared/pro/people'
import { readConfirmTitle } from '../../../shared/pro/promises'
import { exportOpen } from '../../../shared/pro/import'
import { personPage, type PersonPart } from '../../../shared/pro/groups'
import type { Task } from '@/lib/vikunja-types'

const ACTION = 'inline-flex items-center gap-1.5 rounded-control border border-border px-2.5 py-1 text-meta text-text hover:bg-bg-hover'

/**
 * A person's page (cross-app semantics 21.5, plan 7.3.6): what they promised you, what you owe them,
 * what waits to be confirmed, the last 90 days in plain words and the next 1:1's agenda.
 */
export function PersonView() {
  const { labelId } = useParams({ from: '/person/$labelId' })
  const id = Number(labelId)
  const { t } = useTranslation()
  const world = usePromiseWorld()
  const groups = useGroups()
  const prefs = useProPrefs()
  const { data: labels } = useLabels()
  const { data: projects } = useProjects()
  const openDialog = useProUiStore((s) => s.open)
  const label = labels?.find((entry) => entry.id === id)
  const name = label?.title ?? 'Person'
  const today = toLocalDate(new Date())

  const sections = useMemo(() => {
    const theirs = []
    const mine = []
    const confirm = []
    const people = [...world.people.values()].map((person) => ({ id: person.id, title: person.title, aliases: recordValue(world.ledger.people, person.id)?.aliases ?? [] }))
    for (const task of world.open) {
      const promise = world.promiseFor(task)
      if (promise && promise.person === id && !finalVerdictOf(promise)) {
        if (promise.dir === 'theirs') theirs.push(task)
        else if (promise.dir === 'mine') mine.push(task)
        continue
      }
      const asked = readConfirmTitle(task.title)
      if (asked && matchPerson(asked.name, people).id === id) confirm.push(task)
    }
    return { theirs, mine, confirm }
  }, [world, id])

  // What they promised, by who it was promised to and by group (21.5).
  const promised = useMemo(() => personPage(id, sections.theirs, world.ledger, groups.labelIds), [id, sections.theirs, world.ledger, groups.labelIds])
  const counts = useMemo(() => personCounts(id, world.ledger, (taskId) => world.openById.has(taskId), today), [id, world, today])
  const agenda = useMemo(() => personAgenda(name, sections.theirs, sections.mine, world, today), [name, sections, world, today])

  if (!world.on) return <ProOffNotice title={name} />
  if (world.isLoading) return <ListSkeleton title={name} />
  if (label && !prefs.isPerson(id)) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
        <h1 className="text-lg font-semibold text-text">{name}</h1>
        <p className="text-sm text-text-secondary">This label is not marked as a person.</p>
        <button type="button" className="mt-2 text-sm font-medium text-accent-blue hover:underline" onClick={() => void prefs.setPerson(id, true)}>
          This is a person
        </button>
      </div>
    )
  }

  const projectTitle = (projectId: number) => projects?.all.find((project) => project.id === projectId)?.title ?? null
  const copyAgenda = async () => {
    await api.writeClipboardRich(agenda.text, agenda.html)
    toast.success('Agenda copied')
  }
  const copyForCopilot = async () => {
    const json = exportOpen(name, today, openPromises(world, projectTitle, (_task, person) => person === id))
    await api.writeClipboardRich(json)
    toast.success('Open promises copied for Copilot')
  }

  // Without a group and with nothing promised to anyone else, the page is as it was.
  const plain = promised.toOthers.length === 0 && promised.toYou.every((part) => part.group === null)
  const theirsById = new Map(sections.theirs.map((task) => [task.id, task]))
  const promisedPart = (key: string, title: string, parts: readonly PersonPart[]) => {
    const count = parts.reduce((sum, part) => sum + part.tasks.length, 0)
    if (count === 0) return null
    return (
      <div data-pro-promised={key}>
        <ListSectionHeader level={1} title={title} count={count} />
        {parts.map((part) => (
          <div key={String(part.group)} data-pro-promised-group={part.group ?? 'none'}>
            <ListSectionHeader level={2} title={part.group === null ? t('pro.person.outsideGroup') : groups.nameOf(part.group)} count={part.tasks.length} />
            <TaskRowGroup>{part.tasks.flatMap((taskId): Task[] => { const task = theirsById.get(taskId); return task ? [task] : [] }).map((task) => <TaskRow key={task.id} task={task} />)}</TaskRowGroup>
          </div>
        ))}
      </div>
    )
  }

  return (
    <TaskList
      title={name}
      tasks={[]}
      showNewTask={false}
      empty={false}
      headerContent={
        <div className="space-y-3 px-6 pb-3" data-pro-person={id}>
          <div className="flex items-center gap-2">
            <PersonMark name={name} color={label?.hex_color} />
            <p className="text-meta text-text-secondary" data-pro-pattern>{patternText(counts)}</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" className={ACTION} onClick={() => void copyAgenda()}><Copy className="h-3.5 w-3.5" aria-hidden /> Copy agenda</button>
            <button type="button" className={ACTION} onClick={() => openDialog('pro-recap', { personId: id })}><Send className="h-3.5 w-3.5" aria-hidden /> Recap</button>
            <button type="button" className={ACTION} onClick={() => openDialog('pro-copilot', { personId: id })}><MessageSquareQuote className="h-3.5 w-3.5" aria-hidden /> Ask Copilot</button>
            <button type="button" className={ACTION} onClick={() => openDialog('pro-import', { personId: id })}><FileInput className="h-3.5 w-3.5" aria-hidden /> Import</button>
            <button type="button" className={ACTION} onClick={() => void copyForCopilot()}><Copy className="h-3.5 w-3.5" aria-hidden /> Copy for Copilot</button>
          </div>
        </div>
      }
    >
      <div>
        <ListSectionHeader level={1} title="Next 1:1" count={agenda.items.length} />
        <ul className="space-y-1 px-6 py-2 text-task-title text-text" data-pro-agenda>
          {agenda.items.map((item) => (
            <li key={item} className="flex gap-2"><span className="text-text-secondary" aria-hidden>-</span>{item}</li>
          ))}
        </ul>
      </div>
      {plain && sections.theirs.length > 0 && (
        <div>
          <ListSectionHeader level={1} title={`From ${name}`} count={sections.theirs.length} />
          <TaskRowGroup>{sections.theirs.map((task) => <TaskRow key={task.id} task={task} />)}</TaskRowGroup>
        </div>
      )}
      {!plain && promisedPart('to-you', t('pro.person.toYou'), promised.toYou)}
      {!plain && promisedPart('to-others', t('pro.person.toOthers'), promised.toOthers)}
      {sections.mine.length > 0 && (
        <div>
          <ListSectionHeader level={1} title={`You owe ${name}`} count={sections.mine.length} />
          <TaskRowGroup>{sections.mine.map((task) => <TaskRow key={task.id} task={task} />)}</TaskRowGroup>
        </div>
      )}
      {sections.confirm.length > 0 && (
        <div>
          <ListSectionHeader level={1} title="To confirm" count={sections.confirm.length} />
          <TaskRowGroup>{sections.confirm.map((task) => <TaskRow key={task.id} task={task} />)}</TaskRowGroup>
        </div>
      )}
    </TaskList>
  )
}
