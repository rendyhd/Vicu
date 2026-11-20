import { useCallback, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTasks } from './use-tasks'
import { useLabels } from './use-labels'
import { useCreateLabel } from './use-task-mutations'
import { usePro } from './use-pro'
import { useProPrefs } from './use-pro-prefs'
import { currentLedger, newLedgerId, setRecord, useProLedger, writeLedger } from './use-pro-ledger'
import { usePromiseWorld, type PromiseWorld } from './use-promise-world'
import type { Label, Task } from '@/lib/vikunja-types'
import { addLocalDays, startOfLocalDay, toLocalDate, type LocalDate } from '../../shared/due-dates'
import { recordValue, type GroupSession, type MeetingValue, type ProLedger } from '../../shared/pro/ledger'
import {
  endedSessions,
  groupLog,
  groupPage,
  groupsOf,
  openIssues,
  reliability,
  RELIABILITY_SESSIONS,
  type Group,
  type GroupPage,
  type LogEntry,
  type Reliability,
} from '../../shared/pro/groups'

const NO_GROUPS: Group[] = []

export interface Groups {
  on: boolean
  groups: Group[]
  byLabel: Map<number, Group>
  byMeeting: Map<string, Group>
  /** The label ids of the groups (what a task carries). */
  labelIds: Set<number>
  /** A group's label, for its colour. */
  labelOf: (labelId: number) => Label | undefined
  /** A group's name by its label id; the label's title when the group has no name. */
  nameOf: (labelId: number) => string
}

/**
 * Groups (cross-app semantics 21.16): the meetings with a label, while the promises layer is on.
 * A group whose label is gone from the server is left out.
 */
export function useGroups(): Groups {
  const pro = usePro()
  const on = pro.layer('promises')
  const { ledger } = useProLedger()
  const { data: labels } = useLabels()
  return useMemo(() => {
    const labelById = new Map((labels ?? []).map((label) => [label.id, label]))
    const groups = on ? groupsOf(ledger).filter((group) => !labels || labelById.has(group.label)) : NO_GROUPS
    const byLabel = new Map(groups.map((group) => [group.label, group]))
    return {
      on,
      groups,
      byLabel,
      byMeeting: new Map(groups.map((group) => [group.id, group])),
      labelIds: new Set(byLabel.keys()),
      labelOf: (labelId) => labelById.get(labelId),
      nameOf: (labelId) => byLabel.get(labelId)?.name || labelById.get(labelId)?.title || '',
    }
  }, [on, ledger, labels])
}

export interface GroupDraft {
  /** The meeting record to change; a new one without it. */
  id?: string
  /** An existing label, or null to make one named `name`. */
  label: number | null
  name: string
  people: number[]
  sessions: GroupSession[]
  checks: boolean
  language: string | null
}

/** Saving a group and taking its mark off again. */
export function useGroupActions() {
  const queryClient = useQueryClient()
  const prefs = useProPrefs()
  const createLabel = useCreateLabel({ silent: true })

  /** Writes the meeting record and marks the label. Resolves with the label id, or null when it failed. */
  const save = useCallback(async (draft: GroupDraft): Promise<number | null> => {
    const name = draft.name.trim()
    if (!name) return null
    let label = draft.label
    if (label === null) {
      const created = await createLabel.mutateAsync({ title: name }).catch(() => null)
      if (!created) return null
      label = created.id
    }
    const id = draft.id ?? newLedgerId()
    // Fields this screen does not show (a plain meeting's initiatives and rhythm, anything a newer
    // version wrote) stay as they are.
    const before = recordValue(currentLedger(queryClient).meetings, id)
    const value: MeetingValue = { ...(before ?? {}), name, people: draft.people, label, sessions: draft.sessions, checks: draft.checks, language: draft.language }
    if (draft.checks) delete value.checks
    if (!draft.language) delete value.language
    const ok = await writeLedger(queryClient, [setRecord('meetings', id, value)])
    if (!ok) return null
    await prefs.setGroup(label, true)
    return label
  }, [queryClient, prefs, createLabel])

  /** The group becomes a plain meeting again; the label and its tasks stay as they are. */
  const unmark = useCallback(async (group: Group): Promise<void> => {
    const before = recordValue(currentLedger(queryClient).meetings, group.id)
    if (before) {
      const value: MeetingValue = { ...before }
      delete value.label
      await writeLedger(queryClient, [setRecord('meetings', group.id, value)])
    }
    await prefs.setGroup(group.label, false)
  }, [queryClient, prefs])

  return { save, unmark }
}

