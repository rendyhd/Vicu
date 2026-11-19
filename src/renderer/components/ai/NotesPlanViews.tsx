import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { Copy } from 'lucide-react'
import { Button } from '@/components/shared/Button'
import { Checkbox } from '@/components/shared/Checkbox'
import { Switch } from '@/components/shared/Switch'
import { usePro } from '@/hooks/use-pro'
import { useCollabMe, useProjectAccessMap } from '@/hooks/use-project-access'
import { usePersonLabels } from '@/hooks/use-people'
import { useProLedger, currentLedger, newLedgerId, restoreRecords, setRecord, writeLedger } from '@/hooks/use-pro-ledger'
import { useToggleAssignee } from '@/hooks/use-assignee-mutations'
import { useAddDrafts } from '@/hooks/use-add-drafts'
import { useCreateProject, useDeleteProject, useDeleteTask } from '@/hooks/use-task-mutations'
import { addBrainDump, addedMessage, undoBrainDump } from '@/lib/ai/add-brain-dump'
import { defaultProjectFor, type AiWorkspace } from '@/lib/ai/workspace'
import { cancelOpenMic, useOpenMicStore } from '@/lib/ai/open-mic'
import { describeMutationError } from '@/lib/mutation-errors'
import { useDictationStore, type DraftCard, type NotesMode } from '@/stores/dictation-store'
import { useNotesStore } from '@/stores/notes-store'
import { UNDO_TOAST_MS, toast, useToastStore } from '@/stores/toast-store'
import {
  canUpdateNotes,
  defaultOwnerAction,
  namedTitle,
  notesSourceLine,
  notesWithSource,
  projectsInUse,
  tickedBy,
  type NotesFilter,
  type OwnerAction,
  type OwnerWorld,
} from '../../../shared/ai/notes'
import { AI_LIMITS } from '../../../shared/ai/contract'
import { confirmTitle } from '../../../shared/pro/promises'
import { recordValue, type LedgerCollection } from '../../../shared/pro/ledger'
import type { Person } from '../../../shared/pro/people'
import type { ProLedgerOperation } from '../../../shared/pro/ledger-ipc'
import type { BrainDumpDraft } from '../../../shared/ai/brain-dump'
import type { PersonRef } from '@/lib/vikunja-types'

// The parts of the dictation sheet that a plan of notes adds (docs/ai-assistant-v1.md 4.9.9 and
// 4.9.10): who each card is for and whether it is ticked, the filter and "Agreed in the meeting",
// the decisions and open questions with Copy, and Add for notes (the ticked cards, the source line,
// assignees and Pro promises, one Undo).

export interface NotesWorld {
  /** The owner rules' world for a card in this project (a new project of the plan is nobody's). */
  forProject: (projectId: number | null) => OwnerWorld
  /** A member by user id, for assigning. */
  member: (userId: number) => PersonRef | undefined
  /** A Pro person by label id. */
  person: (labelId: number) => { id: number; title: string } | undefined
  /** Pro people are offered (the promises layer is on and someone is a person). */
  proPeople: boolean
}

/** The world the owner chip reads (4.9.9): members of shared projects, and Pro people. */
export function useNotesWorld(agreed: boolean): NotesWorld {
  const access = useProjectAccessMap()
  const me = useCollabMe()
  const pro = usePro()
  const labels = usePersonLabels()
  const { ledger } = useProLedger()
  return useMemo(() => {
    const promises = pro.layer('promises')
    const people: Person[] = promises
      ? [...labels.values()].map((label) => ({ id: label.id, title: label.title, aliases: recordValue(ledger.people, label.id)?.aliases ?? [] }))
      : []
    const members = new Map<number, PersonRef>()
    for (const entry of access.values()) for (const m of entry.members) members.set(m.id, m)
    const asPerson = (m: PersonRef): Person => ({ id: m.id, title: m.name?.trim() || m.username, aliases: [m.username] })
    return {
      forProject: (projectId) => {
        const entry = projectId !== null ? access.get(projectId) : undefined
        const shared = entry?.shared ? entry.members.filter((m) => m.id !== me?.id).map(asPerson) : []
        return { members: shared, people, agreed }
      },
      member: (userId) => members.get(userId),
      person: (labelId) => {
        const label = labels.get(labelId)
        return label ? { id: label.id, title: label.title } : undefined
      },
      proPeople: promises && people.length > 0,
    }
  }, [access, me, pro, labels, ledger, agreed])
}

