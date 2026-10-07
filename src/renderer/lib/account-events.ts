/**
 * Raised (on `window`) after the connection settings were saved: a login, a new server, a
 * disconnect. Whatever the app cached for the previous account (task lists, projects, labels, the
 * copy kept for offline start-up) must not be shown for the next one.
 */
export const ACCOUNT_CHANGED_EVENT = 'vicu:account-changed'

export function announceAccountChanged(): void {
  window.dispatchEvent(new Event(ACCOUNT_CHANGED_EVENT))
}
