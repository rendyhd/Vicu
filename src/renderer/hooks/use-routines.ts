import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { api } from '@/lib/api'
import {
  createRoutineCarrier,
  deleteRoutine,
  loadRoutineCsvEntries,
  loadRoutineArchive,
  shareRoutine,
  stopSharingRoutine,
  writeLostRoutineChanges,
  writeRoutineCarrier,
} from '@/lib/routine-store'
import { SHARE_ROUTINE_OFFLINE, hiddenForMe, sharedRoutinesIn } from '@/lib/routine-sharing'
import { parseTaskDuration } from '@/lib/task-duration'
import { useCurrentUser } from './use-current-user'
import { useSyncedPrefs } from './use-synced-prefs'
import type { Project, Task } from '@/lib/vikunja-types'
import {
  deviceId,
  isSharedRoutine,
  localDateString,
  MAX_ROUTINE_TIMES,
  newId,
  normalizeRoutineSlots,
  parseRoutineEnvelope,
  readRoutineHistory,
  routineDay,
  statusRecord,
  type OccurrenceStatus,
  type RoutineCarrier,
  type RoutineCsvEntry,
  type RoutineDefinition,
  type RoutineOccurrenceRecord,
  type RoutinePayload,
  routineKindFor,
  type RoutineSlot,
} from '@/lib/routines'

/**
 * What the editor sets. The kind, subtype, amount, unit and each time's label and period are no
 * longer chosen; they are written with the values older app versions read (contract 6.7).
 */
export type RoutineDraft = Pick<RoutineDefinition, 'name' | 'iconName' | 'color' | 'schedule' | 'slots'> & {
  durationMinutes?: number | null
}

function checkDraft(draft: RoutineDraft) {
  if (!draft.name.trim()) throw new Error('Give this routine a name')
  if (draft.durationMinutes != null && (!Number.isSafeInteger(draft.durationMinutes) || draft.durationMinutes <= 0)) {
    throw new Error('Duration must be a positive whole number of minutes')
  }
  if (draft.slots.length === 0) throw new Error('Add at least one time')
  if (draft.slots.length > MAX_ROUTINE_TIMES) throw new Error(`A routine has at most ${MAX_ROUTINE_TIMES} times`)
}

function draftSlots(draft: RoutineDraft): RoutineSlot[] {
  return normalizeRoutineSlots(draft.slots.map((slot) => ({ ...slot, id: slot.id || newId() })))
}

export interface RoutineLoad {
  carriers: RoutineCarrier<Task>[]
  /** Routines a newer version of Vicu wrote: shown as "update required", never written (contract 10.7). */
  updateRequired: number
  /** Routines whose record cannot be read: left out and reported, never written. */
  unreadable: number
}

export const ROUTINES_QUERY_KEY = ['routines'] as const

/** The routine carriers this account reads, its own and the ones others shared (contract 10.3, 6.9). */
export async function fetchCarriers(): Promise<RoutineLoad> {
  // The main process fetches the remembered carriers by id and finds new ones with a marker search;
  // the done tasks, and the archive parts among them, are not downloaded for the day views. Only
  // the signed-in user's carriers come back (contract 10.3), and the routines others shared (6.9).
  const result = await api.fetchRoutineCarriers()
  if (!result.success) throw new Error(result.error)
  let updateRequired = 0
  let unreadable = 0
  const carriers = result.data.flatMap((task) => {
    const parsed = parseRoutineEnvelope(task.description)
    if (parsed.payload) return [{ task, payload: parsed.payload }]
    if (parsed.updateRequired) updateRequired += 1
    else if (parsed.isCarrier) unreadable += 1
    return []
  }).sort((left, right) => left.payload.definition.createdAt.localeCompare(right.payload.definition.createdAt))
  // A carrier that lost this device's recent changes to a write made at the same moment gets them
  // written again (section 6.8). One whose write fails keeps its last known copy, to try next time.
  const device = deviceId()
  const checked = await Promise.all(carriers.map(async (carrier) => {
    try {
      const written = await writeLostRoutineChanges(api, carrier, knownCarriers.get(carrier.task.id), device)
      knownCarriers.set(written.task.id, written.payload)
      return written
    } catch (error) {
      console.warn('[Routines] Could not write lost routine changes again:', error)
      return carrier
    }
  }))
  return { carriers: checked, updateRequired, unreadable }
}

/**
 * The copy of each carrier this window last wrote or read, by task id: what a refresh compares
 * the server's copy with to find this device's changes it lost (section 6.8).
 */
const knownCarriers = new Map<number, RoutinePayload>()

/**
 * The shared routines a project holds, its subprojects included (deleting a project deletes them
 * too), by name, for the delete and archive questions (section 6.9). Reads the routines the app
 * already has, or asks once; nothing when they cannot be read.
 */