/** A card's action and tick: the person's choice, else the default and the filter (4.9.9). */
export function cardChoice(card: DraftCard, notes: NotesMode, world: NotesWorld): { action: OwnerAction; ticked: boolean } {
  const choice = notes.choices[card.draft.ref] ?? {}
  const projectId = card.draft.project_ref !== null ? null : card.draft.project_id
  const action = choice.action ?? defaultOwnerAction(card.draft.owner ?? null, world.forProject(projectId))
  return { action, ticked: choice.ticked ?? tickedBy(notes.filter, action) }
}

function actionValue(action: OwnerAction): string {
  switch (action.kind) {
    case 'assign': return `assign:${action.userId}`
    case 'promise': return `promise:${action.personId}`
    case 'confirm': return `confirm:${action.personId}`
    default: return action.kind
  }
}

function actionOf(value: string): OwnerAction {
  const [kind, id] = value.split(':')
  if (kind === 'assign') return { kind: 'assign', userId: Number(id) }
  if (kind === 'promise') return { kind: 'promise', personId: Number(id) }
  if (kind === 'confirm') return { kind: 'confirm', personId: Number(id) }
  return kind === 'name' ? { kind: 'name' } : { kind: 'mine' }
}

/** The row on top of a card of notes: its tick, who it is for, and the line it came from. */
export function NotesCardBar({ card, notes, world, disabled }: { card: DraftCard; notes: NotesMode; world: NotesWorld; disabled: boolean }) {
  const { t } = useTranslation()
  const { draft } = card
  const { action, ticked } = cardChoice(card, notes, world)
  const set = (change: Parameters<ReturnType<typeof useDictationStore.getState>['setNotesChoice']>[1]) =>
    useDictationStore.getState().setNotesChoice(draft.ref, change)
  const owner = draft.owner && draft.owner !== 'me' ? draft.owner : null
  const projectId = draft.project_ref !== null ? null : draft.project_id
  const projectWorld = world.forProject(projectId)
  const options: Array<{ value: string; label: string }> = [{ value: 'mine', label: t('notes.plan.mine') }]
  for (const member of projectWorld.members) options.push({ value: `assign:${member.id}`, label: t('notes.plan.assign', { name: member.title }) })
  const personId = action.kind === 'promise' || action.kind === 'confirm' ? action.personId : null
  const people = owner ? projectWorld.people.filter((p) => p.id === personId || defaultOwnerAction(owner, { members: [], people: [p], agreed: false }).kind !== 'name') : []
  for (const person of people) {
    options.push({ value: `confirm:${person.id}`, label: t('notes.plan.confirm', { name: person.title }) })
    options.push({ value: `promise:${person.id}`, label: t('notes.plan.promise', { name: person.title }) })
  }
  if (owner) options.push({ value: 'name', label: t('notes.plan.named', { name: owner }) })
  const value = actionValue(action)
  if (!options.some((o) => o.value === value)) options.push({ value, label: value })
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 text-chip" data-notes-card="">
      <Checkbox
        checked={ticked}
        disabled={disabled}
        aria-label={t('notes.plan.include', { title: draft.title })}
        onChange={(event) => set({ ticked: event.target.checked })}
      />
      <label className="inline-flex items-center gap-1 rounded-chip border border-border px-2 py-0.5">
        <span className="sr-only">{t('notes.plan.owner')}</span>
        <select
          disabled={disabled}
          value={value}
          onChange={(e) => set({ action: actionOf(e.target.value) })}
          className="max-w-[14rem] bg-transparent text-chip text-text"
        >
          {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
      {(draft.page ?? null) !== null && (
        <span className="min-w-0 truncate text-caption text-text-secondary" title={draft.from ?? undefined}>
          {draft.from ? t('notes.plan.from', { page: draft.page, line: draft.from }) : t('notes.plan.pageOnly', { page: draft.page })}
        </span>
      )}
    </div>
  )
}

