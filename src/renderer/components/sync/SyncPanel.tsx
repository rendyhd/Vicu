import { useId, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, LogIn, RefreshCw, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { api } from '@/lib/api'
import { t } from '../../../shared/i18n'
import { can } from '@/lib/capabilities'
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
      return t('sync.panel.reason.rejected')
    case 'too-large':
      return t('sync.panel.reason.tooLarge')
    case 'conflict':
      return t('sync.panel.reason.conflict')
    case 'task-gone':
      return t('sync.panel.reason.taskGone')
    case 'not-found':
      return t('sync.panel.reason.notFound')
    case 'dependency-failed':
      return t('sync.panel.reason.dependencyFailed')
    case 'gave-up':
      return t('sync.panel.reason.gaveUp')
    case 'other-account':
      return t('sync.panel.reason.otherAccount')
    case 'forbidden':
      return t('sync.panel.reason.forbidden')
    case 'token-permission':
      return t('sync.panel.reason.tokenPermission')
    case 'no-write-access':
      return t('sync.panel.reason.noWriteAccess')
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
  const { t } = useTranslation()
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
              {t('sync.panel.retry')}
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={onDiscard}
            className="rounded-control border border-[var(--border-color)] px-2 py-0.5 text-[11px] text-danger hover:bg-[var(--bg-hover)] disabled:opacity-50"
          >
            {t('sync.panel.discard')}
          </button>
        </div>
      </div>
      <p className="text-[11px] text-[var(--text-secondary)]">{failureReasonLabel(item.reason)}</p>
      {item.reason !== 'dependency-failed' && item.reason !== 'other-account' && item.reason !== 'token-permission' && item.error && (
        <p className="break-words text-[11px] text-[var(--text-secondary)]">{t('sync.panel.serverSaid', { error: item.error })}</p>
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
  const { t } = useTranslation()
  const qc = useQueryClient()
  const snapshot = useOfflineStore((s) => s.snapshot)
  const counts = useOfflineStore((s) => s.counts)
  const replaying = useOfflineStore((s) => s.replaying)
  const authProblem = useOfflineStore((s) => s.authProblem)
  const requestReauth = useUIStore((s) => s.requestReauth)
  const [busy, setBusy] = useState(false)
  const titleId = useId()

  const { data: unsyncedDocuments } = useUnsyncedDocuments()

  // Without the offline queue (the web version) there are no waiting or failed changes to show.
  const queueOn = can('offlineQueue')
  const failed = queueOn ? snapshot?.failed ?? [] : []
  const pending = queueOn ? snapshot?.pending ?? [] : []
  const documents = unsyncedDocumentItems(unsyncedDocuments)

  const run = async (action: () => Promise<{ success: boolean; error?: string }>, failure: string): Promise<boolean> => {
    setBusy(true)
    try {
      const result = await action()
      if (!result.success) toast.error(t('sync.panel.failedAction', { action: failure, error: result.error ?? t('sync.panel.unknownError') }))
      return result.success
    } catch (err) {
      toast.error(t('sync.panel.failedAction', { action: failure, error: err instanceof Error ? err.message : String(err) }))
      return false
    } finally {
      setBusy(false)
    }
  }

  const retry = (ids?: string[]) => run(() => api.offlineQueue.retryFailed(ids), t('sync.panel.couldNotRetry'))
  const discard = async (ids?: string[]) => {
    await run(() => api.offlineQueue.discardFailed(ids), t('sync.panel.couldNotDiscard'))
    // What the cache still shows of a discarded change goes away with the next refetch.
    refreshTasks(qc)
  }
  const discardAll = async () => {
    const ok = await confirmDelete(t('sync.panel.confirmDiscardFailed', { count: failed.length }), {
      force: true,
      confirmLabel: t('sync.panel.discard'),
    })
    if (ok) await discard()
  }
  // Waiting changes can be dropped too (E-1), for example one the server keeps refusing. A discarded
  // create takes the changes made to that task with it; its row leaves the lists at once, and the
  // lists are read again so they stop showing what was discarded.
  const discardWaiting = async (ids?: string[]) => {
    const targets = ids ? pending.filter((item) => ids.includes(item.id)) : pending
    if (targets.length === 0) return
    const ok = await run(() => api.offlineQueue.discardPending(targets.map((item) => item.id)), t('sync.panel.couldNotDiscard'))
    if (!ok) return
    removePendingTasks(qc, targets.flatMap((item) => (item.create ? [item.create.tempId] : [])))
    const after = await api.offlineQueue.snapshot().catch(() => null)
    // With nothing left waiting the server is the truth again; otherwise the lists refresh once the
    // remaining changes are sent (a refetch now would hide their optimistic state).
    if (after?.success && after.data.pending.length === 0) invalidateTaskData(qc)
    else refreshTasks(qc)
  }
  const discardAllWaiting = async () => {
    const ok = await confirmDelete(t('sync.panel.confirmDiscardWaiting', { count: counts.pending }), {
      force: true,
      confirmLabel: t('sync.panel.discard'),
    })
    if (ok) await discardWaiting()
  }
  const syncDocuments = () => run(() => api.syncCustomLists().then(() => ({ success: true })), t('sync.panel.couldNotSync'))
  const discardDocuments = async () => {
    const ok = await confirmDelete(discardDocumentsPrompt(documents), { force: true, confirmLabel: t('sync.panel.discard') })
    if (!ok) return
    await run(() => api.discardUnsyncedDocuments().then(() => ({ success: true })), t('sync.panel.couldNotDiscard'))
    void qc.invalidateQueries({ queryKey: UNSYNCED_DOCUMENTS_QUERY_KEY })
  }
  const syncNow = () => run(() => api.offlineQueue.replayNow().then((r) => (r.success ? { success: true } : r)), t('sync.panel.couldNotSync'))

  return (
    <Dialog open onClose={onClose} labelledBy={titleId} className="w-[calc(100%-2rem)] max-w-lg">
      <div className="flex max-h-[80vh] flex-col overflow-hidden">
        <div className="flex items-center gap-2 border-b border-[var(--border-color)] px-4 py-3">
          <h2 id={titleId} className="flex-1 text-sm font-semibold text-[var(--text-primary)]">{t('sync.panel.title')}</h2>
          <button
            data-autofocus
            type="button"
            onClick={onClose}
            className="rounded-control p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            aria-label={t('sync.panel.close')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {queueOn && authProblem && (
            <div className="flex items-start gap-3 border-b border-[var(--border-color)] bg-danger/10 px-4 py-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-[var(--text-primary)]">{t('sync.panel.signInAgainTitle')}</p>
                <p className="mt-0.5 break-words text-[11px] text-[var(--text-secondary)]">
                  {t('sync.panel.signInAgainNote', { reason: authProblem.error || t('sync.panel.sessionExpired') })}
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
                <LogIn className="h-3 w-3" /> {t('sync.panel.signIn')}
              </button>
            </div>
          )}

          {queueOn && counts.pending > 0 && (
            <section className="border-b border-[var(--border-color)]">
              <div className="flex items-center gap-2 px-4 pb-1 pt-3">
                <h3 className="flex-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                  {t('sync.panel.waiting', { count: counts.pending })}
                </h3>
                <button
                  type="button"
                  disabled={busy || replaying}
                  onClick={() => void syncNow()}
                  className="flex items-center gap-1 rounded-control border border-[var(--border-color)] px-2 py-0.5 text-[11px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-50"
                >
                  <RefreshCw className={replaying ? 'h-3 w-3 animate-spin' : 'h-3 w-3'} /> {replaying ? t('sync.panel.syncing') : t('sync.panel.syncNow')}
                </button>
                <button
                  type="button"
                  disabled={busy || replaying}
                  onClick={() => void discardAllWaiting()}
                  className="rounded-control border border-[var(--border-color)] px-2 py-0.5 text-[11px] text-danger hover:bg-[var(--bg-hover)] disabled:opacity-50"
                >
                  {t('sync.panel.discardAll')}
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
                      aria-label={t('sync.panel.discardItem', { summary: item.summary })}
                      className="shrink-0 rounded-control border border-[var(--border-color)] px-2 py-0.5 text-[11px] text-danger hover:bg-[var(--bg-hover)] disabled:opacity-50"
                    >
                      {t('sync.panel.discard')}
                    </button>
                  </li>
                ))}
                {pending.length > 50 && <li className="py-0.5 opacity-70">{t('sync.panel.andMore', { count: pending.length - 50 })}</li>}
              </ul>
            </section>
          )}

          {documents.length > 0 && (
            <section className="border-b border-[var(--border-color)]">
              <div className="flex items-center gap-2 px-4 pb-1 pt-3">
                <h3 className="flex-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                  {t('sync.panel.listsAndSettings')}
                </h3>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void syncDocuments()}
                  className="flex items-center gap-1 rounded-control border border-[var(--border-color)] px-2 py-0.5 text-[11px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-50"
                >
                  <RefreshCw className="h-3 w-3" /> {t('sync.panel.syncNow')}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void discardDocuments()}
                  className="rounded-control border border-[var(--border-color)] px-2 py-0.5 text-[11px] text-danger hover:bg-[var(--bg-hover)] disabled:opacity-50"
                >
                  {t('sync.panel.discard')}
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
                  {t('sync.panel.failed', { count: failed.length })}
                </h3>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void retry()}
                  className="rounded-control border border-[var(--border-color)] px-2 py-0.5 text-[11px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-50"
                >
                  {t('sync.panel.retryAll')}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void discardAll()}
                  className="rounded-control border border-[var(--border-color)] px-2 py-0.5 text-[11px] text-danger hover:bg-[var(--bg-hover)] disabled:opacity-50"
                >
                  {t('sync.panel.discardAll')}
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

          {!(queueOn && authProblem) && !(queueOn && counts.pending > 0) && failed.length === 0 && documents.length === 0 && (
            <p className="px-4 py-6 text-center text-[12px] text-[var(--text-secondary)]">{t('sync.panel.synced')}</p>
          )}
        </div>
      </div>
    </Dialog>
  )
}
