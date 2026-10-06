import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { api } from '@/lib/api'
import {
  createRoutineCarrier,
  deleteRoutine,
  loadRoutineCsvEntries,
  loadRoutineArchive,
  writeRoutineCarrier,
} from '@/lib/routine-store'
import type { Task } from '@/lib/vikunja-types'
import {
  deviceId,
  localDateString,
  newId,
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
  type RoutineSlot,
} from '@/lib/routines'

export interface RoutineDraft extends Omit<RoutineDefinition, 'id' | 'activeFrom' | 'archived' | 'createdAt' | 'updatedAt' | 'updatedBy'> {}

async function fetchCarriers(): Promise<RoutineCarrier<Task>[]> {
  const result = await api.fetchTasks({ filter: 'done = true', sort_by: 'updated', order_by: 'desc', per_page: 200 })
  if (!result.success) throw new Error(result.error)
  return result.data.flatMap((task) => {
    const parsed = parseRoutineEnvelope(task.description)
    return parsed.payload ? [{ task, payload: parsed.payload }] : []
  }).sort((left, right) => left.payload.definition.createdAt.localeCompare(right.payload.definition.createdAt))
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
): Promise<RoutineCarrier<Task>> {
  return writeRoutineCarrier(api, carrier, localPayload, { changed, onArchiveError: setArchiveWarning })
    .then(({ task, payload, archiveError }) => {
      if (!archiveError) setArchiveWarning(null)
      return { task, payload }
    })
}

export function useRoutines() {
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: ['routines'], queryFn: fetchCarriers, staleTime: 30_000 })

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
    mutationFn: async (draft: RoutineDraft) => {
      const config = await api.getConfig()
      if (!config?.inbox_project_id) throw new Error('Choose an inbox project before creating routines')
      if (!draft.name.trim()) throw new Error('Give this routine a name')
      if (draft.slots.length === 0) throw new Error('Add at least one time')
      const now = new Date().toISOString()
      const definition: RoutineDefinition = {
        ...draft,
        name: draft.name.trim(),
        amount: draft.amount.trim(),
        unit: draft.unit.trim(),
        slots: draft.slots.map((slot) => ({ ...slot, id: slot.id || newId() })),
        id: newId(),
        activeFrom: localDateString(),
        archived: false,
        createdAt: now,
        updatedAt: now,
        updatedBy: deviceId(),
      }
      const payload: RoutinePayload = { version: 1, definition, occurrences: {}, prunedBefore: '' }
      // One request, already done: no window where an open carrier shows up in task lists.
      return createRoutineCarrier(api, config.inbox_project_id, payload)
    },
    onSettled: settle,
  })

  const updateMutation = useMutation({
    mutationFn: async ({ carrier, draft }: { carrier: RoutineCarrier<Task>; draft: RoutineDraft }) => {
      const now = new Date().toISOString()
      const payload: RoutinePayload = {
        ...carrier.payload,
        definition: {
          ...carrier.payload.definition,
          ...draft,
          name: draft.name.trim(),
          amount: draft.amount.trim(),
          unit: draft.unit.trim(),
          healthSubtype: draft.kind === 'HEALTH' ? draft.healthSubtype : null,
          slots: draft.slots.map((slot) => ({ ...slot, id: slot.id || newId() })),
          updatedAt: now,
          updatedBy: deviceId(),
        },
      }
      return writeCarrier(carrier, payload)
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
      const record = statusRecord(carrier.payload, date, slot, status, note)
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

  const carriers = query.data ?? []
  return {
    ...query,
    carriers,
    active: carriers.filter((carrier) => !carrier.payload.definition.archived),
    archived: carriers.filter((carrier) => carrier.payload.definition.archived),
    today: routineDay(carriers.filter((carrier) => !carrier.payload.definition.archived)),
    createRoutine: createMutation,
    updateRoutine: updateMutation,
    setStatus: statusMutation,
    archiveRoutine: archiveMutation,
    deleteRoutine: deleteMutation,
    archiveWarning: useArchiveWarning(),
    loadCsvEntries: (): Promise<RoutineCsvEntry[]> => loadRoutineCsvEntries(api, carriers),
    isMutating: createMutation.isPending || updateMutation.isPending || statusMutation.isPending || archiveMutation.isPending || deleteMutation.isPending,
    error: query.error || createMutation.error || updateMutation.error || statusMutation.error || archiveMutation.error || deleteMutation.error,
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