/** Above the plan: what the filter ticks, "Agreed in the meeting", and what was left out. */
export function NotesPlanBar({ notes, world, cards, disabled }: { notes: NotesMode; world: NotesWorld; cards: readonly DraftCard[]; disabled: boolean }) {
  const { t } = useTranslation()
  const ticked = cards.filter((card) => cardChoice(card, notes, world).ticked).length
  return (
    <div className="space-y-2 rounded-control border border-border px-3 py-2" data-notes-plan-bar="">
      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex items-center gap-2 text-meta text-text">
          <span>{t('notes.plan.show')}</span>
          <select
            value={notes.filter}
            disabled={disabled}
            onChange={(e) => useDictationStore.getState().setNotesFilter(e.target.value as NotesFilter)}
            className="rounded-control border border-border bg-bg-page px-2 py-1 text-meta text-text"
          >
            <option value="mine">{t('notes.plan.filterMine')}</option>
            <option value="mine_and_waiting">{t('notes.plan.filterKnown')}</option>
            <option value="everything">{t('notes.plan.filterAll')}</option>
          </select>
        </label>
        <span className="text-caption text-text-secondary" role="status">{t('notes.plan.ticked', { ticked, total: cards.length })}</span>
        {world.proPeople && (
          <label className="ml-auto inline-flex items-center gap-2 text-meta text-text" title={t('notes.plan.agreedHelp')}>
            <span>{t('notes.plan.agreed')}</span>
            <Switch aria-label={t('notes.plan.agreed')} checked={notes.agreed} disabled={disabled} onCheckedChange={(on) => useDictationStore.getState().setNotesAgreed(on)} />
          </label>
        )}
      </div>
      {world.proPeople && <p className="text-caption text-text-secondary">{t('notes.plan.agreedHelp')}</p>}
      {notes.repeated > 0 && <p className="text-caption text-text-secondary">{t('notes.plan.repeated', { count: notes.repeated })}</p>}
      {notes.overLimit > 0 && <p className="text-caption text-text-secondary">{t('notes.plan.overLimit', { count: AI_LIMITS.notes_tasks_max })}</p>}
      {!canUpdateNotes(notes.batches, cards.length) && <p className="text-caption text-text-secondary">{t('notes.plan.updateOff', { count: AI_LIMITS.brain_dump_tasks_max })}</p>}
    </div>
  )
}

/** The decisions and open questions of the notes (4.9.9): listed with Copy, and Pro's log while it is on. */
export function NotesDecisions({ notes, toLog, onToLog, showLog }: { notes: NotesMode; toLog: boolean; onToLog: (on: boolean) => void; showLog: boolean }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState<string | null>(null)
  if (notes.decisions.length === 0 && notes.questions.length === 0) return null
  const copy = (key: string, lines: string[]) => {
    void navigator.clipboard.writeText(lines.join('\n')).then(() => setCopied(key))
  }
  const list = (key: 'decisions' | 'questions', items: Array<{ text: string; page: number | null }>) => items.length === 0 ? null : (
    <div className="rounded-control border border-border px-3 py-2">
      <div className="flex items-center gap-2">
        <p className="flex-1 text-caption font-medium text-text-secondary">{key === 'decisions' ? t('notes.plan.decisions') : t('notes.plan.questions')}</p>
        <Button variant="quiet" onClick={() => copy(key, items.map((item) => `- ${item.text}`))}>
          <Copy className="h-3.5 w-3.5" aria-hidden="true" /> {copied === key ? t('notes.plan.copied') : t('notes.plan.copy')}
        </Button>
      </div>
      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-meta text-text">
        {items.map((item, i) => <li key={i}>{item.text}{item.page !== null && <span className="text-text-secondary"> · {t('notes.plan.pageOnly', { page: item.page })}</span>}</li>)}
      </ul>
    </div>
  )
  return (
    <div className="space-y-2">
      {list('decisions', notes.decisions.map((d) => ({ text: d.by ? `${d.what} (${d.by})` : d.what, page: d.page })))}
      {list('questions', notes.questions.map((q) => ({ text: q.ask ? `${q.what} (${q.ask})` : q.what, page: q.page })))}
      {showLog && notes.decisions.length > 0 && (
        <label className="flex items-center gap-2 text-meta text-text">
          <Checkbox checked={toLog} onChange={(event) => onToLog(event.target.checked)} />
          {t('notes.plan.toLog')}
        </label>
      )}
    </div>
  )
}

/**
 * Add for a plan of notes (4.9.10): the ticked cards with their titles by owner, the source line in
 * their notes, the new projects that hold one, then assignees and Pro promises (and decisions in
 * Pro's log when asked); one Undo for all of it.
 */
