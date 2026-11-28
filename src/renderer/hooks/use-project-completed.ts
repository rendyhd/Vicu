import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueries, useQuery, type UseQueryResult } from '@tanstack/react-query'
import { api } from '@/lib/api'
import {
  projectDoneCount,
  projectDoneCountPlan,
  projectDoneHasMore,
  projectDoneLabelFilter,
  projectDonePageParams,
  projectDoneRows,
} from '@/lib/project-completed'
import type { Task } from '@/lib/vikunja-types'
import { useSetSyncedPreference, useSyncedPrefs } from './use-synced-prefs'
import { useProjectDoneCount } from './use-project-progress'
import { parentTaskId, useWorkMode } from './use-work-mode'
import { PROJECTS_SHOW_DONE_KEY, projectsShowDoneValue, readProjectsShowDone } from '../../shared/synced-prefs'
import { workModeClause } from '../../shared/work-scope'

/**
 * "Show completed tasks" (Settings, Projects; cross-app semantics 12.6, synced as
 * `projects.show_done`): on writes `true`, off writes `null`, so the reset reaches every device.
 */
export function useShowDoneSetting() {
  const { snapshot } = useSyncedPrefs()
  const set = useSetSyncedPreference()
  return {
    on: readProjectsShowDone(snapshot.values[PROJECTS_SHOW_DONE_KEY]),
    setOn: (on: boolean) => set.mutate({ key: PROJECTS_SHOW_DONE_KEY, value: projectsShowDoneValue(on) }),
  }
}

function combinePages(results: UseQueryResult<Task[], Error>[]) {
  const last = results[results.length - 1]
  return {
    pages: results.map((result) => result.data),
    refetchAll: () => { for (const result of results) void result.refetch() },
    isLoading: results[0]?.isLoading ?? false,
    error: results.find((result) => result.isError)?.error ?? null,
    isLoadingMore: results.length > 1 && !!last && last.data === undefined && last.isFetching,
    failed: results.find((result) => result.isError) ?? null,
  }
}

/**
 * A project's Completed row: how many done tasks the project has itself, and, while `open`, those
 * tasks a page at a time, newest completion first. It follows the Work and Personal mode as the
 * Logbook does (section 22; `showAll` is the project screen's "Show" of the other mode's tasks).
 * `shownAbove` are the rows the open list already shows (a task held there after its completion).
 */
export function useProjectCompleted(projectId: number, open: boolean, shownAbove: ReadonlySet<number>, showAll = false) {
  const work = useWorkMode()
  const mode = showAll ? 'all' : work.mode
  const plan = useMemo(() => projectDoneCountPlan(projectId, work.scope, mode), [projectId, work.scope, mode])
  const { clause } = useMemo(() => workModeClause(work.scope, mode), [work.scope, mode])

  // The count: the cheap one-task totals (the sidebar ring's own count for the whole project, and
  // the done tasks with the work label when the mode needs them).
  const all = useProjectDoneCount(projectId, plan.kind === 'all' || plan.kind === 'allButLabelled')
  const label = plan.kind === 'labelled' || plan.kind === 'allButLabelled' ? plan.label : null
  const labelled = useQuery({
    queryKey: ['project-counts', projectId, 'done', 'label', label],
    queryFn: async () => {
      const result = await api.countTasks(projectDoneLabelFilter(projectId, label!))
      if (!result.success) throw new Error(result.error)
      return result.data
    },
    enabled: label !== null,
    staleTime: 60_000,
    retry: false,
    meta: { silent: true },
  })
  const count = projectDoneCount(plan, all, labelled.data)

  // The tasks, only while the row is open. Each page is an ordinary `['tasks', params]` query, so a
  // reopen updates it in place like every other list.
  const [pageCount, setPageCount] = useState(1)
  const listed = open && plan.kind !== 'none'
  const { pages, refetchAll, isLoading, error, isLoadingMore, failed } = useQueries({
    queries: Array.from({ length: listed ? pageCount : 0 }, (_, index) => {
      const params = projectDonePageParams(projectId, clause, index + 1)
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

  // A completion or a reopen elsewhere changes the count; the open list follows it.
  const lastCount = useRef(count)
  const refetchRef = useRef(refetchAll)
  refetchRef.current = refetchAll
  useEffect(() => {
    const before = lastCount.current
    lastCount.current = count
    if (listed && before !== undefined && count !== undefined && before !== count) refetchRef.current()
  }, [count, listed])

  const tasks = useMemo(() => {
    const rows = projectDoneRows(pages, shownAbove)
    return mode === 'all' ? rows : work.filter(rows, parentTaskId)
  }, [pages, shownAbove, mode, work.filter])

  const hasMore = listed && projectDoneHasMore(pages)
  const loadMore = useCallback(() => {
    if (hasMore) setPageCount((value) => value + 1)
  }, [hasMore])
  const retry = useCallback(() => { void failed?.refetch() }, [failed])

  return { count, tasks, isLoading: listed && isLoading, isLoadingMore, error, hasMore, loadMore, retry }
}