export async function sharedRoutineNamesIn(queryClient: QueryClient, projectId: number): Promise<string[]> {
  let load = queryClient.getQueryData<RoutineLoad>(ROUTINES_QUERY_KEY)
  if (!load) {
    try {
      load = await queryClient.fetchQuery({ queryKey: ROUTINES_QUERY_KEY, queryFn: fetchCarriers, staleTime: 30_000 })
    } catch {
      return []
    }
  }
  const projects = queryClient.getQueryData<Project[]>(['projects']) ?? []
  const ids = new Set([projectId])
  for (let grew = true; grew;) {
    grew = false
    for (const project of projects) {
      if (!ids.has(project.id) && ids.has(project.parent_project_id)) {
        ids.add(project.id)
        grew = true
      }
    }
  }
  return [...ids].flatMap((id) => sharedRoutinesIn(id, load!.carriers))
}

// The latest archive problem that did not stop a write (pruning skipped); shown by the Routines view.
let archiveWarning: string | null = null
const archiveWarningListeners = new Set<() => void>()

function setArchiveWarning(message: string | null): void {
  archiveWarning = message
  archiveWarningListeners.forEach((listener) => listener())
}

function useArchiveWarning(): string | null {
  return useSyncExternalStore(
    (listener) => {
      archiveWarningListeners.add(listener)
      return () => { archiveWarningListeners.delete(listener) }
    },
    () => archiveWarning,
  )
}

function writeCarrier(
  carrier: RoutineCarrier<Task>,
  localPayload: RoutinePayload,
  changed: RoutineOccurrenceRecord[] = [],
  durationMinutes?: number | null,
): Promise<RoutineCarrier<Task>> {
  return writeRoutineCarrier(api, carrier, localPayload, { changed, durationMinutes, onArchiveError: setArchiveWarning })
    .then(({ task, payload, archiveError }) => {
      knownCarriers.set(task.id, payload)
      if (!archiveError) setArchiveWarning(null)
      return { task, payload }
    })
}

const NO_CARRIERS: RoutineCarrier<Task>[] = []

