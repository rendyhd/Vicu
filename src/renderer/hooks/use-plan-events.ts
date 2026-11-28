import { useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from '@/stores/toast-store'
import { announce } from '@/stores/announcer-store'
import { t } from '../../shared/i18n'
import type { LocalDate } from '../../shared/due-dates'
import type { CalendarEvent } from '../../shared/calendar-events'
import {
  changeEvent,
  deleteEvent,
  encodePlanEvent,
  eventKey,
  occurrenceId,
  planEventOccurrences,
  readPlanEvents,
  skipEventDay,
  undoEventWrites,
  type EventEdit,
  type EventScope,
  type EventWrites,
  type ListedEvent,
  type PlanEvent,
} from '../../shared/plan-events'
import type { SyncedPrefsSnapshot } from '../../shared/synced-prefs'
import { SYNCED_PREFS_QUERY_KEY, useSyncedPrefs, writeSyncedPrefs } from './use-synced-prefs'

// Events (contract section 20): times you are not available, typed by hand, one synced preference
// each (`event.<id>`), so every device has them. Shown on the Plan screen only.

const EMPTY: CalendarEvent[] = []

export function usePlanEvents(days?: readonly LocalDate[]): { events: ListedEvent[]; occurrences: CalendarEvent[] } {
  const { snapshot } = useSyncedPrefs()
  const events = useMemo(() => readPlanEvents(snapshot.values), [snapshot.values])
  const key = days?.join() ?? ''
  const occurrences = useMemo(() => (days ? planEventOccurrences(events, days) : EMPTY), [events, key])
  return { events, occurrences }
}

function newId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 16)
}

/** Add, change, skip one day of, or delete an Event; a change, skip or delete has Undo (20.6). */
export function usePlanEventActions() {
  const client = useQueryClient()
  const write = (id: string, event: PlanEvent | null) => writeSyncedPrefs(client, { [eventKey(id)]: event ? encodePlanEvent(event) : null })
  /** Writes `writes` and offers Undo, which puts back the stored values as they were. */
  const writeWithUndo = async (writes: EventWrites, message: string) => {
    const before = client.getQueryData<SyncedPrefsSnapshot>(SYNCED_PREFS_QUERY_KEY)?.values ?? {}
    const undo = undoEventWrites(writes, before)
    if (!(await writeSyncedPrefs(client, writes))) return false
    toast.success(message, { action: { label: t('events.undo'), onAction: () => void writeSyncedPrefs(client, undo) } })
    return true
  }
  return {
    add: async (event: PlanEvent) => {
      const id = newId()
      if (await write(id, event)) announce(t('events.added', { title: event.title }))
      return id
    },
    update: (id: string, event: PlanEvent) => write(id, event),
    /**
     * A change to the occurrence on `day`: all times, this time only, or this and following. Gives
     * the id of the occurrence afterwards (a split moves it to the new Event), or null when the
     * write failed.
     */
    change: async (event: ListedEvent, day: LocalDate, edit: EventEdit, scope: EventScope): Promise<string | null> => {
      const split = newId()
      const writes = changeEvent(event, day, edit, scope, split)
      if (!(await writeWithUndo(writes, t('events.changed', { title: event.title })))) return null
      return occurrenceId(eventKey(split) in writes ? split : event.id, edit.day ?? day)
    },
    skip: (event: ListedEvent, day: LocalDate) => writeWithUndo(skipEventDay(event, day), t('events.skippedThisTime', { title: event.title })),
    /**
     * Add many Events in one change (importing a calendar file, 20.10), each with a new id, with one
     * Undo that deletes them again. Gives whether the write went through.
     */
    addMany: async (events: readonly PlanEvent[]): Promise<boolean> => {
      const ids = events.map(() => newId())
      const writes: Record<string, unknown> = {}
      events.forEach((event, i) => {
        writes[eventKey(ids[i])] = encodePlanEvent(event)
      })
      if (!(await writeSyncedPrefs(client, writes))) return false
      const undo = Object.fromEntries(ids.map((id) => [eventKey(id), null]))
      const message = t('events.imported', { count: events.length })
      toast.success(message, { action: { label: t('events.undo'), onAction: () => void writeSyncedPrefs(client, undo) } })
      announce(message)
      return true
    },
    remove: (event: ListedEvent) => writeWithUndo(deleteEvent(event), t('events.deleted', { title: event.title })),
  }
}
