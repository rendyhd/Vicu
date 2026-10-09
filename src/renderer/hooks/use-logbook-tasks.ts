import { useCallback, useMemo, useRef, useState } from 'react'
import { useQueries, type UseQueryResult } from '@tanstack/react-query'
import { useMatches } from '@tanstack/react-router'
import { api } from '@/lib/api'
import { useFilters } from '@/hooks/use-filters'
import { useCompletedTasksStore } from '@/stores/completed-tasks-store'
import { logbookHasMore, logbookPageParams, logbookTasks } from '@/lib/logbook'
import { mergeSmartListUndoWindow } from '@/lib/undo-window'
import type { Task } from '@/lib/vikunja-types'

function combinePages(results: UseQueryResult<Task[], Error>[]) {
  const last = results[results.length - 1]
  return {
    pages: results.map((result) => result.data),
    isLoading: results[0]?.isLoading ?? true,
    firstError: results[0]?.error ?? null,
    isLoadingMore: results.length > 1 && !!last && last.data === undefined && last.isFetching,
    moreError: results.length > 1 && last?.isError ? last : null,
  }
}

/**
 * The completed tasks, newest first, loaded a page at a time: the first page on mount, the next
 * ones as the user scrolls (`loadMore`). Each page is an ordinary `['tasks', params]` query, so
 * the offline cache, the optimistic updates and every invalidation treat it like the other lists.
 */
export function useLogbookTasks() {
  const base = useFilters({ view: 'logbook' })
  const matches = useMatches()
  const pathname = matches[matches.length - 1]?.pathname ?? ''
  const completedTasks = useCompletedTasksStore((s) => s.tasks)
  const [pageCount, setPageCount] = useState(1)

  const { pages, isLoading, firstError, isLoadingMore, moreError } = useQueries({
    queries: Array.from({ length: pageCount }, (_, index) => {
      const params = logbookPageParams(base, index + 1)
      return {
        queryKey: ['tasks', params] as const,
        queryFn: async (): Promise<Task[]> => {
          const result = await api.fetchTasks(params)
          if (!result.success) throw new Error(result.error)
          return result.data ?? []
        },
      }
    }),
    combine: combinePages,
  })

  // Tasks reopened here stay visible, without strikethrough, until the user navigates away, in their
  // place in the last result.
  const previous = useRef<Task[]>([])
  const tasks = useMemo(() => {
    const merged = mergeSmartListUndoWindow(logbookTasks(pages), completedTasks, pathname, previous.current)
    previous.current = merged
    return merged
  }, [pages, completedTasks, pathname])

  const hasMore = logbookHasMore(pages)
  const loadMore = useCallback(() => {
    if (hasMore) setPageCount((count) => count + 1)
  }, [hasMore])
  const retryMore = useCallback(() => {
    void moreError?.refetch()
  }, [moreError])

  return {
    tasks,
    isLoading,
    error: firstError,
    hasMore,
    isLoadingMore,
    moreError: moreError?.error ?? null,
    loadMore,
    retryMore,
  }
}
