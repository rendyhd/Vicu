import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '' }, safeStorage: {} }))

import { calendarHttp, type FetchLike } from '../calendar/http'
import { occurrencesBetween, parseIcsDocuments } from '../calendar/ics'
import { caldavSource, type CaldavConfig } from '../calendar/sources/caldav'
import type { CalendarCopy, SourceContext } from '../calendar/sources/types'

// A CalDAV account against a small fake server (SabreDAV-shaped answers): discovery, the calendar
// list, a ranged read, a read of only what changed, the ctag shortcut and the error sentences.
// calendar-caldav-live.test.ts runs the same against a real Radicale.

const USER = 'sam@example.com'
const PASSWORD = 'app-password'
const BASIC = `Basic ${Buffer.from(`${USER}:${PASSWORD}`).toString('base64')}`

const event = (uid: string, summary: string, start: string, end: string, extra: string[] = []) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', `UID:${uid}`, `SUMMARY:${summary}`, `DTSTART:${start}`, `DTEND:${end}`, ...extra, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n')

interface FakeObject { etag: string; ics: string }

function fakeServer() {
  const state = {
    ctag: '1',
    objects: new Map<string, FakeObject>([
      ['/dav/calendars/sam/work/a.ics', { etag: '"a1"', ics: event('a', 'Standup', '20261110T093000Z', '20261110T094500Z', ['RRULE:FREQ=DAILY;COUNT=5']) }],
      ['/dav/calendars/sam/work/b.ics', { etag: '"b1"', ics: event('b', 'Review', '20261111T110000Z', '20261111T120000Z', ['DESCRIPTION:Private notes']) }],
    ]),
    requests: [] as string[],
    authHeaders: [] as (string | null)[],
  }
  const xml = (body: string, status = 207) =>
    new Response(`<?xml version="1.0" encoding="utf-8"?>\n<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/">${body}</d:multistatus>`, {
      status,
      headers: { 'content-type': 'application/xml; charset=utf-8' },
    })
  const ok = (href: string, props: string) =>
    `<d:response><d:href>${href}</d:href><d:propstat><d:prop>${props}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`

  const fetch: FetchLike = async (url, init) => {
    const method = String(init?.method ?? 'GET').toUpperCase()
    const path = new URL(url).pathname
    const body = typeof init?.body === 'string' ? init.body : ''
    state.requests.push(`${method} ${path}`)
    const headers = new Headers(init?.headers)
    state.authHeaders.push(headers.get('authorization'))
    if (path === '/.well-known/caldav') return new Response(null, { status: 301, headers: { Location: '/dav/' } })
    if (headers.get('authorization') !== BASIC) return new Response('Unauthorized', { status: 401 })
    if (method === 'PROPFIND' && path === '/dav/') return xml(ok('/dav/', '<d:current-user-principal><d:href>/dav/principals/sam/</d:href></d:current-user-principal>'))
    if (method === 'PROPFIND' && path === '/dav/principals/sam/') return xml(ok('/dav/principals/sam/', '<c:calendar-home-set><d:href>/dav/calendars/sam/</d:href></c:calendar-home-set>'))
    if (method === 'PROPFIND' && path === '/dav/calendars/sam/') {
      return xml([
        ok('/dav/calendars/sam/', '<d:resourcetype><d:collection/></d:resourcetype>'),
        ok('/dav/calendars/sam/work/', `<d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>Work</d:displayname><cs:getctag>${state.ctag}</cs:getctag><c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set>`),
        ok('/dav/calendars/sam/chores/', '<d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>Chores</d:displayname><c:supported-calendar-component-set><c:comp name="VTODO"/></c:supported-calendar-component-set>'),
      ].join(''))
    }
    if (method === 'PROPFIND' && path === '/dav/calendars/sam/work/') {
      if (body.includes('supported-report-set')) return xml(ok(path, '<d:supported-report-set/>'))
      return xml(ok(path, `<cs:getctag>${state.ctag}</cs:getctag><d:sync-token>token-${state.ctag}</d:sync-token>`))
    }
    if (method === 'PROPFIND' && path === '/dav/calendars/sam/chores/') return xml(ok(path, '<d:supported-report-set/>'))
    if (method === 'PROPFIND' && path === '/dav/calendars/sam/gone/') return new Response('', { status: 404 })
    if (method === 'REPORT' && path === '/dav/calendars/sam/work/') {
      if (body.includes('calendar-query')) {
        if (body.includes('expand')) throw new Error('Vicu must expand recurrence itself')
        return xml([...state.objects].map(([href, o]) => ok(href, `<d:getetag>${o.etag}</d:getetag>`)).join(''))
      }
      if (body.includes('calendar-multiget')) {
        const hrefs = [...body.matchAll(/<d:href>([^<]+)<\/d:href>/g)].map((m) => m[1])
        return xml(hrefs.map((href) => {
          const o = state.objects.get(href)!
          return ok(href, `<d:getetag>${o.etag}</d:getetag><c:calendar-data>${o.ics.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</c:calendar-data>`)
        }).join(''))
      }
    }
    return new Response('', { status: 405 })
  }
  return { state, fetch }
}

