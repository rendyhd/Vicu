import { createApi } from '../shared/api-factory'
import { WEB_CAPABILITIES } from '../shared/capabilities'
import { registerCollaborationIpc } from '../main/collab-ipc'
import { loadConfig } from '../main/config'
import { syncCustomLists } from '../main/custom-list-service'
import { registerPortableHandlers } from '../main/handlers/portable'
import { knownUserIdFor } from '../main/known-user'
import { initNotifications, refreshTaskRemindersOnFocus, rescheduleNotifications } from '../main/notifications'
import type { TaskWriteDeps } from '../main/offline/task-writes'
import { syncProLedger } from '../main/pro-ledger-service'
import { startSavedFilterImport } from '../main/saved-filter-service'
import { applyWeekStart, syncSyncedPrefs } from '../main/synced-preferences'
import { refreshKnownUser, startAccount, tokenNow } from './account'
import { registerWebHandlers } from './handlers'
import { osPlatform } from './host/env'
import { listen, sendToAllWindows } from './host/windows'
import { noQueue } from './no-queue'
import { handle, invoke } from './registry'
import { startTabs, tellOtherTabsTasksChanged } from './tabs'

// Starts the web host: what src/main/index.ts and the preload script do for the desktop window,
// as far as a browser tab needs it. After this the page has `window.api`.

const SYNC_EVERY_MS = 5 * 60_000
const FOCUS_SYNC_THROTTLE_MS = 30_000
/** A timer that fires this much later than it was set for means the computer slept. */
const SLEEP_GAP_MS = 60_000
const TICK_MS = 15_000

let lastSync = 0

/** Read the account's hidden documents (custom lists, synced settings, the Pro ledger) again. */
function syncDocuments(): void {
  const config = loadConfig()
  if (!config?.vikunja_url || config.inbox_project_id <= 0) return
  // Signed out, or the session is being renewed: the next focus or timer asks again.
  if (!tokenNow() && config.auth_method === 'api_token') return
  lastSync = Date.now()
  void refreshKnownUser()
  void syncCustomLists()
  void syncSyncedPrefs()
  void syncProLedger()
}

function startSyncs(): void {
  window.setTimeout(syncDocuments, 4_000)
  // The reminder scheduler, as the desktop's main process starts it; a moment later, so the
  // session is ready when it first reads the server.
  window.setTimeout(initNotifications, 4_000)
  window.setInterval(() => {
    if (document.visibilityState === 'visible') syncDocuments()
  }, SYNC_EVERY_MS)
  window.addEventListener('focus', () => {
    if (Date.now() - lastSync >= FOCUS_SYNC_THROTTLE_MS) syncDocuments()
    refreshTaskRemindersOnFocus()
  })

  // A computer that slept: the page's timers (midnight, polling) may have been paused.
  let lastTick = Date.now()
  window.setInterval(() => {
    const now = Date.now()
    const slept = now - lastTick > TICK_MS + SLEEP_GAP_MS
    lastTick = now
    if (!slept) return
    sendToAllWindows('app-resumed')
    rescheduleNotifications()
    syncDocuments()
  }, TICK_MS)
}

export async function startHost(): Promise<void> {
  startAccount()
  applyWeekStart()

  const taskWriteDeps = (): TaskWriteDeps => ({ queue: noQueue })
  registerPortableHandlers(handle, {
    taskWriteDeps,
    // The desktop tells Quick View and the main window; here the other tabs are the other windows.
    notifyViewerSync: tellOtherTabsTasksChanged,
    notifyMainWindow: tellOtherTabsTasksChanged,
  })
  registerCollaborationIpc(handle, {
    taskWriteDeps,
    currentUserId: () => {
      const config = loadConfig()
      return config?.vikunja_url ? knownUserIdFor(config.vikunja_url) : undefined
    },
  })
  registerWebHandlers(handle)

  startSavedFilterImport()
  startTabs()
  startSyncs()

  ;(window as unknown as { api: unknown }).api = createApi({
    invoke,
    on: listen,
    platform: osPlatform,
    windowMaterial: 'none',
    capabilities: WEB_CAPABILITIES,
  })
}
