import type { AppConfig, CustomListSyncStatus } from './vikunja-types'
import type { OfflineQueueResult, OfflineQueueSnapshot, OfflineReplayEvent } from '../../shared/offline-queue-types'

/**
 * What signing out would leave behind. Queued task changes stay on this device: they carry the
 * account they were made for and are sent when that account signs in again. Custom-list edits
 * that have not reached the server are dropped with the rest of the account's data.
 */
export interface UnsyncedWork {
  queuedChanges: number
  customListsUnsynced: boolean
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

/** The sign-out confirmation text, or null when nothing would be left behind. */
export function signOutWarning(work: UnsyncedWork): string | null {
  const lines: string[] = []
  if (work.customListsUnsynced) {
    lines.push('Changes to your custom lists have not reached the server yet. Signing out deletes them.')
  }
  if (work.queuedChanges > 0) {
    const one = work.queuedChanges === 1
    lines.push(
      `${plural(work.queuedChanges, 'task change is', 'task changes are')} still waiting to be sent. `
      + `${one ? 'It stays' : 'They stay'} on this device and ${one ? 'is' : 'are'} sent the next time you sign in to this account.`,
    )
  }
  if (lines.length === 0) return null
  return [...lines, 'Sign out anyway?'].join('\n\n')
}

export interface SignOutCheckDeps {
  syncCustomLists(): Promise<CustomListSyncStatus>
  replayNow(): Promise<OfflineQueueResult<OfflineReplayEvent | null>>
  snapshot(): Promise<OfflineQueueResult<OfflineQueueSnapshot>>
  getConfig(): Promise<AppConfig | null>
  /** How long each last-chance send may take before the check goes on without it. */
  timeoutMs?: number
}

function settleWithin<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<undefined>((resolve) => { timer = setTimeout(() => resolve(undefined), ms) })
  return Promise.race([promise.catch(() => undefined), timeout]).finally(() => clearTimeout(timer))
}

/**
 * Give custom lists and the offline queue one last chance to reach the server, then report what
 * is still only on this device. Never throws: a check that cannot run reports nothing.
 */
export async function checkUnsyncedWork(deps: SignOutCheckDeps): Promise<UnsyncedWork> {
  const timeoutMs = deps.timeoutMs ?? 8000
  await Promise.all([
    settleWithin(deps.syncCustomLists(), timeoutMs),
    settleWithin(deps.replayNow(), timeoutMs),
  ])
  const [snapshot, config] = await Promise.all([
    deps.snapshot().catch(() => undefined),
    deps.getConfig().catch(() => null),
  ])
  return {
    queuedChanges: snapshot?.success ? snapshot.data.pending.length : 0,
    // Standalone lists are local by design and survive a sign-out from standalone mode.
    customListsUnsynced: !!config && !config.standalone_mode && !!config.vikunja_url && !!config.custom_lists_sync?.dirty,
  }
}
