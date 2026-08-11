import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import { api } from '@/lib/api'
import type { Task } from '@/lib/vikunja-types'
import {
  NULL_DATE,
  deviceId,
  localDateString,
  mergeRoutinePayload,
  newId,
  parseRoutineEnvelope,
  routineDay,
  statusRecord,
  upsertRoutineEnvelope,
  type OccurrenceStatus,
  type RoutineCarrier,
  type RoutineDefinition,
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

async function writeCarrier(carrier: RoutineCarrier<Task>, localPayload: RoutinePayload): Promise<RoutineCarrier<Task>> {
  const freshResult = await api.fetchTaskById(carrier.task.id)
  if (!freshResult.success) throw new Error(freshResult.error)
  const fresh = freshResult.data
  const parsed = parseRoutineEnvelope(fresh.description)
  const payload = parsed.payload ? mergeRoutinePayload(localPayload, parsed.payload) : localPayload
  const result = await api.updateTask(fresh.id, {
    title: payload.definition.name,
    description: upsertRoutineEnvelope(parsed.body, payload),
    done: true,
    done_at: fresh.done_at || new Date().toISOString(),
    due_date: NULL_DATE,
    repeat_after: 0,
    repeat_mode: 0,
    reminders: [],
  })
  if (!result.success) throw new Error(result.error)
  return { task: result.data, payload }
}

export function useRoutines() {
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: ['routines'], queryFn: fetchCarriers, staleTime: 30_000 })

  useEffect(() => {
    if (query.data) void api.refreshRoutineReminders()
  }, [query.dataUpdatedAt])

  const settle = async () => {
    await queryClient.invalidateQueries({ queryKey: ['routines'] })
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
      const created = await api.createTask(config.inbox_project_id, {
        title: definition.name,
        description: upsertRoutineEnvelope('', payload),
      })
      if (!created.success) throw new Error(created.error)
      const completed = await api.updateTask(created.data.id, {
        done: true,
        done_at: now,
        due_date: NULL_DATE,
        repeat_after: 0,
        repeat_mode: 0,
        reminders: [],
      })
      if (!completed.success) throw new Error(completed.error)
      return { task: completed.data, payload }
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
      })
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
    mutationFn: async (carrier: RoutineCarrier<Task>) => {
      const result = await api.deleteTask(carrier.task.id)
      if (!result.success) throw new Error(result.error)
    },
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
    isMutating: createMutation.isPending || updateMutation.isPending || statusMutation.isPending || archiveMutation.isPending || deleteMutation.isPending,
    error: query.error || createMutation.error || updateMutation.error || statusMutation.error || archiveMutation.error || deleteMutation.error,
  }
}

export function useRoutineHistory(carrier?: RoutineCarrier<Task>) {
  return useMemo(() => carrier ? Object.values(carrier.payload.occurrences).sort((left, right) =>
    right.scheduledDate.localeCompare(left.scheduledDate) || right.scheduledMinutes - left.scheduledMinutes
  ) : [], [carrier])
}
