import type { QueryClient } from '@tanstack/react-query'
import type { Label, Project, Task } from '@/lib/vikunja-types'
import { getDateFormat } from '@/lib/date-format'
import { OPEN_TASKS_PARAMS } from '@/hooks/use-availability'
import { newLedgerId, setRecord, writeLedger } from '@/hooks/use-pro-ledger'
import { toLocalDate } from '../../../shared/due-dates'
import { formatWeekdayDate } from '../../../shared/date-display'
import type { ProLedger } from '../../../shared/pro/ledger'
import { draftEscalation, escalationDue } from '../../../shared/pro/portfolio'

/**
 * Decision 15: after a "not yet", a promise of theirs that reached the threshold of misses and has
 * no escalation gets a drafted one (the Sponsor desk shows it). Reads the window's caches.
 */
export async function draftEscalationIfDue(queryClient: QueryClient, ledger: ProLedger, taskId: number): Promise<boolean> {
  if (!escalationDue(ledger, taskId)) return false
  const open = queryClient.getQueryData<Task[]>(['tasks', OPEN_TASKS_PARAMS]) ?? []
  const labels = queryClient.getQueryData<Label[]>(['labels']) ?? []
  const projects = queryClient.getQueryData<Project[]>(['projects']) ?? []
  const fmt = getDateFormat()
  const now = new Date()
  const draft = draftEscalation({
    ledger,
    taskId,
    tasks: new Map(open.map((task) => [task.id, task])),
    personName: (id) => labels.find((label) => label.id === id)?.title ?? 'They',
    projectName: (id) => projects.find((project) => project.id === id)?.title ?? 'another initiative',
    dateText: (day) => {
      const [y, m, d] = day.split('-').map(Number)
      return formatWeekdayDate(new Date(y, m - 1, d, 12), now, fmt)
    },
    today: toLocalDate(now),
  })
  if (!draft) return false
  return writeLedger(queryClient, [setRecord('escalations', newLedgerId(), draft)])
}
