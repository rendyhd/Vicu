// What a kind of calendar source implements (contract 20.9). The service (../service.ts) owns
// everything that is the same for every kind: the store of connections with their secrets sealed
// (../store.ts), the per-calendar choices, the last good copy on disk (../cache.ts), Busy only, the
// 5-minute rule, the limits, the IPC. A kind only knows how to reach its calendars.
//
// The kinds built: ics-link.ts, caldav.ts, microsoft.ts and google.ts (on oauth-account.ts), and
// eventkit.ts (macOS only, through ../eventkit.ts and its helper). To add a kind:
//   1. Add its name to `CalendarSourceKind` in src/shared/calendar-sources.ts.
//   2. Write `sources/<kind>.ts` exporting a `CalendarSource<YourConfig>`:
//      - `parseConfig`: read back the config the store unsealed; null when unusable.
//      - `describe`: one line for the windows, never a secret.
//      - `connect`: take the add dialog's input, check it, find the calendars (a network read).
//      - `listCalendars`: the calendars the connection has now (a manual refresh calls it).
//      - `covers` and `read`: read one calendar for the days on screen, as iCalendar documents.
//        A device calendar (EventKit) can hand back one generated document per event; a provider
//        API (Graph, Google) can do the same from its JSON. Return `unchanged` when the server says
//        so (ETag, sync token): nothing is parsed or written then.
//      - `disconnect` (optional): revoke a token when the connection is removed.
//   3. Register it in SOURCES in ../service.ts and give the add dialog its form
//      (src/renderer/components/planner/AddCalendarDialog.tsx: its KINDS) and an IPC call in the
//      preload. A kind with a sign-in returns a draft (saveDraft) and its calendars are picked with
//      PickCalendars.tsx and calendar:caldav-save.
//   Secrets: everything in the config is sealed by the store with safeStorage, so put the password
//   or token there and nowhere else; `read` can return a changed config (a refreshed token) and the
//   store seals it again. Never put a secret in a message: throw CalendarReadError with a sentence.
//   Read-only: ctx.http refuses anything but GET, HEAD, OPTIONS, PROPFIND and REPORT. An OAuth kind
//   (microsoft.ts, google.ts on oauth-account.ts) posts to its provider's token endpoint through
//   ctx.signInFetch and nothing else.

import type { CalendarSourceKind } from '../../../shared/calendar-sources'
import type { BasicAuth, BearerAuth, CalendarHttp, FetchLike } from '../http'

export interface SourceContext {
  /**
   * HTTP through Electron's net.fetch with a time limit, a byte budget and the sign-in: CalDAV's
   * user name and password (`auth`) or an OAuth access token (`bearer`), each only to its own site.
   */
  http(options?: { auth?: BasicAuth; bearer?: BearerAuth; maxBytes?: number }): CalendarHttp
  /**
   * A sign-in provider's token and revoke endpoints only (OAuth form POSTs, ../oauth.ts). Not
   * read-only, so nothing else may use it; absent where a kind needs no OAuth.
   */
  signInFetch?: FetchLike
  now(): number
}

/** One iCalendar document of a calendar's copy; `key` is the document's address or name. */
export interface CopyDocument {
  key: string
  etag?: string
  ics: string
}

/** Kind-specific values for the next conditional read (ETag, Last-Modified, window, ctag ...). */
export type Validators = Record<string, string | number>

/** The last good copy of a calendar, as kept in memory and on disk. */
export interface CalendarCopy {
  /** Reduced documents (ics.ts reduceIcs): only the fields Vicu reads. */
  documents: CopyDocument[]
  validators: Validators
  /** When the server last answered (with new data or "not modified"), ms. */
  fetchedAt: number
  /** Reduced for Busy only: no titles or places in it. */
  busyOnly: boolean
}

export interface ReadRequest {
  /** The days a window asked for. */
  from: Date
  to: Date
  /** The copy to build on; absent for a full read (first read, or Busy only turned off since). */
  previous?: CalendarCopy
}

export type ReadOutcome<Config = unknown> =
  | { status: 'unchanged'; validators?: Validators; config?: Config }
  | { status: 'changed'; documents: CopyDocument[]; validators: Validators; config?: Config }

export interface RemoteCalendar {
  /** Stable within the connection; never an address (it is stored next to the choices). */
  remoteId: string
  name: string
  /** False when the account itself hides it: the add dialog leaves it unticked. */
  suggested?: boolean
}

export interface ConnectResult<Config> {
  config: Config
  /** The connection's name: "iCloud", or what the user typed for a link. */
  name: string
  calendars: RemoteCalendar[]
  /** Reads `connect` already did, by remoteId, so the first view needs no second request. */
  firstReads?: Record<string, ReadOutcome<Config>>
}

export interface CalendarSource<Config> {
  kind: CalendarSourceKind
  parseConfig(value: unknown): Config | null
  describe(config: Config): string
  connect(input: unknown, ctx: SourceContext): Promise<ConnectResult<Config>>
  listCalendars(config: Config, ctx: SourceContext): Promise<{ config: Config; calendars: RemoteCalendar[] }>
  /** Whether `copy` holds the days [from, to); a link's copy holds every day. */
  covers(copy: CalendarCopy, from: Date, to: Date): boolean
  read(config: Config, remoteId: string, request: ReadRequest, ctx: SourceContext): Promise<ReadOutcome<Config>>
  disconnect?(config: Config, ctx: SourceContext): Promise<void>
}
