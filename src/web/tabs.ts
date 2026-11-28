import { dropConfigCache, loadConfig } from '../main/config'
import { getCustomLists } from '../main/custom-list-service'
import { getProLedger } from '../main/pro-ledger-service'
import { getSavedFilterState } from '../main/saved-filter-service'
import { applyWeekStart, getSyncedPrefs } from '../main/synced-preferences'
import { announceConfigChange } from './handlers'
import { CONFIG_DOCUMENT, onDocumentChangedElsewhere } from './host/storage'
import { sendToAllWindows } from './host/windows'
import { onSignedOutElsewhere } from './session'

// More than one tab of the web version can be open. Each runs its own copy of the host; they share
// the stored documents (host/storage.ts), the session (session.ts) and the order of their writes
// (host/serial.ts). This module is what a tab does when another one changed something.

const TASKS_CHANNEL = 'vicu-web-tasks'

let tasksChannel: BroadcastChannel | null = null
let tellTimer: ReturnType<typeof setTimeout> | null = null

/** A task changed here: the other tabs read their lists again (a burst of changes is one message). */
export function tellOtherTabsTasksChanged(): void {
  if (!tasksChannel || tellTimer) return
  tellTimer = setTimeout(() => {
    tellTimer = null
    tasksChannel?.postMessage('changed')
  }, 300)
}

/** Who the config says is signed in, and whether setup is finished: a change means another page. */
function accountOf(): string {
  const config = loadConfig()
  return JSON.stringify([
    config?.vikunja_url ?? '',
    config?.auth_method ?? '',
    config?.account_owner?.id ?? 0,
    (config?.inbox_project_id ?? 0) > 0,
  ])
}

/** What the page was last told on a channel, so an unrelated config change tells it nothing. */
const told = new Map<string, string>()

function tellWhenChanged(channel: string, payload: unknown): void {
  const snapshot = JSON.stringify(payload)
  if (told.get(channel) === snapshot) return
  const first = !told.has(channel)
  told.set(channel, snapshot)
  if (!first) sendToAllWindows(channel, payload)
}

function tellAll(): void {
  tellWhenChanged('custom-lists-changed', getCustomLists())
  tellWhenChanged('synced-prefs-changed', getSyncedPrefs())
  tellWhenChanged('pro-ledger-changed', getProLedger())
  tellWhenChanged('saved-filters-changed', getSavedFilterState())
}

export function startTabs(): void {
  // What this tab shows now, to compare the next change with.
  let account = accountOf()
  tellAll()

  onDocumentChangedElsewhere((name) => {
    if (name !== CONFIG_DOCUMENT) return
    dropConfigCache()
    // Signed in, signed out or set up in another tab: this tab starts again as that account.
    if (accountOf() !== account) {
      window.location.reload()
      return
    }
    account = accountOf()
    applyWeekStart()
    announceConfigChange()
    tellAll()
  })

  onSignedOutElsewhere(() => window.location.reload())

  if (typeof BroadcastChannel === 'function') {
    tasksChannel = new BroadcastChannel(TASKS_CHANNEL)
    tasksChannel.onmessage = () => sendToAllWindows('tasks-changed')
  }
}
