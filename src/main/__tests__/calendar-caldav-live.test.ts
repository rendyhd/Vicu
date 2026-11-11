import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '' }, safeStorage: {} }))

import { calendarHttp } from '../calendar/http'
import { occurrencesBetween, parseIcsDocuments } from '../calendar/ics'
import { caldavSource } from '../calendar/sources/caldav'
import type { SourceContext } from '../calendar/sources/types'

// A CalDAV account against a real server: the local Radicale of scripts/ui-verify/radicale.mjs.
// Runs only with VICU_TEST_CALDAV_LIVE=1, after `node scripts/ui-verify/radicale.mjs` (it reads
// the credentials from scripts/ui-verify/.local/radicale.json). The app does the same through
// Electron's net.fetch (harness scenario calendar-sources).

const credsFile = join(__dirname, '..', '..', '..', 'scripts', 'ui-verify', '.local', 'radicale.json')
const live = process.env.VICU_TEST_CALDAV_LIVE === '1' && existsSync(credsFile)

describe.skipIf(!live)('CalDAV against a local Radicale', () => {
  const creds = live ? JSON.parse(readFileSync(credsFile, 'utf8')) as { url: string; username: string; password: string } : null
  const sent: string[] = []
  const ctx: SourceContext = {
    http: (options) => calendarHttp({
      base: (url, init) => {
        sent.push(`${init?.method ?? 'GET'} ${new URL(url).pathname}`)
        return fetch(url, init)
      },
      ...options,
    }),
    now: () => Date.now(),
  }
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const from = new Date(start.getTime() - 86_400_000)
  const to = new Date(start.getTime() + 3 * 86_400_000)

  it('finds the calendars with events, reads a range and then only what changed', async () => {
    const connected = await caldavSource.connect({ preset: 'other', server: creds!.url, username: creds!.username, password: creds!.password }, ctx)
    expect(connected.calendars.map((c) => c.name).sort()).toEqual(['Personal', 'Work'])
    expect(sent.every((line) => /^(GET|PROPFIND|REPORT|OPTIONS) /.test(line))).toBe(true)

    const work = connected.calendars.find((c) => c.name === 'Work')!
    const first = await caldavSource.read(connected.config, work.remoteId, { from, to }, ctx)
    expect(first.status).toBe('changed')
    if (first.status !== 'changed') return
    const events = occurrencesBetween(parseIcsDocuments(first.documents.map((d) => d.ics)), 'w', from, to)
    const titles = events.map((e) => e.title)
    expect(titles).toContain('CALS Standup')
    expect(titles).toContain('CALS Standup (moved)')
    expect(titles).toContain('CALS Planning')

    sent.length = 0
    const previous = { documents: first.documents, validators: first.validators, fetchedAt: Date.now(), busyOnly: false }
    const again = await caldavSource.read(connected.config, work.remoteId, { from, to, previous }, ctx)
    expect(again.status).toBe('unchanged')
    // The ctag answered: one PROPFIND, no query.
    expect(sent).toEqual([expect.stringMatching(/^PROPFIND /)])
  })

  it('says a wrong password plainly', async () => {
    await expect(caldavSource.connect({ preset: 'other', server: creds!.url, username: creds!.username, password: 'wrong' }, ctx)).rejects.toThrow('Wrong user name or app password.')
  })
})
