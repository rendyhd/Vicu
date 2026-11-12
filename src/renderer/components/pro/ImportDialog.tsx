import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Dialog } from '@/components/overlay/Dialog'
import { Checkbox } from '@/components/shared/Checkbox'
import { usePromiseWorld } from '@/hooks/use-promise-world'
import { useProjects } from '@/hooks/use-projects'
import { useAppConfig } from '@/hooks/use-app-config'
import { useProPrefs } from '@/hooks/use-pro-prefs'
import { useAddLabel, useCompleteTask, useCreateLabel, useCreateTask, useDeleteTask, useUncompleteTask, useUpdateTask } from '@/hooks/use-task-mutations'
import { currentLedger, newLedgerId, restoreRecords, setRecord, writeLedger } from '@/hooks/use-pro-ledger'
import { usePro } from '@/hooks/use-pro'
import { useProUiStore } from '@/stores/pro-ui-store'
import { toast } from '@/stores/toast-store'
import { isTempTaskId } from '@/lib/pending-cache'
import { NULL_DATE } from '@/lib/constants'
import type { Label, Task } from '@/lib/vikunja-types'
import { dateOnlyDue, toLocalDate } from '../../../shared/due-dates'
import { matchImport, readImport, type ImportRow } from '../../../shared/pro/import'
import { buildVerdict, promiseOf, withVerdict } from '../../../shared/pro/promises'
import { recordValue, type LedgerCollection, type PromiseValue, type VerdictKind } from '../../../shared/pro/ledger'
import { withAlias } from '../../../shared/pro/people'
import type { ProLedgerOperation } from '../../../shared/pro/ledger-ipc'

const ACTION_TEXT: Record<ImportRow['action'], string> = {
  their_promise: 'Their promise',
  confirm: 'To confirm',
  my_task: 'Your action',
  verdict: 'Update',
  open_item: 'Open item',
  decision: 'Decision',
  owed: 'Decision needed',
  value: 'Value',
}

const GROUPS: Array<{ title: string; actions: ImportRow['action'][] }> = [
  { title: 'Updates', actions: ['verdict'] },
  { title: 'New promises', actions: ['their_promise', 'confirm'] },
  { title: 'Your actions', actions: ['my_task'] },
  { title: 'Open items and decisions', actions: ['open_item', 'decision', 'owed', 'value'] },
]

interface RowChoice {
  on: boolean
  title: string
  /** A person picked for a name that matched none. */
  person: number | null
  rememberAlias: boolean
}

/**
 * Import (cross-app semantics 21.12, plan 7.4.2): paste the JSON Copilot gave (or a Vicu export),
 * review every row, then add the ticked ones at once with one Undo.
 */
