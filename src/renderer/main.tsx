import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { queryClient } from './lib/query-client'
import { router } from './router'
import { api } from './lib/api'
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
  const server = await withTimeout(signedInServer(), 1_500, '')
  await withTimeout(restoreQueryCache(queryClient, indexedDbStore, server).catch(() => false), 1_500, false)

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
        <RouterProvider router={router} />
      </QueryClientProvider>
    </React.StrictMode>
  )
}

void start()