/** `enabled: false` reads the cache without fetching (a view that only asks while routines are switched on). */
export function useRoutines({ enabled = true }: { enabled?: boolean } = {}) {
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: ROUTINES_QUERY_KEY, queryFn: fetchCarriers, staleTime: 30_000, enabled })
  const { data: me } = useCurrentUser()
  const { snapshot: prefs } = useSyncedPrefs()

  useEffect(() => {
    if (query.data) void api.refreshRoutineReminders()
  }, [query.dataUpdatedAt])

  const settle = async () => {
    await queryClient.invalidateQueries({ queryKey: ['routines'] })
    await queryClient.invalidateQueries({ queryKey: ['routine-archive'] })
    await queryClient.invalidateQueries({ queryKey: ['tasks'] })
    await api.refreshRoutineReminders()
  }

  const createMutation = useMutation({
    /** `shareProjectId`: create it shared through that project in one request (section 6.9). */
    mutationFn: async (draft: RoutineDraft & { shareProjectId?: number }) => {
      const { shareProjectId, durationMinutes, ...fields } = draft
      const config = await api.getConfig()
      if (!config?.inbox_project_id) throw new Error('Choose an inbox project before creating routines')
      if (shareProjectId !== undefined && !navigator.onLine) throw new Error(SHARE_ROUTINE_OFFLINE)
      checkDraft(draft)
      const now = new Date().toISOString()
      const definition: RoutineDefinition = {
        ...fields,
        name: draft.name.trim(),
        kind: routineKindFor(draft.schedule),
        healthSubtype: null,
        amount: '',
        unit: '',
        slots: draftSlots(draft),
        id: newId(),
        activeFrom: localDateString(),
        archived: false,
        createdAt: now,
        updatedAt: now,
        updatedBy: deviceId(),
        ...(shareProjectId !== undefined ? { shared: true } : {}),
      }
      const payload: RoutinePayload = { version: 1, definition, occurrences: {}, prunedBefore: '' }
      // One request, already done: no window where an open carrier shows up in task lists.
      return createRoutineCarrier(api, shareProjectId ?? config.inbox_project_id, payload, durationMinutes)
    },
    onSettled: settle,
  })

  const updateMutation = useMutation({
    mutationFn: async ({ carrier, draft }: { carrier: RoutineCarrier<Task>; draft: RoutineDraft }) => {
      checkDraft(draft)
      const now = new Date().toISOString()
      const stored = carrier.payload.definition
      const { durationMinutes, ...fields } = draft
      const payload: RoutinePayload = {
        ...carrier.payload,
        definition: {
          ...stored,
          ...fields,
          name: draft.name.trim(),
          kind: routineKindFor(draft.schedule, stored.kind),
          healthSubtype: null,
          amount: '',
          unit: '',
          slots: draftSlots(draft),
          updatedAt: now,
          updatedBy: deviceId(),
        },
      }
      // An unchanged duration is not part of this edit: keep another device's newer marker.
      const durationChange = durationMinutes === parseTaskDuration(carrier.task.description) ? undefined : durationMinutes
      return writeCarrier(carrier, payload, [], durationChange)
    },
    onSettled: settle,
  })

  const statusMutation = useMutation({
    mutationFn: async ({
      carrier,
      date,
      slot,
      status,
      note = '',
    }: {
      carrier: RoutineCarrier<Task>
      date: string
      slot: RoutineSlot
      status: OccurrenceStatus
      note?: string
    }) => {
      // A shared routine's record says who logged it (section 6.9).
      const userId = isSharedRoutine(carrier.payload) ? (me?.id ?? (await api.ownUserId())) : null
      const record = statusRecord(carrier.payload, date, slot, status, note, userId)
      return writeCarrier(carrier, {
        ...carrier.payload,
        occurrences: { ...carrier.payload.occurrences, [record.key]: record },
      }, [record])
    },
    onSettled: settle,
  })

  const archiveMutation = useMutation({
    mutationFn: async ({ carrier, archived }: { carrier: RoutineCarrier<Task>; archived: boolean }) => {
      const now = new Date().toISOString()
      return writeCarrier(carrier, {
        ...carrier.payload,
        definition: {
          ...carrier.payload.definition,
          archived,
          updatedAt: now,
          updatedBy: deviceId(),
        },
      })
    },
    onSettled: settle,
  })

  const deleteMutation = useMutation({
    mutationFn: (carrier: RoutineCarrier<Task>) => deleteRoutine(api, carrier),
    onSettled: settle,
  })

  // Sharing moves the routine and its history between projects on the server (section 6.9), so it
  // is refused offline rather than half done.
  const shareMutation = useMutation({
    mutationFn: async ({ carrier, projectId }: { carrier: RoutineCarrier<Task>; projectId: number }) => {
      if (!navigator.onLine) throw new Error(SHARE_ROUTINE_OFFLINE)
      return shareRoutine(api, carrier, projectId, deviceId())
    },
    onSettled: settle,
  })

  const stopSharingMutation = useMutation({
    mutationFn: async (carrier: RoutineCarrier<Task>) => {
      if (!navigator.onLine) throw new Error(SHARE_ROUTINE_OFFLINE)
      const config = await api.getConfig()
      if (!config?.inbox_project_id) throw new Error('Choose an inbox project before you stop sharing a routine')
      return stopSharingRoutine(api, carrier, config.inbox_project_id, deviceId())
    },
    onSettled: settle,
  })

  const all = query.data?.carriers ?? NO_CARRIERS
  // A shared routine someone else owns that this account hid (section 6.9) leaves every list here.
  const hiddenHere = (carrier: RoutineCarrier<Task>) => hiddenForMe(carrier, me?.id, prefs.values)
  const carriers = useMemo(() => all.filter((carrier) => !hiddenHere(carrier)), [all, prefs, me])
  const hiddenShared = useMemo(() => all.filter(hiddenHere), [all, prefs, me])
  return {
    ...query,
    carriers,
    hiddenShared,
    updateRequired: query.data?.updateRequired ?? 0,
    unreadable: query.data?.unreadable ?? 0,
    active: carriers.filter((carrier) => !carrier.payload.definition.archived),
    archived: carriers.filter((carrier) => carrier.payload.definition.archived),
    today: routineDay(carriers.filter((carrier) => !carrier.payload.definition.archived)),
    shareRoutine: shareMutation,
    stopSharingRoutine: stopSharingMutation,
    createRoutine: createMutation,
    updateRoutine: updateMutation,
    setStatus: statusMutation,
    archiveRoutine: archiveMutation,
    deleteRoutine: deleteMutation,
    archiveWarning: useArchiveWarning(),
    loadCsvEntries: (): Promise<RoutineCsvEntry[]> => loadRoutineCsvEntries(api, carriers),
    isMutating: createMutation.isPending || updateMutation.isPending || statusMutation.isPending || archiveMutation.isPending || deleteMutation.isPending ||
      shareMutation.isPending || stopSharingMutation.isPending,
    error: query.error || createMutation.error || updateMutation.error || statusMutation.error || archiveMutation.error || deleteMutation.error ||
      shareMutation.error || stopSharingMutation.error,
  }
}

/**
 * A routine's history, newest first: the carrier's occurrences at once, with the archive parts
 * merged in once they have loaded. The archive is only fetched here (the History view), never
 * for the Today and Routines day views.
 */
export function useRoutineHistory(carrier?: RoutineCarrier<Task>) {
  const needsArchive = !!carrier && carrier.payload.prunedBefore !== ''
  const archive = useQuery({
    queryKey: ['routine-archive', carrier?.payload.definition.id, carrier?.task.id, carrier?.payload.prunedBefore],
    queryFn: () => loadRoutineArchive(api, carrier!),
    enabled: needsArchive,
    staleTime: 30_000,
  })
  const records = useMemo(() => {
    if (!carrier) return []
    const history = readRoutineHistory(carrier.payload.definition.id, carrier.payload.occurrences, archive.data ?? [])
    return Object.values(history).sort((left, right) =>
      right.scheduledDate.localeCompare(left.scheduledDate) || right.scheduledMinutes - left.scheduledMinutes)
  }, [carrier, archive.data])
  return {
    records,
    loadingArchive: needsArchive && archive.isPending,
    archiveError: archive.error instanceof Error ? archive.error.message : null,
  }
}
