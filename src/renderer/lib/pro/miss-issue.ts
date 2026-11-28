import type { QueryClient } from '@tanstack/react-query'
import type { Task } from '@/lib/vikunja-types'
import { currentLedger, newLedgerId, setRecord, writeLedger } from '@/hooks/use-pro-ledger'
import { toLocalDate } from '../../../shared/due-dates'
import { ledgerSettings } from '../../../shared/pro/ledger'
import { groupsOf, missIssue } from '../../../shared/pro/groups'
import { runningSessionOf } from './session-state'

/**
 * A second miss (cross-app semantics 21.16): after a "not yet" that brings an action of a group to
 * the threshold of misses, the group's issue list gets an issue about it, once. Given in a running
 * session of that group, the issue names the session.
 */
export async function addMissIssues(queryClient: QueryClient, task: Pick<Task, 'id' | 'title' | 'labels'>): Promise<void> {
  const ledger = currentLedger(queryClient)
  const onTask = new Set((task.labels ?? []).map((label) => label.id))
  const today = toLocalDate(new Date())
  const operations = groupsOf(ledger).flatMap((group) => {
    if (!onTask.has(group.label)) return []
    const issue = missIssue(ledger, task, group.label, today, ledgerSettings(ledger).threshold)
    if (!issue) return []
    const session = runningSessionOf(group.id)
    return [setRecord('log', newLedgerId(), session ? { ...issue, session } : issue)]
  })
  if (operations.length) await writeLedger(queryClient, operations)
}
