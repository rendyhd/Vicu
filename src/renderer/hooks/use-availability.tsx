import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTasks } from './use-tasks'
import { useProjects } from './use-projects'
import { useSyncedPrefs } from './use-synced-prefs'
import { useProLedger } from './use-pro-ledger'
import { usePro, useSaveProConfig } from './use-pro'
import { useDateFormat } from './use-date-format'
import type { Task } from '@/lib/vikunja-types'
import {
  availabilityContext,
  filterByView,
  readAvailabilityView,
  type Availability,
  type AvailabilityContext,
  type AvailabilityReason,
  type AvailabilityTask,
  type AvailabilityView,
} from '../../shared/pro/availability'
import { startDateOf } from '../../shared/pro/start-dates'
import { formatWeekdayDate } from '../../shared/date-display'

/**
 * Availability (cross-app semantics 21.2) for every list of this window. Built once in AppShell from
 * every open task, the projects, the synced preferences and the ledger, while the availability layer
 * is on; off, `of` answers null and nothing changes anywhere (O1).
 */
interface AvailabilityState {
  on: boolean
  of: (task: AvailabilityTask) => Availability | null
  /** Open tasks by id, for the "After: <title>" text. */
  titleOf: (id: number) => string | null
  cycles: readonly number[]
  now: Date
}

const OFF: AvailabilityState = { on: false, of: () => null, titleOf: () => null, cycles: [], now: new Date(0) }

const AvailabilityStateContext = createContext<AvailabilityState>(OFF)

/** The open tasks the guided world reads too: one request for both. */
export const OPEN_TASKS_PARAMS = { filter: 'done = false', keep_nested_subtasks: true } as const

export function AvailabilityProvider({ children }: { children: ReactNode }) {
  const pro = usePro()
  const on = pro.layer('availability')
  const open = useTasks(OPEN_TASKS_PARAMS, on)
  const { data: projects } = useProjects()
  const { snapshot } = useSyncedPrefs()
  const { ledger } = useProLedger()
  const [now, setNow] = useState(() => new Date())

  // A start date passes while the window is open: look again every minute.
  useEffect(() => {
    if (!on) return
    setNow(new Date())
    const timer = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(timer)
  }, [on])

  const value = useMemo<AvailabilityState>(() => {
    if (!on || !open.isSuccess || !projects) return OFF
    const context: AvailabilityContext = availabilityContext({
      now,
      tasks: open.data,
      projects: projects.flat,
      prefs: snapshot.values,
      ledger,
    })
    const titles = new Map(open.data.map((task) => [task.id, task.title]))
    const cache = new WeakMap<object, Availability>()
    return {
      on: true,
      now,
      cycles: context.cycles,
      titleOf: (id) => titles.get(id) ?? null,
      of: (task) => {
        const cached = cache.get(task)
        if (cached) return cached
        const answer = context.of(task)
        cache.set(task, answer)
        return answer
      },
    }
  }, [on, open.isSuccess, open.data, projects, snapshot.values, ledger, now])

  return <AvailabilityStateContext.Provider value={value}>{children}</AvailabilityStateContext.Provider>
}

export function useAvailability(): AvailabilityState {
  return useContext(AvailabilityStateContext)
}

/** The words a row shows for its first reason (design system 9). */
export function useReasonText(): (task: Task, availability: Availability) => string | null {
  const { titleOf, now } = useAvailability()
  const fmt = useDateFormat()
  return useCallback(
    (task, availability) => {
      const reason: AvailabilityReason | undefined = availability.reasons[0]
      switch (reason) {
        case 'starts': {
          const start = startDateOf(task)
          return start ? `Starts ${formatWeekdayDate(start, now, fmt)}` : 'Starts later'
        }
        case 'on_hold':
          return 'On hold'
        case 'waiting':
          return 'Waiting'
        case 'after': {
          const first = availability.blockers[0]
          const title = first !== undefined ? titleOf(first) : null
          const more = availability.blockers.length > 1 ? ` and ${availability.blockers.length - 1} more` : ''
          return title ? `After: ${title}${more}` : 'After another task'
        }
        case 'sequence':
          return 'Later in sequence'
        case 'theirs':
          return 'Their promise'
        default:
          return null
      }
    },
    [titleOf, now, fmt],
  )
}

/**
 * A list's Available / Remaining / All choice (21.2), per device and list (`pro_list_views`). The
 * default is Available. `filter` keeps what the choice shows; `hidden` counts what it leaves out.
 */
export function useAvailabilityView(listKey: string) {
  const { on, of } = useAvailability()
  const { config } = usePro()
  const save = useSaveProConfig()
  const view: AvailabilityView = readAvailabilityView(config?.pro_list_views?.[listKey]) ?? 'available'
  const setView = useCallback(
    (next: AvailabilityView) => void save({ pro_list_views: { ...(config?.pro_list_views ?? {}), [listKey]: next } }),
    [save, config?.pro_list_views, listKey],
  )
  const context = useMemo<AvailabilityContext>(() => ({ of: (task) => of(task) ?? { available: true, reasons: [], next: false, blockers: [] }, cycles: [] }), [of])
  const filter = useCallback(
    <T extends AvailabilityTask>(tasks: readonly T[]): T[] => (on ? filterByView(tasks, view, context) : [...tasks]),
    [on, view, context],
  )
  const hidden = useCallback(
    (tasks: readonly AvailabilityTask[]): number => (on ? tasks.length - filterByView(tasks, view, context).length : 0),
    [on, view, context],
  )
  return { on, view, setView, filter, hidden }
}
