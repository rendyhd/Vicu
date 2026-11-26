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

export interface SetupProjectChoice {
  id: number
  title: string
}

export interface SetupInboxPreferences {
  inboxProjectId: number | null
  defaultProjectId: number | null
}

export type SetupInboxResolution =
  /** The account's synced Inbox exists in the user's projects: skip the Inbox prompt and use it. */
  | { kind: 'synced'; inboxProjectId: number }
  /** No valid synced Inbox was found: ask the user, with `preselectedId` (or 0) selected in the list. */
  | { kind: 'ask'; preselectedId: number }

/**
 * Decide whether setup can reuse the account's synced Inbox or needs to ask the user.
 * When the synced Inbox exists in `projects`, setup skips the question; otherwise it preselects
 * Vikunja's default project, else a project titled "Inbox", else none (0).
 */
export function resolveSetupInbox(
  projects: readonly SetupProjectChoice[],
  prefs: SetupInboxPreferences | null,
): SetupInboxResolution {
  const exists = (id: number | null | undefined): id is number =>
    typeof id === 'number' && id > 0 && projects.some((project) => project.id === id)

  if (exists(prefs?.inboxProjectId)) {
    return { kind: 'synced', inboxProjectId: prefs.inboxProjectId }
  }
  if (exists(prefs?.defaultProjectId)) {
    return { kind: 'ask', preselectedId: prefs.defaultProjectId }
  }
  const namedInbox = projects.find((project) => project.title.toLowerCase() === 'inbox')
  return { kind: 'ask', preselectedId: namedInbox?.id ?? 0 }
}
