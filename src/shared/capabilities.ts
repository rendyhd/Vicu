// What the host a window runs in can do. The desktop app (Electron) can do all of it; the web
// version (src/web) runs in a browser tab and leaves some features out. A feature the host lacks
// shows no button, menu entry, setting or shortcut: the renderer reads these flags through
// `window.api.capabilities` (hooks/use-capabilities.ts) and hides it. Nothing is shown disabled.
//
// One flag per feature that can be absent. Add a flag here when a new feature needs the desktop,
// set it in both objects below, and gate every place the feature shows.

export interface HostCapabilities {
  /** Where the window runs. */
  host: 'electron' | 'web'
  /** The assistant: Ask, smart dictation, brain dump, suggestions, local speech, tasks from notes. */
  assistant: boolean
  /** Voice input (quick capture by voice). */
  voice: boolean
  /** Changes that could not reach the server wait in a queue and are sent later. */
  offlineQueue: boolean
  /** Connected calendars on the Plan screen (links, CalDAV, accounts, calendars on this computer). */
  calendars: boolean
  /** Quick Entry and Quick View, with their global shortcuts. */
  quickWindows: boolean
  /** The browser extension's link to Quick Entry. */
  browserLink: boolean
  /** Obsidian: note links read from the foreground app, and opening them. */
  obsidian: boolean
  /** Working without a server. */
  standalone: boolean
  /** The check for a newer version, and its banner. */
  updates: boolean
  /** The window itself: the close-button choice, the tray, launch on startup, window controls. */
  windowControls: boolean
  /** Opening a file in its default app, and choosing files by a path on this computer. */
  openFiles: boolean
  /** The count on the app icon. */
  badge: boolean
  /** Setup asks which Vikunja server to connect to (the web version is served next to one). */
  serverChoice: boolean
  /** The notice about how this computer keeps sign-in secrets. */
  secretStorage: boolean
  /** `vicu://` links from other apps. */
  deepLinks: boolean
}

export const ELECTRON_CAPABILITIES: HostCapabilities = {
  host: 'electron',
  assistant: true,
  voice: true,
  offlineQueue: true,
  calendars: true,
  quickWindows: true,
  browserLink: true,
  obsidian: true,
  standalone: true,
  updates: true,
  windowControls: true,
  openFiles: true,
  badge: true,
  serverChoice: true,
  secretStorage: true,
  deepLinks: true,
}

export const WEB_CAPABILITIES: HostCapabilities = {
  host: 'web',
  assistant: false,
  voice: false,
  offlineQueue: false,
  calendars: false,
  quickWindows: false,
  browserLink: false,
  obsidian: false,
  standalone: false,
  updates: false,
  windowControls: false,
  openFiles: false,
  badge: false,
  serverChoice: false,
  secretStorage: false,
  deepLinks: false,
}

/** The names of the feature flags (everything but `host`). */
export type CapabilityName = Exclude<keyof HostCapabilities, 'host'>
