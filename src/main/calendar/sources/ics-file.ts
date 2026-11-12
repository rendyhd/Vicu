// A calendar file on this computer (contract 20.9): an .ics file that another program keeps up to
// date (Thunderbird, a script, an export), shown as a live calendar. One connection, one calendar.
//
// - The file is chosen in the main process's open dialog (service.ts, calendar:file-add), so a window
//   never names a path. The path is kept in the sealed config like any other kind's address.
// - A read looks at the file's size and modified time first: the same as last time is "unchanged"
//   without reading it. A changed file is read whole and compared by its hash.
// - The service watches the file's folder (an editor often replaces the file rather than writing
//   into it) and reads it again when it changes, past the 5-minute rule (service.ts, file watches).
// - Nothing leaves the computer: the file is only read, never written.

import { createHash } from 'crypto'
import { basename, extname } from 'path'
import { CalendarReadError } from '../http'
import type { CalendarSource, ReadOutcome } from './types'

export interface FileConfig {
  path: string
}

/** What the source needs of the file system (fs/promises in the app, a fake in the tests). */
export interface CalendarFileSystem {
  stat(path: string): Promise<{ size: number; mtimeMs: number; isFile(): boolean }>
  readFile(path: string): Promise<string>
}

/** A calendar file larger than this is not read (ical.js parses in the main process). */
export const MAX_CALENDAR_FILE_BYTES = 15 * 1024 * 1024

const FILE = 'file'

export interface AddFileRequest {
  path: string
  name?: string
}

/** The file's name without its extension: "work" for C:\Users\sam\work.ics. */
export function calendarNameOf(path: string): string {
  const base = basename(path)
  return base.slice(0, base.length - extname(base).length).trim() || 'Calendar file'
}

const errorCode = (error: unknown) => (error as NodeJS.ErrnoException | null)?.code

export function createIcsFileSource(fs: CalendarFileSystem): CalendarSource<FileConfig> {
  async function readFileCalendar(path: string, previous?: { size?: unknown; mtime?: unknown; hash?: unknown }): Promise<ReadOutcome<FileConfig>> {
    const name = basename(path)
    let info: Awaited<ReturnType<CalendarFileSystem['stat']>>
    try {
      info = await fs.stat(path)
    } catch (error) {
      const code = errorCode(error)
      if (code === 'ENOENT' || code === 'ENOTDIR') throw new CalendarReadError(`The file ${name} is no longer there. Put it back, or remove this calendar.`, 'not-found')
      if (code === 'EACCES' || code === 'EPERM') throw new CalendarReadError(`Vicu may not read ${name}.`, 'forbidden')
      throw new CalendarReadError(`${name} could not be read.`, 'other')
    }
    if (!info.isFile()) throw new CalendarReadError(`${name} is not a file.`, 'format')
    if (info.size > MAX_CALENDAR_FILE_BYTES) throw new CalendarReadError(`${name} is too large to read (more than 15 MB).`, 'too-large')
    const mtime = Math.round(info.mtimeMs)
    if (previous && previous.size === info.size && previous.mtime === mtime) return { status: 'unchanged' }
    let text: string
    try {
      text = await fs.readFile(path)
    } catch {
      throw new CalendarReadError(`${name} could not be read.`, 'other')
    }
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
    if (!/BEGIN:VCALENDAR/i.test(text)) throw new CalendarReadError(`${name} is not a calendar file (no BEGIN:VCALENDAR).`, 'format')
    const hash = createHash('sha256').update(text).digest('hex')
    const validators = { size: info.size, mtime, hash }
    if (previous?.hash === hash) return { status: 'unchanged', validators }
    return { status: 'changed', documents: [{ key: FILE, ics: text }], validators }
  }

  return {
    kind: 'ics-file',

    parseConfig(value) {
      const path = (value as Partial<FileConfig> | null)?.path
      return typeof path === 'string' && path.trim() ? { path } : null
    },

    describe(config) {
      return `File on this computer: ${basename(config.path)}`
    },

    async connect(input) {
      const request = (input ?? {}) as Partial<AddFileRequest>
      const path = typeof request.path === 'string' ? request.path : ''
      if (!path) throw new CalendarReadError('Choose a calendar file.', 'format')
      const name = String(request.name ?? '').trim() || calendarNameOf(path)
      // Read it once before saving, so a file that is not a calendar is said at once.
      const first = await readFileCalendar(path)
      return { config: { path }, name, calendars: [{ remoteId: FILE, name }], firstReads: { [FILE]: first } }
    },

    async listCalendars(config) {
      return { config, calendars: [{ remoteId: FILE, name: '' }] }
    },

    covers() {
      return true
    },

    read(config, _remoteId, request) {
      return readFileCalendar(config.path, request.previous?.validators)
    },
  }
}
