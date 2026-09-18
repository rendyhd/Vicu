export interface ShortcutRegistrationInput {
  entryEnabled: boolean
  viewerEnabled: boolean
  entryRegistered: boolean
  viewerRegistered: boolean
  isWaylandSession: boolean
}

export interface ShortcutStatus {
  entry: boolean
  viewer: boolean
  /** True only when an enabled shortcut failed to register on Wayland. */
  waylandLimited: boolean
}

/**
 * Derive shortcut status for Settings. On Electron 44+, Wayland uses the
 * GlobalShortcuts portal and can bind globally after consent — so we only
 * flag `waylandLimited` when an enabled shortcut actually failed to register.
 */
export function buildShortcutStatus(input: ShortcutRegistrationInput): ShortcutStatus {
  const entry = input.entryEnabled ? input.entryRegistered : false
  const viewer = input.viewerEnabled ? input.viewerRegistered : false

  const entryFailed = input.entryEnabled && !input.entryRegistered
  const viewerFailed = input.viewerEnabled && !input.viewerRegistered
  const waylandLimited = input.isWaylandSession && (entryFailed || viewerFailed)

  return { entry, viewer, waylandLimited }
}
