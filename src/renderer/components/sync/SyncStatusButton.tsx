import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, CloudOff, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useOfflineStore } from '@/stores/offline-store'
import { useUnsyncedDocuments } from '@/hooks/use-unsynced-documents'
import { stalledDocumentsLabel } from '@/lib/unsynced-documents'
import { SyncPanel } from './SyncPanel'
import { t } from '../../../shared/i18n'

/** What the status button says; pure so it can be tested. */
export function syncStatusLabel(counts: { pending: number; failed: number }, authProblem: boolean, documents?: string | null): string {
  const parts: string[] = []
  if (authProblem) parts.push(t('sync.status.signInNeeded'))
  if (counts.failed > 0) parts.push(t('sync.status.failed', { count: counts.failed }))
  if (counts.pending > 0) parts.push(t('sync.status.waiting', { count: counts.pending }))
  if (documents) parts.push(documents)
  return parts.join(' · ')
}

/**
 * Sidebar indicator for offline changes: how many are waiting, how many failed, whether the
 * session needs a sign-in, and custom-list or settings changes that cannot reach the server.
 * Hidden when everything is synced; opens the sync panel.
 */
export function SyncStatusButton() {
  const { t } = useTranslation()
  const counts = useOfflineStore((s) => s.counts)
  const replaying = useOfflineStore((s) => s.replaying)
  const authProblem = useOfflineStore((s) => s.authProblem)
  const { data: documents } = useUnsyncedDocuments()
  const [open, setOpen] = useState(false)

  const documentsLabel = stalledDocumentsLabel(documents)
  const needsAttention = counts.failed > 0 || authProblem !== null
  const visible = needsAttention || counts.pending > 0 || documentsLabel !== null

  return (
    <>
      {visible && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn(
            'mb-1 flex h-7 w-full items-center gap-2 rounded-control px-2.5 text-xs transition-colors hover:bg-[var(--bg-hover)]',
            needsAttention ? 'text-danger' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
          )}
          title={t('sync.status.review')}
        >
          {needsAttention ? (
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
          ) : replaying ? (
            <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin" strokeWidth={1.8} />
          ) : (
            <CloudOff className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
          )}
          <span className="truncate">{syncStatusLabel(counts, authProblem !== null, documentsLabel)}</span>
        </button>
      )}
      {open && <SyncPanel onClose={() => setOpen(false)} />}
    </>
  )
}