/**
 * The ledger as the shared rules may read it for these tasks: a promise whose task is outside
 * Pro's area is no promise (section 21.1), so it is left out.
 */
export function ledgerInArea(world: Pick<PromiseWorld, 'ledger' | 'promiseFor'>, tasks: readonly Task[]): ProLedger {
  const outside = tasks.filter((task) => world.ledger.promises[String(task.id)] && world.promiseFor(task) === null)
  if (outside.length === 0) return world.ledger
  const promises = { ...world.ledger.promises }
  for (const task of outside) delete promises[String(task.id)]
  return { ...world.ledger, promises }
}

/** How far back a group's done actions are read: the reliability window, at least a week. */
function doneSince(ledger: ProLedger, group: Group | null, today: LocalDate): LocalDate {
  const weekAgo = addLocalDays(today, -7)
  if (!group) return weekAgo
  const sessions = endedSessions(ledger, group.id)
  const oldest = sessions[Math.min(sessions.length, RELIABILITY_SESSIONS + 1) - 1]
  if (!oldest) return weekAgo
  const from = addLocalDays(oldest.value.at, -1)
  const limit = addLocalDays(today, -120)
  return from < limit ? limit : from < weekAgo ? from : weekAgo
}

export interface GroupWorld {
  world: PromiseWorld
  group: Group | null
  /** The label, also for a label that is not a group (yet). */
  label: Label | undefined
  isLoading: boolean
  /** The group's actions: open ones, and done ones from the reliability window on. */
  tasks: Task[]
  byId: Map<number, Task>
  /** The ledger for these tasks (promises outside the area left out). */
  ledger: ProLedger
  page: GroupPage | null
  reliability: Reliability | null
  issues: LogEntry[]
  decisions: LogEntry[]
  questions: LogEntry[]
  sessions: ReturnType<typeof endedSessions>
  today: LocalDate
}

/** Everything a group's page and its sessions read (sections 21.16 and 21.17). */
export function useGroupWorld(labelId: number): GroupWorld {
  const world = usePromiseWorld()
  const { byLabel, labelOf } = useGroups()
  const group = byLabel.get(labelId) ?? null
  const today = toLocalDate(new Date())
  const since = doneSince(world.ledger, group, today)
  const doneParams = useMemo(
    () => ({ filter: `done = true && labels = ${labelId} && done_at >= '${startOfLocalDay(since).toISOString()}'`, keep_nested_subtasks: true }),
    [labelId, since],
  )
  const done = useTasks(doneParams, world.on && group !== null)
  return useMemo(() => {
    const open = world.open.filter((task) => (task.labels ?? []).some((label) => label.id === labelId))
    const tasks = [...open, ...(done.data ?? []).filter((task) => task.done)]
    const ledger = ledgerInArea(world, tasks)
    const input = group ? { group, tasks, ledger, today } : null
    return {
      world,
      group,
      label: labelOf(labelId),
      isLoading: world.isLoading,
      tasks,
      byId: new Map(tasks.map((task) => [task.id, task])),
      ledger,
      page: input ? groupPage(input) : null,
      reliability: input ? reliability(input) : null,
      issues: group ? openIssues(ledger, group.label) : [],
      decisions: group ? groupLog(ledger, group.label, 'decision') : [],
      questions: group ? groupLog(ledger, group.label, 'unknown').filter((entry) => !entry.value.resolved) : [],
      sessions: group ? endedSessions(ledger, group.id) : [],
      today,
    }
  }, [world, group, labelId, labelOf, done.data, today])
}