export function ImportDialog({ onClose, initialText = '' }: { onClose: () => void; initialText?: string }) {
  const queryClient = useQueryClient()
  const world = usePromiseWorld()
  const pro = usePro()
  const { data: projects } = useProjects()
  const { data: config } = useAppConfig()
  const prefs = useProPrefs()
  const createTask = useCreateTask({ silent: true })
  const addLabel = useAddLabel({ silent: true })
  const createLabel = useCreateLabel()
  const deleteTask = useDeleteTask()
  const complete = useCompleteTask()
  const uncomplete = useUncompleteTask()
  const update = useUpdateTask()
  const openRecap = useProUiStore((s) => s.open)
  const [text, setText] = useState(initialText)
  const [choices, setChoices] = useState<Record<number, RowChoice>>({})
  const [working, setWorking] = useState(false)
  const today = toLocalDate(new Date())

  const read = useMemo(() => (text.trim() ? readImport(text, today) : null), [text, today])
  const match = useMemo(() => {
    if (!read?.ok) return null
    const people = [...world.people.values()].map((label) => ({ id: label.id, title: label.title, aliases: recordValue(world.ledger.people, label.id)?.aliases ?? [] }))
    const initiatives = Object.keys(world.ledger.initiatives).flatMap((id) => {
      const project = projects?.all.find((entry) => entry.id === Number(id))
      return project ? [{ id: project.id, title: project.title }] : []
    })
    const openPromises = world.open.flatMap((task) => {
      const promise = world.promiseFor(task)
      return promise && promise.person !== null ? [{ taskId: task.id, person: promise.person, title: task.title, dir: String(promise.dir) }] : []
    })
    return matchImport(read, { people, initiatives, openPromises })
  }, [read, world, projects?.all])

  const choiceOf = (row: ImportRow): RowChoice => choices[row.index] ?? { on: row.ready, title: row.title ?? row.item.what, person: row.person.id, rememberAlias: false }
  const setChoice = (row: ImportRow, change: Partial<RowChoice>) => setChoices((all) => ({ ...all, [row.index]: { ...choiceOf(row), ...change } }))
  const ticked = match?.rows.filter((row) => choiceOf(row).on) ?? []

  const apply = async () => {
    if (!match) return
    setWorking(true)
    const inboxId = config?.inbox_project_id ?? 0
    const created: Task[] = []
    const verdicts: Array<{ task: Task; kind: VerdictKind; oldDue: string }> = []
    const touched: Array<{ collection: LedgerCollection; id: string }> = []
    const before = currentLedger(queryClient)
    const operations: ProLedgerOperation[] = []
    const set = (collection: LedgerCollection, id: string, value: unknown) => {
      touched.push({ collection, id })
      operations.push(setRecord(collection, id, value))
    }
    const make = async (title: string, due: string | null, projectId: number, person: number | null): Promise<Task> => {
      const payload = { title, ...(due ? { due_date: dateOnlyDue(due) } : {}) }
      const label = person !== null ? world.people.get(person) : undefined
      const task = await createTask.mutateAsync({ projectId, task: payload, extras: label ? { labels: [{ id: label.id, title: label.title }], displayLabels: [label as Label] } : undefined })
      if (label && !isTempTaskId(task.id)) await addLabel.mutateAsync({ taskId: task.id, labelId: label.id }).catch(() => undefined)
      created.push(task)
      return task
    }
    try {
      for (const row of ticked) {
        const choice = choiceOf(row)
        const person = choice.person
        const projectId = row.initiative ?? inboxId
        if (person !== null && row.name && choice.rememberAlias && person !== row.person.id) {
          const current = recordValue(currentLedger(queryClient).people, person)
          set('people', String(person), { ...(current ?? {}), aliases: withAlias(current?.aliases, row.name) })
        }
        switch (row.action) {
          case 'their_promise': {
            const task = await make(choice.title, row.due, projectId, person)
            const value: PromiseValue = { dir: 'theirs', person }
            if (row.item.in_their_words) value.words = row.item.in_their_words
            if (row.item.done_when) value.done_when = row.item.done_when
            if (row.initiative) value.initiative = row.initiative
            set('promises', String(task.id), value)
            break
          }
          case 'confirm':
            await make(choice.title, row.due, projectId, person)
            break
          case 'my_task': {
            const task = await make(choice.title, row.due, projectId, null)
            if (person !== null) set('promises', String(task.id), { dir: 'mine', person, ...(row.initiative ? { initiative: row.initiative } : {}) })
            break
          }
          case 'verdict': {
            const task = row.target !== null ? world.openById.get(row.target) : undefined
            const promise = task ? promiseOf(currentLedger(queryClient), task.id) : null
            const kind = row.item.status as VerdictKind | undefined
            if (!task || !promise || !kind) break
            const change = buildVerdict(task, kind, { id: newLedgerId(), at: new Date().toISOString(), newDue: row.item.new_due ?? null, blocker: row.item.blocker ?? null })
            set('promises', String(task.id), withVerdict(promise, change.verdict))
            if (change.taskPatch?.done) complete.mutate(task)
            else if (typeof change.taskPatch?.due_date === 'string') update.mutate({ id: task.id, changes: { due_date: change.taskPatch.due_date }, original: task })
            verdicts.push({ task, kind, oldDue: task.due_date })
            break
          }
          case 'open_item':
            if (row.item.ask) await make(choice.title, null, projectId, person)
            else set('log', newLedgerId(), { kind: 'unknown', text: row.item.what, at: today, initiative: row.initiative, ask: null })
            break
          case 'decision':
            set('log', newLedgerId(), { kind: 'decision', text: row.item.what, by: person, at: row.item.date ?? today, initiative: row.initiative })
            break
          case 'owed':
            set('owed', newLedgerId(), { what: row.item.what, from: person, initiative: row.initiative, opened: today })
            break
          case 'value':
            set('log', newLedgerId(), { kind: 'value', text: row.item.where ? `${row.item.what} (${row.item.where})` : row.item.what, at: today, initiative: row.initiative })
            break
        }
      }
      if (operations.length) await writeLedger(queryClient, operations)
      const people = [...new Set(ticked.map((row) => choiceOf(row).person).filter((id): id is number => id !== null))]
      toast.success(`Added ${ticked.length} ${ticked.length === 1 ? 'item' : 'items'}`, {
        action: {
          label: 'Undo',
          onAction: () => {
            for (const task of created) deleteTask.mutate({ task })
            for (const { task, oldDue } of verdicts) {
              if (task.done === false && world.openById.has(task.id)) uncomplete.mutate({ ...task, done: true })
              update.mutate({ id: task.id, changes: { due_date: oldDue || NULL_DATE }, original: task })
            }
            void writeLedger(queryClient, restoreRecords(before, touched))
          },
        },
        secondAction: people.length ? { label: 'Recap', onAction: () => openRecap('pro-recap', { personId: people[0] }) } : undefined,
      })
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? `Import stopped: ${error.message}` : 'Import stopped')
    } finally {
      setWorking(false)
    }
  }

  const addPerson = async (row: ImportRow) => {
    if (!row.name) return
    const label = await createLabel.mutateAsync({ title: row.name })
    if (!label) return
    await prefs.setPerson(label.id, true)
    setChoice(row, { person: label.id })
  }

  return (
    <Dialog open label="Import" onClose={onClose} className="w-[760px] max-w-[94vw] p-5">
      <h2 className="mb-1 text-card-title text-text">Import</h2>
      <p className="mb-3 text-meta text-text-secondary">Paste the answer Copilot gave, or a Vicu export. Nothing is added until you choose Add.</p>
      <textarea
        value={text}
        onChange={(event) => {
          setText(event.target.value)
          setChoices({})
        }}
        rows={match ? 3 : 10}
        placeholder='{"format":"vicu-import/1", ...}'
        aria-label="Pasted text"
        className="w-full rounded-control border border-border bg-bg-page p-2 font-mono text-meta text-text"
        autoFocus
      />
      {read && !read.ok && (
        <p className="mt-2 text-meta text-status-overdue">
          {read.problems[0] ?? 'This is not an import Vicu can read.'}
          {pro.config?.pro_assistant !== false ? ' Ask the assistant to convert plain notes from Ask.' : ''}
        </p>
      )}
      {read?.ok && read.problems.length > 0 && <p className="mt-2 text-meta text-text-secondary">{read.problems.join(' ')}</p>}
      {match && (
        <div className="mt-3 max-h-[52vh] space-y-4 overflow-y-auto" data-pro-import-rows>
          {GROUPS.map((group) => {
            const rows = match.rows.filter((row) => group.actions.includes(row.action))
            if (!rows.length) return null
            return (
              <section key={group.title}>
                <h3 className="mb-1 text-group text-text-secondary">{group.title}</h3>
                <ul className="divide-y divide-border rounded-card border border-border">
                  {rows.map((row) => {
                    const choice = choiceOf(row)
                    const unknownName = row.name && row.person.id === null && row.action !== 'my_task' ? row.name : null
                    const target = row.target !== null ? world.openById.get(row.target) : undefined
                    return (
                      <li key={row.index} className="flex items-start gap-2 px-3 py-2" data-pro-import-row={row.action}>
                        <Checkbox checked={choice.on} onChange={(event) => setChoice(row, { on: event.target.checked })} aria-label={`Add ${row.item.what}`} />
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="shrink-0 rounded-chip bg-bg-hover px-2 py-px text-chip text-text-secondary">{ACTION_TEXT[row.action]}</span>
                            {row.title !== null ? (
                              <input value={choice.title} onChange={(event) => setChoice(row, { title: event.target.value })} aria-label="Title" className="min-w-0 flex-1 rounded-control border border-transparent bg-transparent px-1 text-task-title text-text hover:border-border focus:border-border" />
                            ) : (
                              <span className="min-w-0 flex-1 truncate text-task-title text-text">{row.item.what}</span>
                            )}
                            {row.due && <span className="shrink-0 text-meta text-text-secondary">{row.due}</span>}
                          </div>
                          {row.action === 'verdict' && (
                            <p className="text-meta text-text-secondary">
                              {target ? `${row.item.status ?? '?'} for "${target.title}"` : 'No open promise matches this update.'}
                              {row.check && ' Check that this is the right one.'}
                            </p>
                          )}
                          {row.name && row.action !== 'verdict' && (
                            <div className="flex flex-wrap items-center gap-2 text-meta text-text-secondary">
                              <span>{row.name}</span>
                              {unknownName && (
                                <>
                                  <select value={choice.person ?? ''} onChange={(event) => setChoice(row, { person: event.target.value ? Number(event.target.value) : null, on: !!event.target.value })} aria-label={`Who is ${row.name}`} className="rounded-control border border-border bg-bg-page px-1.5 py-0.5">
                                    <option value="">Who is this?</option>
                                    {[...world.people.values()].map((label) => <option key={label.id} value={label.id}>{label.title}</option>)}
                                  </select>
                                  {choice.person !== null ? (
                                    <label className="flex items-center gap-1"><Checkbox checked={choice.rememberAlias} onChange={(event) => setChoice(row, { rememberAlias: event.target.checked })} /> Remember</label>
                                  ) : (
                                    <button type="button" className="text-accent-blue hover:underline" onClick={() => void addPerson(row)}>Add {row.name} as a person</button>
                                  )}
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </section>
            )
          })}
          {match.notMentioned.length > 0 && (
            <section>
              <h3 className="mb-1 text-group text-text-secondary">Not mentioned</h3>
              <ul className="space-y-0.5 text-meta text-text-secondary">
                {match.notMentioned.map((id) => <li key={id}>{world.openById.get(id)?.title ?? `Task ${id}`}</li>)}
              </ul>
            </section>
          )}
        </div>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className="rounded-control px-3 py-1.5 text-meta text-text hover:bg-bg-hover" onClick={onClose}>Cancel</button>
        <button type="button" disabled={!ticked.length || working} className="rounded-control bg-accent-fill px-3 py-1.5 text-meta font-medium text-on-accent disabled:opacity-40" onClick={() => void apply()} data-pro-import-add>
          {ticked.length ? `Add ${ticked.length} ${ticked.length === 1 ? 'item' : 'items'}` : 'Add'}
        </button>
      </div>
    </Dialog>
  )
}
