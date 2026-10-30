/** Device-local CalDAV configuration. Secrets are write-only over IPC. */
export interface CalDavCalendar {
  url: string
  name: string
  color: string
  enabled: boolean
  /** Advertised DAV privileges; omitted when the server doesn't report them. */
  readOnly?: boolean
}

export interface CalDavConnection {
  id: string
  name: string
  url: string
  username: string
  authMethod: 'Basic' | 'Digest' | 'Bearer' | 'None'
  hasSecret: boolean
  calendars: CalDavCalendar[]
}

export interface CalDavConnectionInput extends Omit<CalDavConnection, 'hasSecret' | 'calendars'> {
  /** Omitted preserves the saved password/token; empty clears it. */
  secret?: string
}

export interface CalDavEvent {
  /** Versioned, opaque write reference; changes when the resource ETag changes. */
  id: string
  /** Stable across refreshes/writes so keyboard focus survives a successful edit. */
  occurrenceKey: string
  connectionId: string
  calendarUrl: string
  calendarName: string
  color: string
  title: string
  start: string
  end: string
  allDay: boolean
  readOnly: boolean
}

export interface CalDavEventUpdate {
  id: string
  start: string
  end: string
}

export interface CalDavEventsResult {
  events: CalDavEvent[]
  errors: string[]
}

export interface CalDavApi {
  connections(): Promise<CalDavConnection[]>
  discover(input: CalDavConnectionInput): Promise<CalDavConnection>
  select(id: string, calendars: CalDavCalendar[]): Promise<void>
  remove(id: string): Promise<void>
  events(start: string, end: string): Promise<CalDavEventsResult>
  update(input: CalDavEventUpdate): Promise<void>
}
