import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { queryClient } from './lib/query-client'
import { router } from './router'
import { IsDarkProvider } from './hooks/use-is-dark'
import { preloadRichTextEditor } from './components/rich-text/LazyRichTextEditor'
import { api } from './lib/api'
import { initDateFormat } from './lib/date-format'
import { ACCOUNT_CHANGED_EVENT } from './lib/account-events'
import {
  PERSISTED_KEY_PREFIXES,
  indexedDbStore,
  restoreQueryCache,
  startQueryPersistence,
} from './lib/query-persistence'
import './assets/index.css'

// Set platform data attribute for CSS targeting (e.g., macOS vibrancy)
document.documentElement.dataset.platform = window.api.platform
// Windows 11 with Mica behind the window: the sidebar turns translucent (index.css)
if (window.api.windowMaterial === 'mica') document.documentElement.dataset.material = 'mica'

/** The signed-in server, or '' (signed out, standalone mode, or the main process did not answer). */
async function signedInServer(): Promise<string> {
  try {
    const config = await api.getConfig()
    return config && !config.standalone_mode ? config.vikunja_url ?? '' : ''
  } catch {
    return ''
  }
}

const withTimeout = <T,>(promise: Promise<T>, ms: number, fallback: T): Promise<T> =>
  Promise.race([promise, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))])

async function start(): Promise<void> {
  // Show what the app showed last time right away (offline start-up, slow servers); the views
  // refetch as soon as they mount. Never let this hold up the first paint for long.
  // Dates are phrased in the system locale and the Settings clock; ask main before the first paint.
  const dateFormatReady = withTimeout(initDateFormat(window.api), 1_000, undefined)
  const server = await withTimeout(signedInServer(), 1_500, '')
  await withTimeout(restoreQueryCache(queryClient, indexedDbStore, server).catch(() => false), 1_500, false)

  await dateFormatReady

  let serverAtSave = server
  let serverCheckedAt = 0
  startQueryPersistence(queryClient, {
    store: indexedDbStore,
    // Read at save time: a login can change it. Looked up at most every few seconds.
    getServer: () => {
      if (Date.now() - serverCheckedAt > 5_000) {
        serverCheckedAt = Date.now()
        void signedInServer().then((value) => { serverAtSave = value })
      }
      return serverAtSave
    },
  })

  // A new login or a disconnect: forget the previous account's lists, in memory and on disk.
  window.addEventListener(ACCOUNT_CHANGED_EVENT, () => {
    queryClient.removeQueries({ predicate: (query) => PERSISTED_KEY_PREFIXES.has(query.queryKey[0]) })
    serverCheckedAt = 0
    void indexedDbStore.clear().catch(() => {})
  })

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <IsDarkProvider>
          <RouterProvider router={router} />
        </IsDarkProvider>
      </QueryClientProvider>
    </React.StrictMode>
  )
}

void start().then(() => {
  // The editor is its own chunk; fetch it once the first screen is up so opening a task is instant.
  setTimeout(preloadRichTextEditor, 1_500)
})
