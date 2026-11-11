import { useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from '@/stores/toast-store'
import { announce } from '@/stores/announcer-store'
import type { LocalDate } from '../../shared/due-dates'
import type { CalendarEvent } from '../../shared/calendar-events'
import {
  encodePlanEvent,
  eventKey,
  planEventOccurrences,
  readPlanEvents,
  type ListedEvent,
  type PlanEvent,
} from '../../shared/plan-events'
import { useSyncedPrefs, writeSyncedPrefs } from './use-synced-prefs'

// Events (proof of concept): times you are not available, typed by hand, one synced preference
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

/** Add, change, skip one day of, or delete an Event; a delete has Undo. */
export function usePlanEventActions() {
  const client = useQueryClient()
  const write = (id: string, event: PlanEvent | null) => writeSyncedPrefs(client, { [eventKey(id)]: event ? encodePlanEvent(event) : null })
  return {
    add: async (event: PlanEvent) => {
      const id = newId()
      if (await write(id, event)) announce(`Added ${event.title}`)
      return id
    },
    update: (id: string, event: PlanEvent) => write(id, event),
    skip: async (event: ListedEvent, day: LocalDate) => {
      const { id, ...rest } = event
      if (!(await write(id, { ...rest, skips: [...(rest.skips ?? []), day] }))) return
      toast.success(`Skipped ${event.title} this time`, {
        action: { label: 'Undo', onAction: () => void write(id, rest) },
      })
    },
    remove: async (event: ListedEvent) => {
      const { id, ...rest } = event
      if (!(await write(id, null))) return
      toast.success(`Deleted ${event.title}`, {
        action: { label: 'Undo', onAction: () => void write(id, rest) },
      })
    },
  }
}
