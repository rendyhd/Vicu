import { useId, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, LogIn, RefreshCw, X } from 'lucide-react'
import { api } from '@/lib/api'
import { invalidateTaskData, refreshTasks } from '@/lib/task-refresh'
import { removePendingTasks } from '@/lib/pending-cache'
import { confirmDelete } from '@/lib/confirm-bridge'
import { toast } from '@/stores/toast-store'
import { formatAbsoluteDateTime } from '@/lib/date-utils'
import { useDateFormat } from '@/hooks/use-date-format'
import { useOfflineStore } from '@/stores/offline-store'
import { useUIStore } from '@/stores/ui-store'
import { UNSYNCED_DOCUMENTS_QUERY_KEY, useUnsyncedDocuments } from '@/hooks/use-unsynced-documents'
import { discardDocumentsPrompt, unsyncedDocumentItems } from '@/lib/unsynced-documents'
import { Dialog } from '@/components/overlay/Dialog'
import type { OfflineFailedItemView, OfflineFailureReason } from '../../../shared/offline-queue-types'

/** Why a change ended up in the failed log, in words the user can act on. */
export function failureReasonLabel(reason: OfflineFailureReason): string {
  switch (reason) {
    case 'rejected':
      return 'The server refused this change.'
    case 'too-large':
      return 'The file is too large for the server. Retry after making it smaller or raising the limit.'
    case 'conflict':
      return 'The task was changed elsewhere in a way that conflicts.'
    case 'task-gone':
      return 'The task no longer exists.'
    case 'not-found':
      return 'Something this change refers to no longer exists.'
    case 'dependency-failed':
      return 'Not sent, because the task it belongs to could not be created.'
    case 'gave-up':
      return 'Stopped after repeated errors.'
    case 'other-account':
      return 'Made while signed in to a different account, so it was not sent.'
    case 'forbidden':
      return 'You are no longer allowed to make this change in the project.'
    case 'token-permission':
      return 'Your API token is not allowed to make this change.'
    case 'no-write-access':
      return 'You no longer have write access to this project, so the server refused this change.'
  }
}

