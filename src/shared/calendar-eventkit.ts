// The calendars of this Mac through EventKit (contract 20.9, docs/calendar-plan.md 2d): the shapes
// the windows and the main process share for the add flow. Everything the Mac has in System
// Settings, Internet Accounts (iCloud, Google, Exchange, CalDAV) without a sign-in in Vicu. Only
// offered on macOS. Pure: no Electron, no DOM.

/** What macOS answered about Vicu reading the calendars. */
export type EventKitAccess = 'full' | 'write-only' | 'denied' | 'restricted' | 'not-determined' | 'unknown'

export interface EventKitStatusView {
  /** This is a Mac: the kind is offered. */
  supported: boolean
  /** The access macOS gives Vicu; absent when the helper could not be asked. */
  access?: EventKitAccess
  /** Why the calendars cannot be read now, in a sentence (missing helper, access refused). */
  problem?: string
  /** The Mac's calendars are already added (one connection holds them all). */
  added: boolean
}

/** A calendar of this Mac, before the user picks it. */
export interface EventKitFoundCalendar {
  remoteId: string
  name: string
  /** The account it belongs to: "iCloud", "Google", "On My Mac". */
  account: string
  /** Its colour on the Mac, #rrggbb, only to recognise it in the list. */
  color?: string
  /** Ticked at first: every calendar but Birthdays (all-day, never busy). */
  suggested: boolean
}

export interface EventKitSaveInput {
  /** The calendars to show; the others are kept, not shown. */
  shown: string[]
  busyOnly?: boolean
}

/** The found calendars by account, accounts in the order they first appear. */
export function groupByAccount(calendars: readonly EventKitFoundCalendar[]): { account: string; calendars: EventKitFoundCalendar[] }[] {
  const groups = new Map<string, EventKitFoundCalendar[]>()
  for (const calendar of calendars) {
    const list = groups.get(calendar.account)
    if (list) list.push(calendar)
    else groups.set(calendar.account, [calendar])
  }
  return [...groups].map(([account, list]) => ({ account, calendars: list }))
}

export const EVENTKIT_DENIED_MESSAGE = 'Vicu may not read your calendars. Allow it in System Settings, Privacy & Security, Calendars.'