function context(base: FetchLike): SourceContext {
  return { http: (options) => calendarHttp({ base, ...options }), now: () => Date.now() }
}

const from = new Date('2026-11-09T00:00:00Z')
const to = new Date('2026-11-16T00:00:00Z')

describe('a CalDAV account', () => {
  it('signs in through /.well-known/caldav and offers only calendars with events', async () => {
    const server = fakeServer()
    const connected = await caldavSource.connect({ preset: 'other', server: 'https://dav.example.com', username: USER, password: PASSWORD }, context(server.fetch))
    expect(connected.name).toBe('CalDAV')
    expect(connected.calendars.map((c) => c.name)).toEqual(['Work'])
    expect(Object.values(connected.config.calendars)).toEqual(['https://dav.example.com/dav/calendars/sam/work/'])
    expect(caldavSource.describe(connected.config)).toBe('sam@example.com on dav.example.com')
    // Read-only, and the remote id is not the address.
    expect(server.state.requests.every((r) => /^(PROPFIND|REPORT|GET) /.test(r))).toBe(true)
    expect(connected.calendars[0].remoteId).not.toContain('/')
  })

  it('reads a range, then only the events that changed, and nothing when the ctag is the same', async () => {
    const server = fakeServer()
    const ctx = context(server.fetch)
    const { config, calendars } = await caldavSource.connect({ preset: 'other', server: 'https://dav.example.com', username: USER, password: PASSWORD }, ctx)
    const id = calendars[0].remoteId

    const first = await caldavSource.read(config, id, { from, to }, ctx)
    if (first.status !== 'changed') throw new Error('expected a copy')
    const titles = occurrencesBetween(parseIcsDocuments(first.documents.map((d) => d.ics)), 'w', from, to).map((e) => e.title)
    expect(titles).toEqual(['Standup', 'Standup', 'Review', 'Standup', 'Standup', 'Standup'])
    // The window reaches past the days asked for, so the next weeks need no new query.
    expect(caldavSource.covers({ documents: [], validators: first.validators, fetchedAt: 0, busyOnly: false }, from, new Date('2026-12-01T00:00:00Z'))).toBe(true)

    let copy: CalendarCopy = { documents: first.documents, validators: first.validators, fetchedAt: 0, busyOnly: false }
    server.state.requests.length = 0
    expect((await caldavSource.read(config, id, { from, to, previous: copy }, ctx)).status).toBe('unchanged')
    expect(server.state.requests).toEqual(['PROPFIND /dav/calendars/sam/work/'])

    // One event changes, one is added: only those two are fetched.
    server.state.ctag = '2'
    server.state.objects.set('/dav/calendars/sam/work/b.ics', { etag: '"b2"', ics: event('b', 'Review (moved)', '20261111T130000Z', '20261111T140000Z') })
    server.state.objects.set('/dav/calendars/sam/work/c.ics', { etag: '"c1"', ics: event('c', 'Planning', '20261112T100000Z', '20261112T110000Z') })
    server.state.requests.length = 0
    const changed = await caldavSource.read(config, id, { from, to, previous: copy }, ctx)
    if (changed.status !== 'changed') throw new Error('expected changes')
    const multiget = server.state.requests.filter((r) => r.startsWith('REPORT'))
    expect(multiget).toHaveLength(2)
    expect(changed.documents.map((d) => d.etag)).toEqual(['"a1"', '"b2"', '"c1"'])
    // The unchanged event is the same object as before (not fetched, not reduced again).
    expect(changed.documents[0]).toBe(copy.documents[0])
    copy = { documents: changed.documents, validators: changed.validators, fetchedAt: 0, busyOnly: false }

    // An event deleted on the server leaves the copy.
    server.state.ctag = '3'
    server.state.objects.delete('/dav/calendars/sam/work/a.ics')
    const removed = await caldavSource.read(config, id, { from, to, previous: copy }, ctx)
    if (removed.status !== 'changed') throw new Error('expected changes')
    expect(removed.documents.map((d) => d.key)).toEqual(['/dav/calendars/sam/work/b.ics', '/dav/calendars/sam/work/c.ics'])
  })

  it('says a wrong password, a refused calendar and a gone one plainly', async () => {
    const server = fakeServer()
    const ctx = context(server.fetch)
    await expect(caldavSource.connect({ preset: 'other', server: 'https://dav.example.com', username: USER, password: 'nope' }, ctx)).rejects.toThrow('Wrong user name or app password.')
    await expect(caldavSource.connect({ preset: 'other', server: '', username: USER, password: PASSWORD }, ctx)).rejects.toThrow('server address')
    await expect(caldavSource.connect({ preset: 'other', server: 'https://dav.example.com', username: USER, password: '' }, ctx)).rejects.toThrow('app password')
    const config: CaldavConfig = {
      preset: 'other', serverUrl: 'https://dav.example.com/', username: USER, password: PASSWORD, homeUrl: 'https://dav.example.com/dav/calendars/sam/',
      calendars: { gone: 'https://dav.example.com/dav/calendars/sam/gone/' },
    }
    await expect(caldavSource.read(config, 'gone', { from, to }, ctx)).rejects.toThrow('no longer on the server')
    await expect(caldavSource.read(config, 'unknown', { from, to }, ctx)).rejects.toThrow('no longer on the account')
  })

  it('never sends the password to another site the server names', async () => {
    const server = fakeServer()
    const ctx = context(server.fetch)
    const config: CaldavConfig = {
      preset: 'other', serverUrl: 'https://dav.example.com/', username: USER, password: PASSWORD, homeUrl: 'https://dav.example.com/dav/calendars/sam/',
      calendars: { elsewhere: 'https://collector.example.org/dav/calendars/sam/work/' },
    }
    await expect(caldavSource.read(config, 'elsewhere', { from, to }, ctx)).rejects.toThrow()
    expect(server.state.authHeaders.at(-1)).toBeNull()
  })

  it('keeps the password only in its config, which the store seals', () => {
    const config = caldavSource.parseConfig({ preset: 'fastmail', serverUrl: 'https://caldav.fastmail.com/', username: USER, password: PASSWORD, homeUrl: 'https://caldav.fastmail.com/dav/calendars/user/sam/', calendars: { a: 'https://x/', b: 3 } })
    expect(config?.calendars).toEqual({ a: 'https://x/' })
    expect(caldavSource.parseConfig({ serverUrl: 'x' })).toBeNull()
  })
})