export function useAddNotesPlan(ws: AiWorkspace, world: NotesWorld) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const addDraftsNow = useAddDrafts()
  const createProject = useCreateProject({ silent: true })
  const deleteProjectQuietly = useDeleteProject({ silent: true })
  const deleteProject = useDeleteProject()
  const deleteTask = useDeleteTask()
  const toggleAssignee = useToggleAssignee()

  return async (options: { toLog: boolean }) => {
    const store = useDictationStore.getState()
    const notes = store.notes
    if (!notes) return
    if (useOpenMicStore.getState().owner === 'dictation') cancelOpenMic()
    store.cancelRequest()
    const picked = store.cards.map((card) => ({ card, ...cardChoice(card, notes, world) })).filter((entry) => entry.ticked)
    if (picked.length === 0) {
      store.setAddError(t('notes.plan.nothingTicked'))
      return
    }
    const drafts: BrainDumpDraft[] = picked.map(({ card, action }) => {
      const { owner: _owner, page: _page, from: _from, ...draft } = card.draft
      const line = notesSourceLine(notes.title, notes.date, card.draft.page ?? null, card.draft.from ?? null)
      let title = draft.title
      let labels = draft.labels
      if (action.kind === 'name' && card.draft.owner && card.draft.owner !== 'me') title = namedTitle(card.draft.owner, title)
      if (action.kind === 'confirm' || action.kind === 'promise') {
        const person = world.person(action.personId)
        if (person) {
          if (action.kind === 'confirm') title = confirmTitle(person.title, title)
          if (!labels.some((l) => l.id === person.id)) labels = [...labels, { id: person.id, title: person.title }]
        }
      }
      return { ...draft, title, labels, notes: notesWithSource(draft.notes, line) }
    })
    const projects = projectsInUse(store.projects, drafts)
    if (projects.length > 0 && !navigator.onLine) {
      store.setAddError(t('notes.plan.offline'))
      return
    }
    store.setAddError(null)
    store.setPhase('adding')
    const outcome = await addBrainDump(projects, drafts, {
      createProject: (title, parentId) => createProject.mutateAsync({ title, ...(parentId ? { parent_project_id: parentId } : {}) }),
      deleteProject: (id) => deleteProjectQuietly.mutateAsync(id),
      addDrafts: (list) => addDraftsNow(list),
      defaultProjectId: defaultProjectFor(ws, store.list),
    })
    if (!outcome.ok) {
      const after = useDictationStore.getState()
      if (after.phase === 'idle') return
      if (outcome.stage === 'projects') {
        after.setAddError(t('notes.plan.projectFailed', { title: outcome.project.title, error: describeMutationError(outcome.error).message }))
      } else {
        after.projectsCreated(outcome.projectIds)
      }
      after.setPhase('cards')
      return
    }

    // Who the tasks are for: assignees (queued offline) and Pro promises once the tasks have ids.
    const before = currentLedger(qc)
    const touched: Array<{ collection: LedgerCollection; id: string }> = []
    const operations: ProLedgerOperation[] = []
    const problems = [...outcome.added.problems]
    for (let i = 0; i < picked.length; i++) {
      const task = outcome.added.tasks[i]
      const { action } = picked[i]
      if (!task) continue
      if (action.kind === 'assign') {
        const person = world.member(action.userId)
        if (person) await toggleAssignee.mutateAsync({ task, person, assign: true }).catch(() => problems.push(t('notes.plan.assignFailed', { title: task.title })))
      } else if (action.kind === 'promise') {
        touched.push({ collection: 'promises', id: String(task.id) })
        operations.push(setRecord('promises', String(task.id), { dir: 'theirs', person: action.personId }))
      }
    }
    if (options.toLog) {
      for (const decision of notes.decisions) {
        const id = newLedgerId()
        const by = decision.by ? world.forProject(null).people.find((p) => p.title.toLowerCase() === decision.by!.toLowerCase())?.id ?? null : null
        touched.push({ collection: 'log', id })
        operations.push(setRecord('log', id, { kind: 'decision', text: decision.what, by, at: notes.date, initiative: null }))
      }
    }
    if (operations.length > 0) await writeLedger(qc, operations)

    useNotesStore.getState().finished()
    for (const problem of problems) toast.error(problem)
    useToastStore.getState().push('success', addedMessage(outcome.projects.length, outcome.added.tasks.length), {
      durationMs: UNDO_TOAST_MS,
      action: {
        label: t('completion.undo'),
        onAction: () => {
          void (async () => {
            await undoBrainDump(outcome.added, outcome.projects, {
              deleteTask: async (task) => { await deleteTask.mutateAsync({ task, deleteSubtasks: false }) },
              deleteProject: async (id) => { await deleteProject.mutateAsync(id) },
            })
            if (touched.length > 0) await writeLedger(qc, restoreRecords(before, touched))
          })()
        },
      },
    })
  }
}
