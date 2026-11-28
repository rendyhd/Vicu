import { readDocument, writeDocument } from './storage'

// `@host/auth`, the web side: where the Vikunja client gets the token it sends. A password or OIDC
// sign-in is a session (src/web/session.ts: a JWT in memory, renewed through the browser's own
// cookie). An API token is kept for this browser session only, unless the user asked to remember
// it on this browser.

export { sessionToken, sessionTokenSync } from '../session'

const SESSION_KEY = 'vicu-web-api-token'
const REMEMBERED_DOCUMENT = 'api-token'

/** The stored API token of an API-token connection, or null. */
export function storedApiToken(): string | null {
  try {
    const session = sessionStorage.getItem(SESSION_KEY)
    if (session) return session
  } catch {
    // No session storage (a locked-down browser): only a remembered token is found.
  }
  return readDocument(REMEMBERED_DOCUMENT)
}

/** Whether the API token is kept beyond this browser session. */
export function isApiTokenRemembered(): boolean {
  return readDocument(REMEMBERED_DOCUMENT) !== null
}

/** Keep the API token (`remember`: beyond this browser session), or forget it with `null`. */
export function storeApiToken(token: string | null, remember = false): void {
  try {
    if (token) sessionStorage.setItem(SESSION_KEY, token)
    else sessionStorage.removeItem(SESSION_KEY)
  } catch {
    // See storedApiToken.
  }
  writeDocument(REMEMBERED_DOCUMENT, token && remember ? token : null)
}
