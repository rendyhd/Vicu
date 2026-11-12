import type { CustomListSyncStatus, UnsyncedDocuments } from './vikunja-types'

/**
 * Custom-list and synced-settings changes that have not reached the server, as the sync panel
 * shows them. They are not in the offline queue: each document keeps its own unsynced copy in main
 * (`synced-document-service.ts`), and discarding takes it back to the server's copy.
 */

export interface UnsyncedDocumentItem {
  key: keyof UnsyncedDocuments
  label: string
  /** Where its sync stands, in words. */
  note: string
}

const LABELS: Record<keyof UnsyncedDocuments, string> = {
  customLists: 'Custom list changes',
  preferences: 'Settings changes (the Inbox, the task order, location reminders)',
  proLedger: 'Pro changes (promises, verdicts, initiatives, meetings)',
}

function statusNote(status: CustomListSyncStatus): string {
  switch (status.state) {
    case 'offline':
      return 'Sent when the server can be reached.'
    case 'error':
    case 'update_required':
      return status.message
    case 'syncing':
      return 'Sending now.'
    case 'pending':
      return status.message ? `${status.message}.` : 'Sending soon.'
    default:
      return 'Sending soon.'
  }
}

export function unsyncedDocumentItems(documents: UnsyncedDocuments | undefined): UnsyncedDocumentItem[] {
  if (!documents) return []
  return (Object.keys(LABELS) as Array<keyof UnsyncedDocuments>).flatMap((key) => {
    const status = documents[key]
    return status ? [{ key, label: LABELS[key], note: statusNote(status) }] : []
  })
}

/**
 * The part of the sidebar status label for documents that are stuck (offline, refused, or waiting
 * for an update), or null. A change that is only on its way is not worth a sidebar button.
 */
export function stalledDocumentsLabel(documents: UnsyncedDocuments | undefined): string | null {
  const stalled = (status: CustomListSyncStatus | null | undefined) =>
    !!status && (status.state === 'offline' || status.state === 'error' || status.state === 'update_required')
  const lists = stalled(documents?.customLists)
  const settings = stalled(documents?.preferences) || stalled(documents?.proLedger)
  if (lists && settings) return 'Lists and settings waiting'
  if (lists) return 'Custom lists waiting'
  if (settings) return 'Settings waiting'
  return null
}

/** The confirmation before discarding them. */
export function discardDocumentsPrompt(items: UnsyncedDocumentItem[]): string {
  const lists = items.some((item) => item.key === 'customLists')
  const settings = items.some((item) => item.key === 'preferences')
  const what = lists && settings ? 'custom-list and settings changes' : lists ? 'custom-list changes' : 'settings changes'
  return `Discard the ${what} that have not reached the server? `
    + `${lists && settings ? 'Your custom lists and settings go' : lists ? 'Your custom lists go' : 'Your settings go'} back to what the server has.`
}
