import { useMemo } from 'react'
import { useTasks } from './use-tasks'
import { OPEN_TASKS_PARAMS } from './use-availability'
import { useProLedger } from './use-pro-ledger'
import { useProPrefs } from './use-pro-prefs'
import { usePromiseOf } from './use-promises'
import { usePersonLabels } from './use-people'
import { usePro } from './use-pro'
import type { Label, Task } from '@/lib/vikunja-types'
import type { ProLedger, PromiseValue } from '../../shared/pro/ledger'

export interface PromiseWorld {
  on: boolean
  isLoading: boolean
  ledger: ProLedger
  /** Every open task (hidden ones left out by the list). */
  open: Task[]
  openById: Map<number, Task>
  promiseFor: (task: Pick<Task, 'id' | 'project_id'>) => PromiseValue | null
  people: Map<number, Label>
  nameOf: (personId: number | null | undefined) => string
  isOnHoldLabel: (labelId: number) => boolean
  isPerson: (labelId: number) => boolean
}

/** What the promise pages read (cross-app semantics 21.5, 21.6), while the promises layer is on. */
export function usePromiseWorld(): PromiseWorld {
  const pro = usePro()
  const on = pro.layer('promises')
  const { data: open = [], isLoading } = useTasks(OPEN_TASKS_PARAMS, on)
  const { ledger } = useProLedger()
  const prefs = useProPrefs()
  const promiseFor = usePromiseOf()
  const people = usePersonLabels()
  return useMemo(() => {
    const openById = new Map(open.map((task) => [task.id, task]))
    return {
      on,
      isLoading,
      ledger,
      open,
      openById,
      promiseFor,
      people,
      nameOf: (id) => (id != null ? people.get(id)?.title ?? 'Someone' : 'No one'),
      isOnHoldLabel: prefs.labelOnHold,
      isPerson: prefs.isPerson,
    }
  }, [on, isLoading, ledger, open, promiseFor, people, prefs])
}
