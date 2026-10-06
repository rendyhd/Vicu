import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { handleReplayed } from '@/lib/replay-handler'
import { insertPendingTask, pendingTaskFromCreate } from '@/lib/pending-cache'
import { useOfflineStore } from '@/stores/offline-store'
import { useSelectionStore } from '@/stores/selection-store'
import { useCompletedTasksStore } from '@/stores/completed-tasks-store'
import { toast } from '@/stores/toast-store'

/** The queue sends one change event per step of a replay; the full snapshot is fetched at most this often. */
const SNAPSHOT_DEBOUNCE_MS = 150

/**
 * Keep the renderer's picture of the main-process offline queue current, and react when a replay
 * lands: swap temp ids for real ones, refetch the lists once the queue is empty, and say so when
 * changes start waiting (D-SYNC-6). Mount once, in the app shell.
 */
export function useOfflineQueueSync(): void {
  const qc = useQueryClient()

  useEffect(() => {
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const loadSnapshot = async () => {
      try {
        const result = await api.offlineQueue.snapshot()
        if (disposed || !result.success) return
        useOfflineStore.getState().setSnapshot(result.data)
        return result.data
      } catch {
        return undefined
      }
    }
    const scheduleSnapshot = () => {
      if (timer !== null) return
      timer = setTimeout(() => {
        timer = null
        void loadSnapshot()
      }, SNAPSHOT_DEBOUNCE_MS)
    }

    void loadSnapshot().then((snapshot) => {
      if (!snapshot) return
      if (snapshot.loadStatus === 'corrupt') {
        toast.error('The saved offline changes could not be read, so changes made while offline before now are lost.')
      }
      // Tasks created offline in an earlier session: make sure the lists restored from the last
      // session show them (the copy may have been saved just before they were created).
      for (const item of snapshot.pending) {
        if (!item.create) continue
        insertPendingTask(qc, pendingTaskFromCreate(item.create.tempId, item.create.projectId, item.create.fields, {
          now: item.createdAt,
          done: item.create.done,
        }))
      }
    })

    const offChanged = api.offlineQueue.onChanged((change) => {
      const before = useOfflineStore.getState().counts.pending
      useOfflineStore.getState().applyChange(change)
      // The first change to start waiting is the moment the user needs to hear that it was kept.
      if (before === 0 && change.counts.pending > 0) {
        toast.info('Saved on this computer. Changes sync automatically when the server is reachable.')
      }
      scheduleSnapshot()
    })

    const offReplayed = api.offlineQueue.onReplayed((event) => {
      handleReplayed(qc, event, {
        remapStores: (idMap) => {
          useSelectionStore.getState().remapTaskIds(idMap)
          useCompletedTasksStore.getState().remapTaskIds(idMap)
        },
        refreshReminders: () => {
          void api.refreshTaskReminders()
        },
      })
      scheduleSnapshot()
    })

    // Coming back online is the moment waiting changes can go out; the main process only polls
    // every few minutes.
    const onOnline = () => {
      if (useOfflineStore.getState().counts.pending > 0) void api.offlineQueue.replayNow()
    }
    window.addEventListener('online', onOnline)

    return () => {
      disposed = true
      if (timer !== null) clearTimeout(timer)
      offChanged()
      offReplayed()
      window.removeEventListener('online', onOnline)
    }
  }, [qc])
}