function FailedRow({
  item,
  busy,
  onRetry,
  onDiscard,
}: {
  item: OfflineFailedItemView
  busy: boolean
  onRetry: () => void
  onDiscard: () => void
}) {
  const fmt = useDateFormat()
  return (
    <li className="flex flex-col gap-1 border-b border-[var(--border-color)] px-4 py-2.5 last:border-b-0">
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1 break-words text-[13px] text-[var(--text-primary)]">{item.summary}</span>
        <div className="flex shrink-0 gap-1">
          {item.reason !== 'other-account' && (
            <button
              type="button"
              disabled={busy}
              onClick={onRetry}
              className="rounded-control border border-[var(--border-color)] px-2 py-0.5 text-[11px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-50"
            >
              Retry
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={onDiscard}
            className="rounded-control border border-[var(--border-color)] px-2 py-0.5 text-[11px] text-danger hover:bg-[var(--bg-hover)] disabled:opacity-50"
          >
            Discard
          </button>
        </div>
      </div>
      <p className="text-[11px] text-[var(--text-secondary)]">{failureReasonLabel(item.reason)}</p>
      {item.reason !== 'dependency-failed' && item.reason !== 'other-account' && item.reason !== 'token-permission' && item.error && (
        <p className="break-words text-[11px] text-[var(--text-secondary)]">Server said: {item.error}</p>
      )}
      {(item.reason === 'other-account' || item.reason === 'token-permission') && item.error && (
        <p className="break-words text-[11px] text-[var(--text-secondary)]">{item.error}</p>
      )}
      <p className="text-caption text-[var(--text-secondary)] opacity-70">{formatAbsoluteDateTime(item.failedAt, fmt)}</p>
    </li>
  )
}

/**
 * Pending and failed offline changes (D-REN-3, D-SYNC-6): retry or discard what the server refused,
 * sync what is waiting, and sign in again when the session ran out. Custom-list and settings
 * changes that have not reached the server are listed too and can be discarded (they go back to
 * the server's copy), like Android's "Discard unsynced changes".
 */
export function SyncPanel({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const snapshot = useOfflineStore((s) => s.snapshot)
  const counts = useOfflineStore((s) => s.counts)
  const replaying = useOfflineStore((s) => s.replaying)
  const authProblem = useOfflineStore((s) => s.authProblem)
  const requestReauth = useUIStore((s) => s.requestReauth)
  const [busy, setBusy] = useState(false)
  const titleId = useId()

  const { data: unsyncedDocuments } = useUnsyncedDocuments()

  const failed = snapshot?.failed ?? []
  const pending = snapshot?.pending ?? []
  const documents = unsyncedDocumentItems(unsyncedDocuments)

  const run = async (action: () => Promise<{ success: boolean; error?: string }>, failure: string): Promise<boolean> => {
    setBusy(true)
    try {
      const result = await action()
      if (!result.success) toast.error(`${failure}: ${result.error ?? 'unknown error'}`)
      return result.success
    } catch (err) {
      toast.error(`${failure}: ${err instanceof Error ? err.message : String(err)}`)
      return false
    } finally {
      setBusy(false)
    }
  }

  const retry = (ids?: string[]) => run(() => api.offlineQueue.retryFailed(ids), 'Could not retry')
  const discard = async (ids?: string[]) => {
    await run(() => api.offlineQueue.discardFailed(ids), 'Could not discard')
    // What the cache still shows of a discarded change goes away with the next refetch.
    refreshTasks(qc)
  }
  const discardAll = async () => {
    const ok = await confirmDelete(`Discard ${failed.length} failed change${failed.length === 1 ? '' : 's'}? They will not be sent.`, {
      force: true,
      confirmLabel: 'Discard',
    })
    if (ok) await discard()
  }
  // Waiting changes can be dropped too (E-1), for example one the server keeps refusing. A discarded
  // create takes the changes made to that task with it; its row leaves the lists at once, and the
  // lists are read again so they stop showing what was discarded.
  const discardWaiting = async (ids?: string[]) => {
    const targets = ids ? pending.filter((item) => ids.includes(item.id)) : pending
    if (targets.length === 0) return
    const ok = await run(() => api.offlineQueue.discardPending(targets.map((item) => item.id)), 'Could not discard')
    if (!ok) return
    removePendingTasks(qc, targets.flatMap((item) => (item.create ? [item.create.tempId] : [])))
    const after = await api.offlineQueue.snapshot().catch(() => null)
    // With nothing left waiting the server is the truth again; otherwise the lists refresh once the
    // remaining changes are sent (a refetch now would hide their optimistic state).
    if (after?.success && after.data.pending.length === 0) invalidateTaskData(qc)
    else refreshTasks(qc)
  }
  const discardAllWaiting = async () => {
    const ok = await confirmDelete(`Discard ${counts.pending} waiting change${counts.pending === 1 ? '' : 's'}? They will not be sent.`, {
      force: true,
      confirmLabel: 'Discard',
    })
    if (ok) await discardWaiting()
  }
  const syncDocuments = () => run(() => api.syncCustomLists().then(() => ({ success: true })), 'Could not sync')
  const discardDocuments = async () => {
    const ok = await confirmDelete(discardDocumentsPrompt(documents), { force: true, confirmLabel: 'Discard' })
    if (!ok) return
    await run(() => api.discardUnsyncedDocuments().then(() => ({ success: true })), 'Could not discard')
    void qc.invalidateQueries({ queryKey: UNSYNCED_DOCUMENTS_QUERY_KEY })
  }
  const syncNow = () => run(() => api.offlineQueue.replayNow().then((r) => (r.success ? { success: true } : r)), 'Could not sync')

  return (
    <Dialog open onClose={onClose} labelledBy={titleId} className="w-[calc(100%-2rem)] max-w-lg">
      <div className="flex max-h-[80vh] flex-col overflow-hidden">
        <div className="flex items-center gap-2 border-b border-[var(--border-color)] px-4 py-3">
          <h2 id={titleId} className="flex-1 text-sm font-semibold text-[var(--text-primary)]">Sync status</h2>
          <button
            data-autofocus
            type="button"
            onClick={onClose}
            className="rounded-control p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {authProblem && (
            <div className="flex items-start gap-3 border-b border-[var(--border-color)] bg-danger/10 px-4 py-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-[var(--text-primary)]">Sign in again to sync your changes</p>
                <p className="mt-0.5 break-words text-[11px] text-[var(--text-secondary)]">
                  {authProblem.error || 'Your session has expired.'} Waiting changes are kept and are sent once you are signed in.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  onClose()
                  requestReauth()
                }}
                className="flex shrink-0 items-center gap-1 rounded-control bg-accent-fill px-2.5 py-1 text-[11px] font-medium text-on-accent"
              >
                <LogIn className="h-3 w-3" /> Sign in
              </button>
            </div>
          )}

          {counts.pending > 0 && (
            <section className="border-b border-[var(--border-color)]">
              <div className="flex items-center gap-2 px-4 pb-1 pt-3">
                <h3 className="flex-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                  Waiting to sync ({counts.pending})
                </h3>
                <button
                  type="button"
                  disabled={busy || replaying}
                  onClick={() => void syncNow()}
                  className="flex items-center gap-1 rounded-control border border-[var(--border-color)] px-2 py-0.5 text-[11px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-50"
                >
                  <RefreshCw className={replaying ? 'h-3 w-3 animate-spin' : 'h-3 w-3'} /> {replaying ? 'Syncing' : 'Sync now'}
                </button>
                <button
                  type="button"
                  disabled={busy || replaying}
                  onClick={() => void discardAllWaiting()}
                  className="rounded-control border border-[var(--border-color)] px-2 py-0.5 text-[11px] text-danger hover:bg-[var(--bg-hover)] disabled:opacity-50"
                >
                  Discard all
                </button>
              </div>
              <ul className="px-4 pb-3 text-[12px] text-[var(--text-secondary)]">
                {pending.slice(0, 50).map((item) => (
                  <li key={item.id} className="flex items-start gap-2 py-0.5">
                    <span className="min-w-0 flex-1 break-words">{item.summary}</span>
                    <button
                      type="button"
                      disabled={busy || replaying}
                      onClick={() => void discardWaiting([item.id])}
                      aria-label={`Discard ${item.summary}`}
                      className="shrink-0 rounded-control border border-[var(--border-color)] px-2 py-0.5 text-[11px] text-danger hover:bg-[var(--bg-hover)] disabled:opacity-50"
                    >
                      Discard
                    </button>
                  </li>
                ))}
                {pending.length > 50 && <li className="py-0.5 opacity-70">and {pending.length - 50} more</li>}
              </ul>
            </section>
          )}

          {documents.length > 0 && (
            <section className="border-b border-[var(--border-color)]">
              <div className="flex items-center gap-2 px-4 pb-1 pt-3">
                <h3 className="flex-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                  Lists and settings
                </h3>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void syncDocuments()}
                  className="flex items-center gap-1 rounded-control border border-[var(--border-color)] px-2 py-0.5 text-[11px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-50"
                >
                  <RefreshCw className="h-3 w-3" /> Sync now
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void discardDocuments()}
                  className="rounded-control border border-[var(--border-color)] px-2 py-0.5 text-[11px] text-danger hover:bg-[var(--bg-hover)] disabled:opacity-50"
                >
                  Discard
                </button>
              </div>
              <ul className="px-4 pb-3">
                {documents.map((item) => (
                  <li key={item.key} className="py-0.5">
                    <p className="break-words text-[12px] text-[var(--text-primary)]">{item.label}</p>
                    <p className="break-words text-[11px] text-[var(--text-secondary)]">{item.note}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {failed.length > 0 && (
            <section>
              <div className="flex items-center gap-2 px-4 pb-1 pt-3">
                <h3 className="flex-1 text-[11px] font-semibold uppercase tracking-wider text-danger">
                  Failed ({failed.length})
                </h3>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void retry()}
                  className="rounded-control border border-[var(--border-color)] px-2 py-0.5 text-[11px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-50"
                >
                  Retry all
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void discardAll()}
                  className="rounded-control border border-[var(--border-color)] px-2 py-0.5 text-[11px] text-danger hover:bg-[var(--bg-hover)] disabled:opacity-50"
                >
                  Discard all
                </button>
              </div>
              <ul>
                {failed.map((item) => (
                  <FailedRow
                    key={item.id}
                    item={item}
                    busy={busy}
                    onRetry={() => void retry([item.id])}
                    onDiscard={() => void discard([item.id])}
                  />
                ))}
              </ul>
            </section>
          )}

          {!authProblem && counts.pending === 0 && failed.length === 0 && documents.length === 0 && (
            <p className="px-4 py-6 text-center text-[12px] text-[var(--text-secondary)]">Everything is synced.</p>
          )}
        </div>
      </div>
    </Dialog>
  )
}
