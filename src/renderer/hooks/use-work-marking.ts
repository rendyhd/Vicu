import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { workMarkWrite } from '@/lib/work-marking'
import { writeSyncedPrefs } from './use-synced-prefs'
import { useWorkMode } from './use-work-mode'

/**
 * Marks a project as work or not (cross-app semantics 22.7). Writes the project's own synced entry
 * only: none when it would be what the person wants without one, else true or false.
 */
export function useMarkWorkProject(): (project: { id: number; parent_project_id?: number | null }, want: boolean) => Promise<boolean> {
  const queryClient = useQueryClient()
  const { isWorkProject } = useWorkMode()
  return useCallback(
    (project, want) => writeSyncedPrefs(queryClient, workMarkWrite(project, want, isWorkProject)),
    [queryClient, isWorkProject],
  )
}
