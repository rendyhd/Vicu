import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Check, Pencil, SkipForward, UserX } from 'lucide-react'
import { cn } from '@/lib/cn'
import { usePromiseWorld } from '@/hooks/use-promise-world'
import { useAppConfig } from '@/hooks/use-app-config'
import { useCreateTask, useAddLabel } from '@/hooks/use-task-mutations'
import { newLedgerId, setRecord, writeLedger } from '@/hooks/use-pro-ledger'
import { ReadingScroll } from '@/components/layout/ReadingScroll'
import { PageHeader } from '@/components/shared/PageHeader'
import { TaskRow } from '@/components/task-list/TaskRow'
import { TaskRowGroup } from '@/components/task-list/TaskRowGroup'
import { ListSectionHeader } from '@/components/task-list/ListSectionHeader'
import { PersonMark } from '@/components/pro/PersonMark'
import { ProOffNotice } from '@/components/pro/ProOffNotice'
import { MeetingDialog } from '@/components/pro/MeetingDialog'
import { RecapDialog } from '@/components/pro/RecapDialog'
import { isTempTaskId } from '@/lib/pending-cache'
import type { Task } from '@/lib/vikunja-types'
import { addLocalDays, dateOnlyDue, toLocalDate } from '../../../shared/due-dates'
import { ME, endRound, markAbsent, nextPerson, pickPerson, skipPerson, startRound, type RoundState } from '../../../shared/pro/meeting'
import { finalVerdictOf, recordValue } from '../../../shared/pro/ledger'
import { activeVerdicts } from '../../../shared/pro/ledger'
import { effectiveDue } from '../../../shared/pro/promises'

const ACTION = 'inline-flex items-center gap-1.5 rounded-control border border-border px-2.5 py-1 text-meta text-text hover:bg-bg-hover'

const storageKey = (id: string) => `vicu-pro-round:${id}`

function loadRound(id: string): RoundState | null {
  try {
    const raw = localStorage.getItem(storageKey(id))
    return raw ? (JSON.parse(raw) as RoundState) : null
  } catch {
    return null
  }
}

function saveRound(id: string, state: RoundState | null): void {
  try {
    if (state) localStorage.setItem(storageKey(id), JSON.stringify(state))
    else localStorage.removeItem(storageKey(id))
  } catch {
    // The round still runs; it is only not kept across a reload.
  }
}

/**
 * Meeting mode (cross-app semantics 21.9, plan 7.5): the people of a meeting one card at a time, in
 * any order, without a timer. Verdicts and new promises are written as they happen; ending writes
 * the round and opens its recap.
 */
