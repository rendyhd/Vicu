import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'fs'
import { readFile, stat } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { CalendarReadError } from '../calendar/http'
import { occurrencesBetween, parseIcsDocuments } from '../calendar/ics'
import { calendarNameOf, createIcsFileSource, MAX_CALENDAR_FILE_BYTES } from '../calendar/sources/ics-file'
import type { CalendarCopy, ReadOutcome, SourceContext } from '../calendar/sources/types'

// A calendar file on this computer (contract 20.9): read whole, "unchanged" by size and time without
// reading it, by hash when only the time moved; plain sentences for a file that is gone or wrong.

const ctx = { now: () => Date.now() } as unknown as SourceContext
const source = createIcsFileSource({ stat, readFile: (path) => readFile(path, 'utf8') })

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'vicu-ics-file-'))
  dirs.push(dir)
  return dir
}

const ics = (title: string) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Test//EN', 'BEGIN:VEVENT', 'UID:one@test', 'DTSTART:20261116T090000Z', 'DTEND:20261116T100000Z', `SUMMARY:${title}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n')

function copyOf(outcome: ReadOutcome): CalendarCopy {
  if (outcome.status !== 'changed') throw new Error('expected a changed read')
  return { documents: outcome.documents, validators: outcome.validators, fetchedAt: Date.now(), busyOnly: false }
}

const range = { from: new Date('2026-11-16T00:00:00Z'), to: new Date('2026-11-17T00:00:00Z') }

async function errorOf(promise: Promise<unknown>): Promise<CalendarReadError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof CalendarReadError) return error
    throw error
  }
  throw new Error('expected a CalendarReadError')
}

describe('calendar file', () => {
  it('names the calendar after the file and reads it before saving', async () => {
    const path = join(tempDir(), 'Team rota.ics')
    writeFileSync(path, ics('Stand-up'))
    const result = await source.connect({ path }, ctx)
    expect(result.name).toBe('Team rota')
    expect(result.config).toEqual({ path })
    expect(source.describe(result.config)).toBe('File on this computer: Team rota.ics')
    const first = result.firstReads?.file
    expect(first?.status).toBe('changed')
    const parsed = parseIcsDocuments(copyOf(first!).documents.map((doc) => doc.ics))
    expect(occurrencesBetween(parsed, 'cal', range.from, range.to, 10).map((event) => event.title)).toEqual(['Stand-up'])
  })

  it('keeps a name the user typed', async () => {
    const path = join(tempDir(), 'export.ics')
    writeFileSync(path, ics('A'))
    expect((await source.connect({ path, name: '  Thunderbird  ' }, ctx)).name).toBe('Thunderbird')
  })

  it('is unchanged without reading when the size and time are the same', async () => {
    const path = join(tempDir(), 'a.ics')
    writeFileSync(path, ics('First'))
    const copy = copyOf(await source.read({ path }, 'file', range, ctx))
    expect(await source.read({ path }, 'file', { ...range, previous: copy }, ctx)).toEqual({ status: 'unchanged' })
  })

  it('reads a changed file again', async () => {
    const path = join(tempDir(), 'a.ics')
    writeFileSync(path, ics('First'))
    const copy = copyOf(await source.read({ path }, 'file', range, ctx))
    writeFileSync(path, ics('Second version'))
    const next = await source.read({ path }, 'file', { ...range, previous: copy }, ctx)
    expect(next.status).toBe('changed')
    expect(next.status === 'changed' && next.documents[0].ics).toContain('Second version')
  })

  it('is unchanged when only the time moved (same bytes, by hash)', async () => {
    const path = join(tempDir(), 'a.ics')
    writeFileSync(path, ics('Same'))
    const copy = copyOf(await source.read({ path }, 'file', range, ctx))
    const later = new Date(Date.now() + 60_000)
    utimesSync(path, later, later)
    const next = await source.read({ path }, 'file', { ...range, previous: copy }, ctx)
    expect(next.status).toBe('unchanged')
    expect(next.validators?.hash).toBe(copy.validators.hash)
    expect(next.validators?.mtime).not.toBe(copy.validators.mtime)
  })

  it('drops a byte order mark', async () => {
    const path = join(tempDir(), 'bom.ics')
    writeFileSync(path, '\ufeff' + ics('Marked'))
    const outcome = await source.read({ path }, 'file', range, ctx)
    expect(outcome.status === 'changed' && outcome.documents[0].ics.startsWith('BEGIN:VCALENDAR')).toBe(true)
  })

  it('says plainly when the file is gone', async () => {
    const path = join(tempDir(), 'gone.ics')
    const error = await errorOf(source.read({ path }, 'file', range, ctx))
    expect(error.code).toBe('not-found')
    expect(error.message).toBe('The file gone.ics is no longer there. Put it back, or remove this calendar.')
  })

  it('refuses a file that is not a calendar', async () => {
    const path = join(tempDir(), 'notes.txt')
    writeFileSync(path, 'just some notes')
    const error = await errorOf(source.connect({ path }, ctx))
    expect(error.code).toBe('format')
    expect(error.message).toContain('notes.txt is not a calendar file')
  })

  it('refuses a file larger than the limit without reading it', async () => {
    let read = false
    const big = createIcsFileSource({
      stat: async () => ({ size: MAX_CALENDAR_FILE_BYTES + 1, mtimeMs: 1, isFile: () => true }),
      readFile: async () => {
        read = true
        return ''
      },
    })
    const error = await errorOf(big.read({ path: 'C:\\big.ics' }, 'file', range, ctx))
    expect(error.code).toBe('too-large')
    expect(read).toBe(false)
  })

  it('needs a path, and only reads the config it wrote', async () => {
    expect((await errorOf(source.connect({}, ctx))).message).toBe('Choose a calendar file.')
    expect(source.parseConfig({ path: '/home/sam/cal.ics' })).toEqual({ path: '/home/sam/cal.ics' })
    expect(source.parseConfig({ path: '' })).toBeNull()
    expect(source.parseConfig('https://example.com/cal.ics')).toBeNull()
  })

  it('takes the name from the file', () => {
    expect(calendarNameOf('/home/sam/work.ics')).toBe('work')
    expect(calendarNameOf('C:\\Users\\sam\\My calendar.ICS')).toBe('My calendar')
    expect(calendarNameOf('/tmp/.ics')).toBe('.ics')
  })
})
