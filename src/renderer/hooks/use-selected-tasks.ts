import { useEffect, useMemo, useReducer } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { resolveSelectedTasks } from '@/lib/task-selection'
import type { Task } from '@/lib/vikunja-types'

/**
 * The tasks of a multi-selection, read from the query caches and kept current: a bulk change
 * builds its merge patch against the task as it is now, not as it was when the selection was made.
 */
export function useSelectedTasks(ids: Set<number>): Task[] {
  const qc = useQueryClient()
  const [version, bump] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    if (ids.size === 0) return
    return qc.getQueryCache().subscribe((event) => {
      if (event.type === 'updated') bump()
    })
  }, [qc, ids])
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` is the cache change signal
  return useMemo(() => resolveSelectedTasks(qc, ids), [qc, ids, version])
}
