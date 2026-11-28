// Connected calendars (contract 20.9), the shapes the windows and the main process share. A
// connection is what the user added: a calendar link (one calendar), or an account with several
// (CalDAV, Microsoft 365, Google).
// Each calendar of a connection has its own choices (CalendarFeedView in calendar-events.ts). No
// address, user name, password or token ever crosses to a window (20.11): `detail` is the only
// description, and it never holds a secret. Pure: no Electron, no DOM.

import type { CalendarFeedView } from './calendar-events'

/**
 * The kinds this app has built: 'eventkit' on macOS only, 'outlook' (classic Outlook) on Windows
 * only; 'ics-file' is a calendar file on this computer, read again when it changes.
 */
export type CalendarSourceKind = 'ics' | 'caldav' | 'microsoft' | 'google' | 'eventkit' | 'ics-file' | 'outlook'

/** Add a calendar file on this computer: the main process asks for the file itself. */
export interface AddCalendarFileInput {
  /** Empty: the file's name without its extension. */
  name?: string
  busyOnly?: boolean
}

/** Classic Outlook on this PC: not on this system, not installed, installed but closed, or open. */
export type OutlookState = 'unsupported' | 'missing' | 'closed' | 'running'

export interface OutlookStatusView {
  state: OutlookState
  /** Classic Outlook is already added (there is one such connection). */
  added: boolean
  /** What to do, in a sentence, when it cannot be read now. */
  problem?: string
}

export const OUTLOOK_MISSING_MESSAGE =
  'Classic Outlook is not installed on this PC. The new Outlook cannot be read by other apps: add the calendar as a Microsoft 365 account or a calendar link instead.'
export const OUTLOOK_CLOSED_MESSAGE = 'Open classic Outlook to read its calendars. Vicu reads them only while Outlook is open, and never starts it.'

/** How the stored links and passwords are protected (auth/secret-storage.ts). */
export type CalendarSecretLevel = 'encrypted' | 'obfuscated' | 'plaintext'

export interface CalendarConnectionView {
  id: string
  kind: CalendarSourceKind
  /** "Work", "iCloud". */
  name: string
  /** A plain description: "calendar.google.com", "sam@fastmail.com on caldav.fastmail.com". */
  detail: string
  calendars: CalendarFeedView[]
  /** A problem of the whole connection, such as a password the server no longer takes. */
  error?: string
}

export interface CalendarSourcesView {
  connections: CalendarConnectionView[]
  storage: CalendarSecretLevel
}

/** Add a calendar link. */
export interface AddCalendarLinkInput {
  name: string
  url: string
  busyOnly?: boolean
}

export type CaldavPresetId = 'icloud' | 'fastmail' | 'nextcloud' | 'other'

export interface CaldavPreset {
  id: CaldavPresetId
  label: string
  /** The server, when the preset knows it. */
  server?: string
  /** A path added to the address the user types (Nextcloud's DAV root). */
  davPath?: string
  /** Where to make an app password, and what to call it there. */
  passwordUrl?: string
  passwordHelp: string
  userLabel: string
}

export const CALDAV_PRESETS: readonly CaldavPreset[] = [
  {
    id: 'icloud',
    label: 'iCloud',
    server: 'https://caldav.icloud.com',
    passwordUrl: 'https://appleid.apple.com/account/manage',
    passwordHelp: 'Make an app-specific password at appleid.apple.com, Sign-In and Security, App-Specific Passwords.',
    userLabel: 'Apple Account email',
  },
  {
    id: 'fastmail',
    label: 'Fastmail',
    server: 'https://caldav.fastmail.com',
    passwordUrl: 'https://app.fastmail.com/settings/security/apppasswords',
    passwordHelp: 'Make an app password in Fastmail, Settings, Privacy & Security, App passwords, with access to calendars.',
    userLabel: 'Fastmail email',
  },
  {
    id: 'nextcloud',
    label: 'Nextcloud',
    davPath: '/remote.php/dav',
    passwordHelp: 'Make an app password in Nextcloud, Personal settings, Security, Devices & sessions.',
    userLabel: 'User name',
  },
  {
    id: 'other',
    label: 'Other',
    passwordHelp: 'Use an app password if your provider offers one, so Vicu never has your main password.',
    userLabel: 'User name',
  },
]

export function caldavPreset(id: string): CaldavPreset {
  return CALDAV_PRESETS.find((preset) => preset.id === id) ?? CALDAV_PRESETS[CALDAV_PRESETS.length - 1]
}

/** Sign in to a CalDAV account and find its calendars. */
export interface CaldavDiscoverInput {
  preset: CaldavPresetId
  /** Required for Nextcloud and Other. */
  server?: string
  username: string
  password: string
}

/** A calendar found on an account (CalDAV, Microsoft 365, Google), before the user picks it. */
export interface CaldavFoundCalendar {
  remoteId: string
  name: string
  /** False when the account itself does not show it (a Google calendar unticked there): left unticked. */
  suggested?: boolean
}

/** A signed-in account (CalDAV, Microsoft 365, Google) waiting for the user's pick; nothing is saved until it is. */
export interface CaldavDraft {
  draftId: string
  name: string
  detail: string
  calendars: CaldavFoundCalendar[]
}

export interface CaldavSaveInput {
  /** The calendars to show; the others are kept, not shown. */
  shown: string[]
  busyOnly?: boolean
}

/**
 * The server address a preset reads: the preset's own, or the typed one (https:// added when no
 * scheme is given, Nextcloud's DAV path added when missing). Null when it is not an address.
 */
export function caldavServerUrl(presetId: string, typed: string | undefined): string | null {
  const preset = caldavPreset(presetId)
  let raw = (preset.server ?? typed ?? '').trim()
  if (!raw) return null
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `https://${raw}`
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (preset.davPath && !url.pathname.includes(preset.davPath)) {
    url.pathname = `${url.pathname.replace(/\/+$/, '')}${preset.davPath}`
  }
  url.hash = ''
  url.search = ''
  return url.toString().replace(/\/+$/, '') + '/'
}
