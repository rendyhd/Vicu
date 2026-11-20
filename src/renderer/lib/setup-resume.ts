// The web version's Setup can open in the middle of a sign-in: an SSO sign-in leaves the page for
// the provider and comes back (`api.pendingSignIn()` says how it went), and a reload half way finds
// a session that is already there. This decides what Setup does first.

export interface PendingSignIn {
  providerKey: string
  /** The server asked for a TOTP code. */
  totpRequired?: boolean
  error?: string
}

export type SetupResume =
  /** Ask the server for the projects: when it answers, there is a session and Setup goes on to the Inbox choice. */
  | 'try-session'
  /** Ask for the code and start the sign-in again with it. */
  | 'ask-totp'
  /** Show why the sign-in failed, at the sign-in choice. */
  | 'show-error'

export function setupResume(pending: PendingSignIn | null): SetupResume {
  if (pending?.totpRequired) return 'ask-totp'
  if (pending?.error) return 'show-error'
  // Nothing came back (a first visit, or a reload), or a sign-in came back and worked: either way
  // the session decides.
  return 'try-session'
}
