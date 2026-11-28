import { loadConfig } from '../main/config'
import { fetchCurrentUser } from '../main/auth/user-info'
import { forgetKnownUser, knownUserIdFor, rememberKnownUser, setKnownUserLookup } from '../main/known-user'
import { invalidateProjectCounts } from '../main/project-counts-service'
import { sessionToken, sessionTokenSync, storedApiToken } from './host/auth'

// Who is signed in, for the web host: the token to send, and the user's id (the hidden tasks are
// only read once the app knows whose they are, cross-app semantics 10.3). The desktop's copy of
// this lives in src/main/sync.ts next to its offline queue, which the web version does not have.

/** The address of the server: the page's own (the container serves the app next to the API). */
export const serverUrl = (): string => window.location.origin

/** The token at hand, without waiting: the API token, or the session's JWT while it is good. */
export function tokenNow(): string | null {
  const config = loadConfig()
  if (!config?.vikunja_url) return null
  return config.auth_method === 'api_token' ? storedApiToken() : sessionTokenSync()
}

/** The token to send, renewing the session when it is needed. Null when signed out. */
export async function tokenForRequest(): Promise<string | null> {
  const config = loadConfig()
  if (!config?.vikunja_url) return null
  if (config.auth_method === 'api_token') return storedApiToken()
  try {
    return await sessionToken()
  } catch {
    return null
  }
}

let userLookup: Promise<void> | null = null
let userLookupAt = 0

/** The account changed (sign-in, sign-out, a new connection): what was known about the user goes. */
export function accountChanged(): void {
  forgetKnownUser()
  userLookupAt = 0
  invalidateProjectCounts()
}

/** Learn the signed-in user's id: once per account, and at most once a minute while it fails. */
export async function refreshKnownUser(): Promise<void> {
  const config = loadConfig()
  if (!config?.vikunja_url) return
  if (knownUserIdFor(config.vikunja_url) !== undefined) return
  if (userLookup) return userLookup
  if (Date.now() - userLookupAt < 60_000) return
  userLookupAt = Date.now()
  const url = config.vikunja_url
  userLookup = tokenForRequest()
    .then((token) => (token ? fetchCurrentUser(url, token) : null))
    .then((user) => {
      if (user) rememberKnownUser(url, user.id)
    })
    .finally(() => {
      userLookup = null
    })
  return userLookup
}

/** The hidden tasks ask for the user through this lookup. */
export function startAccount(): void {
  setKnownUserLookup(refreshKnownUser)
}
