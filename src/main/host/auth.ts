import { authManager } from '../auth/auth-manager'
import { getAPIToken } from '../auth/token-store'

// `@host/auth`, the Electron side: where the Vikunja client gets the token it sends. The web build
// swaps this module for src/web/host/auth.ts (a JWT kept in memory, renewed through the browser's
// own session cookie).

/** The session's token, renewed or signed in again when needed. Rejects when the session has ended. */
export function sessionToken(): Promise<string> {
  return authManager.getToken()
}

/** The session's token when one is at hand and still good, without waiting. */
export function sessionTokenSync(): string | null {
  return authManager.getTokenSync()
}

/** The stored API token of an API-token connection, or null. */
export function storedApiToken(): string | null {
  return getAPIToken()
}
