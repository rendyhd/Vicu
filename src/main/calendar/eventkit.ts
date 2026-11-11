// The Mac's calendars (EventKit) in this app: where the helper binary is, the one helper process,
// the kind registered in service.ts, and the status the add dialog starts from. The helper is
// resources/calendar/vicu-calendar-macos, built by scripts/build-calendar-helper.mjs (npm run
// calendar:helper) and shipped with resources/ like the voice helper.
//
// Permission: the helper asks macOS for full access to the calendars. Started by Vicu, macOS
// attributes the question to Vicu (the responsible app), so the prompt names Vicu and uses the
// NSCalendarsFullAccessUsageDescription of Vicu's Info.plist (electron-builder.yml, mac.extendInfo);
// the helper carries the same strings for runs from a terminal. Confirm this on a signed build.

import { app, shell } from 'electron'
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { isMac } from '../platform'
import { EVENTKIT_DENIED_MESSAGE, type EventKitStatusView } from '../../shared/calendar-eventkit'
import { CalendarReadError } from './http'
import { EventKitHelper } from './eventkit-helper'
import { createEventKitSource } from './sources/eventkit'

export function eventKitHelperPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'resources', 'calendar', 'vicu-calendar-macos')
    : join(app.getAppPath(), 'resources', 'calendar', 'vicu-calendar-macos')
}

function missingMessage(): string {
  return app.isPackaged
    ? 'The calendars of this Mac are not part of this build of Vicu: its calendar helper is missing.'
    : 'The calendar helper is not built. Run npm run calendar:helper, then start Vicu again.'
}

let helper: EventKitHelper | null = null

/** The one helper; throws a CalendarReadError with a sentence when there is none. */
export function eventKitHelper(): EventKitHelper {
  if (!isMac) throw new CalendarReadError('The calendars of this computer can only be read on a Mac.', 'other')
  const path = eventKitHelperPath()
  if (!existsSync(path)) throw new CalendarReadError(missingMessage(), 'other')
  if (!helper) {
    helper = new EventKitHelper({
      spawn: () => {
        if (!existsSync(path)) throw new CalendarReadError(missingMessage(), 'other')
        return spawn(path, [], { stdio: ['pipe', 'pipe', 'pipe'] })
      },
    })
    app.on('will-quit', () => helper?.close())
  }
  return helper
}

/** The helper when there is one, without an error: for the watch, which is best effort. */
export function eventKitHelperIfAny(): EventKitHelper | null {
  try {
    return eventKitHelper()
  } catch {
    return null
  }
}

export const eventkitSource = createEventKitSource(eventKitHelper)

/** What the add dialog starts from; never asks for the permission. */
export async function eventKitStatus(added: boolean): Promise<EventKitStatusView> {
  if (!isMac) return { supported: false, added }
  try {
    const access = await eventKitHelper().status()
    const problem = access === 'denied' || access === 'restricted' || access === 'write-only' ? EVENTKIT_DENIED_MESSAGE : undefined
    return { supported: true, access, problem, added }
  } catch (error) {
    return { supported: true, added, problem: error instanceof CalendarReadError ? error.message : 'The calendars of this Mac could not be read.' }
  }
}

/** System Settings, Privacy & Security, Calendars. */
export function openCalendarPrivacySettings(): void {
  if (isMac) void shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars')
}