export function MeetingView() {
  const { meetingId } = useParams({ from: '/meeting/$meetingId' })
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const world = usePromiseWorld()
  const { data: config } = useAppConfig()
  const createTask = useCreateTask()
  const addLabel = useAddLabel()
  const meeting = recordValue(world.ledger.meetings, meetingId)
  const [round, setRoundState] = useState<RoundState | null>(() => loadRound(meetingId))
  const [editing, setEditing] = useState(false)
  const [recap, setRecap] = useState<null | { people: number[]; notDiscussed: string[]; absent: string[] }>(null)
  const [draft, setDraft] = useState('')
  const [draftMine, setDraftMine] = useState(false)
  const today = toLocalDate(new Date())

  const setRound = (next: RoundState | null) => {
    setRoundState(next)
    saveRound(meetingId, next)
  }

  const people = meeting?.people ?? []
  const current = round?.current ?? null

  const byPerson = useMemo(() => {
    const theirs = new Map<number, Task[]>()
    const mine = new Map<number, Task[]>()
    for (const task of world.open) {
      const promise = world.promiseFor(task)
      if (!promise || promise.person === null || finalVerdictOf(promise)) continue
      const map = promise.dir === 'theirs' ? theirs : promise.dir === 'mine' ? mine : null
      if (map) map.set(promise.person, [...(map.get(promise.person) ?? []), task])
    }
    return { theirs, mine }
  }, [world])

  // Before the round (plan 7.3.8): promises that slipped once already and are due by tomorrow.
  const prep = useMemo(() => {
    const items: Array<{ task: Task; person: number }> = []
    for (const person of people) {
      for (const task of byPerson.theirs.get(person) ?? []) {
        const promise = world.promiseFor(task)
        const due = effectiveDue(task, promise)
        if (due && due <= addLocalDays(today, 1) && activeVerdicts(promise).some((verdict) => verdict.kind === 'not_yet')) items.push({ task, person })
      }
    }
    return items
  }, [people, byPerson, world, today])

  const end = () => {
    if (!round) return
    const record = endRound(round, meetingId, today)
    void writeLedger(queryClient, [setRecord('rounds', newLedgerId(), record)])
    setRound(null)
    setRecap({ people: [...record.discussed, ...record.skipped], notDiscussed: record.not_discussed.map(world.nameOf), absent: record.absent.map(world.nameOf) })
  }

  useEffect(() => {
    if (!round) return
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (event.key === 'Enter' && target?.closest('[data-task-id]') === null) {
        event.preventDefault()
        setRound(nextPerson(round))
      } else if (event.key.toLowerCase() === 's') {
        setRound(skipPerson(round))
      } else if (event.key.toLowerCase() === 'a' && current !== null && current !== ME) {
        setRound(markAbsent(round, current))
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [round, current])

  const addPromise = async () => {
    const title = draft.trim()
    if (!title || current === null || current === ME) return
    const label = world.people.get(current)
    const task = await createTask.mutateAsync({ projectId: config?.inbox_project_id ?? 0, task: { title, due_date: dateOnlyDue(addLocalDays(today, 7)) } })
    if (label && !isTempTaskId(task.id)) addLabel.mutate({ taskId: task.id, labelId: label.id })
    void writeLedger(queryClient, [setRecord('promises', task.id, { dir: draftMine ? 'mine' : 'theirs', person: current })])
    setDraft('')
  }

  if (!world.on) return <ProOffNotice title="Meeting" />
  if (!meeting) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
        <h1 className="text-lg font-semibold text-text">Meeting not found</h1>
        <button type="button" className="text-sm text-accent-blue hover:underline" onClick={() => navigate({ to: '/people' })}>Back to People</button>
      </div>
    )
  }

  const status = (person: number) =>
    round?.current === person ? 'current' : round?.discussed.includes(person) ? 'discussed' : round?.absent.includes(person) ? 'absent' : round?.skipped.includes(person) ? 'skipped' : 'waiting'
  const cardPeople = round ? round.queue : [...people, ME]

  return (
    <ReadingScroll className="bg-[var(--bg-primary)]" columnClassName="flex flex-col">
      <PageHeader
        title={meeting.name}
        inScroll
        actions={
          <div className="flex gap-1.5">
            <button type="button" className={ACTION} onClick={() => setEditing(true)}><Pencil className="h-3.5 w-3.5" aria-hidden /> Edit</button>
            {round ? (
              <button type="button" className={cn(ACTION, 'border-accent-blue text-accent-blue')} onClick={end} data-pro-meeting-end>End meeting</button>
            ) : (
              <button type="button" className="rounded-control bg-accent-fill px-3 py-1 text-meta font-medium text-on-accent" onClick={() => setRound(startRound(people))} data-pro-meeting-start>Start round</button>
            )}
          </div>
        }
      />
      <div className="mx-auto w-full max-w-reading px-6 pb-10">
        <div className="mb-4 flex flex-wrap gap-1.5" role="tablist" aria-label="People" data-pro-meeting-people>
          {cardPeople.map((person) => {
            const state = status(person)
            const name = person === ME ? 'You' : world.nameOf(person)
            return (
              <button
                key={person}
                type="button"
                role="tab"
                aria-selected={state === 'current'}
                disabled={!round}
                onClick={() => round && setRound(pickPerson(round, person))}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-chip border px-2 py-0.5 text-meta',
                  state === 'current' ? 'border-accent-blue bg-accent-blue/12 text-accent-blue' : 'border-border text-text',
                  state === 'absent' && 'line-through text-text-secondary',
                  state === 'skipped' && 'text-text-secondary',
                )}
              >
                {state === 'discussed' && <Check className="h-3 w-3" aria-label="discussed" />}
                {name}
              </button>
            )
          })}
        </div>

        {!round && prep.length > 0 && (
          <section className="mb-6" data-pro-meeting-prep>
            <ListSectionHeader level={1} title="Before you start" count={prep.length} />
            <ul className="space-y-1 px-2 py-2">
              {prep.map(({ task, person }) => (
                <li key={task.id} className="flex items-center gap-2 text-task-title text-text">
                  <span className="min-w-0 flex-1 truncate">Have a word with {world.nameOf(person)}: {task.title}</span>
                  <button
                    type="button"
                    className="text-meta text-accent-blue hover:underline"
                    onClick={() => createTask.mutate({ projectId: config?.inbox_project_id ?? 0, task: { title: `Have a word with ${world.nameOf(person)}: ${task.title}`, due_date: dateOnlyDue(today) } })}
                  >
                    Make a task
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {round && current !== null && (
          <section data-pro-meeting-card={current}>
            <div className="mb-3 flex items-center gap-2">
              {current !== ME && <PersonMark name={world.nameOf(current)} color={world.people.get(current)?.hex_color} />}
              <h2 className="flex-1 text-section text-text">{current === ME ? 'Your card: what you owe the room' : world.nameOf(current)}</h2>
              <button type="button" className={ACTION} onClick={() => setRound(skipPerson(round))} aria-keyshortcuts="S"><SkipForward className="h-3.5 w-3.5" aria-hidden /> Skip</button>
              {current !== ME && (
                <button type="button" className={ACTION} onClick={() => setRound(markAbsent(round, current))} aria-keyshortcuts="A"><UserX className="h-3.5 w-3.5" aria-hidden /> Absent</button>
              )}
              <button type="button" className="rounded-control bg-accent-fill px-3 py-1 text-meta font-medium text-on-accent" onClick={() => setRound(nextPerson(round))} aria-keyshortcuts="Enter" data-pro-meeting-next>Next</button>
            </div>
            {current === ME ? (
              <TaskRowGroup>
                {people.flatMap((person) => byPerson.mine.get(person) ?? []).map((task) => <TaskRow key={task.id} task={task} />)}
              </TaskRowGroup>
            ) : (
              <>
                <ListSectionHeader level={2} title="Promised to you" count={(byPerson.theirs.get(current) ?? []).length} />
                <TaskRowGroup>{(byPerson.theirs.get(current) ?? []).map((task) => <TaskRow key={task.id} task={task} />)}</TaskRowGroup>
                {(byPerson.mine.get(current) ?? []).length > 0 && (
                  <>
                    <ListSectionHeader level={2} title="You owe them" count={(byPerson.mine.get(current) ?? []).length} />
                    <TaskRowGroup>{(byPerson.mine.get(current) ?? []).map((task) => <TaskRow key={task.id} task={task} />)}</TaskRowGroup>
                  </>
                )}
                <form
                  className="mt-3 flex items-center gap-2"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void addPromise()
                  }}
                >
                  <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={draftMine ? 'You promise...' : `${world.nameOf(current)} promises...`} aria-label="New promise" className="min-w-0 flex-1 rounded-control border border-border bg-bg-page px-2 py-1.5 text-task-title text-text" />
                  <label className="flex items-center gap-1 text-meta text-text-secondary">
                    <input type="checkbox" checked={draftMine} onChange={(event) => setDraftMine(event.target.checked)} /> Mine
                  </label>
                  <button type="submit" disabled={!draft.trim()} className="rounded-control border border-border px-2.5 py-1 text-meta text-text hover:bg-bg-hover disabled:opacity-40">Add</button>
                </form>
              </>
            )}
            <p className="mt-4 text-caption text-text-secondary">Enter: next. S: skip. A: absent. On a promise: keys 1 to 6 give the verdict.</p>
          </section>
        )}
        {round && current === null && (
          <p className="py-6 text-sm text-text-secondary">Everyone had a turn. End the meeting to write the recap.</p>
        )}
      </div>
      {editing && <MeetingDialog meeting={meeting} id={meetingId} onClose={() => setEditing(false)} />}
      {recap && (
        <RecapDialog
          onClose={() => setRecap(null)}
          round={{ title: meeting.name, day: today, people: recap.people, notDiscussed: recap.notDiscussed, absent: recap.absent }}
        />
      )}
    </ReadingScroll>
  )
}
