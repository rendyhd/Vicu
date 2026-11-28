import type { QueryClient } from '@tanstack/react-query'
import type { ParseResult } from '@/lib/task-parser'
import type { CreateTaskPayload, Task } from '@/lib/vikunja-types'
import { sendTaskPatch } from '@/lib/offline-mutations'
import { writeLedger } from '@/hooks/use-pro-ledger'
import type { ProLedgerOperation } from '../../../shared/pro/ledger-ipc'
import { recordValue, type PromiseValue, type ProLedger } from '../../../shared/pro/ledger'

/**
 * What Pro's quick-add phrases (cross-app semantics 5.5) add to a new task. Off, the parser reads
 * none of them, so none of this runs. The start date goes in the create; the flag, the estimate and
 * the promise follow once the task has an id (a temporary one offline: the ledger is remapped when
 * the create replays).
 */
export function withProFields(payload: CreateTaskPayload, parsed: ParseResult | null | undefined): CreateTaskPayload {
  if (!parsed?.start || payload.start_date) return payload
  return { ...payload, start_date: parsed.start.toISOString() }
}

/** The person label a capture adds to the task (the promise's person). */
export function proPersonLabelId(parsed: ParseResult | null | undefined): number | null {
  return parsed?.person?.id ?? null
}

export interface PromiseDraft {
  words?: string | null
  done_when?: string | null
  needs?: number[]
  /** The project id of the initiative the task's project is. */
  initiative?: number | null
  /** The lowest group label on the task (21.16): a person's promise there is made to the group. */
  group?: number | null
}

/** The lowest of a task's labels that is a group's, or null. */
export function groupLabelOf(labelIds: Iterable<number>, groupLabels: ReadonlySet<number>): number | null {
  const found = [...labelIds].filter((id) => groupLabels.has(id)).sort((a, b) => a - b)
  return found.length ? found[0] : null
}

/** The project when it is an active or parked initiative, else null. */
export function initiativeOfProject(ledger: ProLedger, projectId: number | null | undefined): number | null {
  if (typeof projectId !== 'number') return null
  const status = recordValue(ledger.initiatives, projectId)?.status
  return status === 'active' || status === 'parked' ? projectId : null
}

export function proCaptureOperations(parsed: ParseResult | null | undefined, taskId: number, draft: PromiseDraft = {}): ProLedgerOperation[] {
  if (!parsed) return []
  const operations: ProLedgerOperation[] = []
  if (parsed.estimate) operations.push({ op: 'estimate', taskId, minutes: parsed.estimate })
  if (parsed.person) {
    const value: PromiseValue = { dir: parsed.person.mine ? 'mine' : 'theirs', person: parsed.person.id }
    if (draft.words?.trim()) value.words = draft.words.trim()
    if (draft.done_when?.trim()) value.done_when = draft.done_when.trim()
    if (draft.needs?.length) value.needs = draft.needs
    if (typeof draft.initiative === 'number') value.initiative = draft.initiative
    // Who it was promised to (21.6): the one the text names, else the group whose label the task
    // carries when the promise is theirs; without either, you.
    if (parsed.requester) value.to = parsed.requester.id !== null ? { person: parsed.requester.id } : { text: parsed.requester.name }
    else if (!parsed.person.mine && typeof draft.group === 'number') value.to = { group: draft.group }
    if (parsed.checkOn) value.check_on = parsed.checkOn
    operations.push({ op: 'set', collection: 'promises', id: String(taskId), value })
  }
  return operations
}

/** After the create: the flag (is_favorite alone) and the ledger records. */
export async function finishProCapture(queryClient: QueryClient, task: Pick<Task, 'id' | 'title'>, parsed: ParseResult | null | undefined, draft?: PromiseDraft): Promise<void> {
  if (!parsed) return
  if (parsed.flag) await sendTaskPatch(task.id, { is_favorite: true }, task.title).catch(() => undefined)
  const operations = proCaptureOperations(parsed, task.id, draft)
  if (operations.length) await writeLedger(queryClient, operations)
}
