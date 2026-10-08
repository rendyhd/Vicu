import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useSearchTasks } from '@/hooks/use-search-tasks'
import { QUICK_FIND_DEBOUNCE_MS, QUICK_FIND_LIMIT, collectCachedTasks, quickFindTasks } from '@/lib/quick-find'
import type { Task } from '@/lib/vikunja-types'

/** The value, once it has stopped changing for `ms`. */
function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return settled
}

/**
 * Tasks matching what is typed. The ones the app already has cached show at once; the server's
 * answer for the same words (asked 250 ms after typing stops) is merged in when it arrives.
 * `pending` is true while that answer is still to come.
 */
export function useQuickFindTasks(query: string, limit = QUICK_FIND_LIMIT): { tasks: Task[]; pending: boolean } {
  const trimmed = query.trim()
  const qc = useQueryClient()
  const settled = useDebounced(trimmed, QUICK_FIND_DEBOUNCE_MS)
  const server = useSearchTasks(settled)

  // The cache is read whenever the query changes or the server's answer lands (which also fills it).
  const serverTasks = server.data
  const tasks = useMemo(() => {
    if (trimmed === '') return []
    const cached = collectCachedTasks(qc.getQueryCache().findAll({ queryKey: ['tasks'] }).map((entry) => entry.state.data))
    return quickFindTasks(trimmed, cached, settled === trimmed && serverTasks ? serverTasks : [], limit)
  }, [qc, trimmed, settled, serverTasks, limit])

  return { tasks, pending: trimmed !== '' && (settled !== trimmed || server.isFetching) }
}
