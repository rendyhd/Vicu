import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '' }, safeStorage: {} }))

import { asCalendarError, calendarHttp, mayCarrySignIn, siteOf, statusMessage, type FetchLike } from '../calendar/http'
import { icsLinkSource } from '../calendar/sources/ics-link'
import { caldavServerUrl } from '../../shared/calendar-sources'
import type { SourceContext } from '../calendar/sources/types'

const ok = (body: string, headers: Record<string, string> = {}) => new Response(body, { status: 200, headers })

describe('the calendar HTTP', () => {
  it('only reads: PUT, DELETE and MKCALENDAR never leave', async () => {
    const base = vi.fn<FetchLike>(async () => ok(''))
    const http = calendarHttp({ base })
    for (const method of ['PUT', 'DELETE', 'MKCALENDAR', 'POST', 'PROPPATCH']) {
      await expect(http.fetch('https://example.com/a', { method })).rejects.toThrow('Vicu only reads calendars.')
    }
    expect(base).not.toHaveBeenCalled()
    await http.fetch('https://example.com/a', { method: 'REPORT' })
    expect(base).toHaveBeenCalledOnce()
  })

  it('sends the sign-in to the account\'s own site only, never over plain http from https', async () => {
    const seen: (string | null)[] = []
    const base: FetchLike = async (_url, init) => {
      seen.push(new Headers(init?.headers).get('authorization'))
      return ok('')
    }
    const http = calendarHttp({ base, auth: { username: 'sam', password: 'pw', origin: 'https://caldav.icloud.com/' } })
    await http.fetch('https://p52-caldav.icloud.com/123/calendars/')
    await http.fetch('https://evil.example.com/steal')
    await http.fetch('http://caldav.icloud.com/plain')
    // A header a caller set itself is replaced, never passed on.
    await http.fetch('https://evil.example.com/x', { headers: { Authorization: 'Basic leaked' } })
    expect(seen).toEqual([`Basic ${Buffer.from('sam:pw').toString('base64')}`, null, null, null])
  })

  describe('redirects, followed by hand', () => {
    const basic = `Basic ${Buffer.from('sam:pw').toString('base64')}`
    function server(routes: Record<string, () => Response>) {
      const seen: { url: string; method: string; auth: string | null; redirect?: string; body?: unknown }[] = []
      const base: FetchLike = async (url, init) => {
        seen.push({ url, method: String(init?.method), auth: new Headers(init?.headers).get('authorization'), redirect: init?.redirect, body: init?.body })
        const route = routes[url]
        return route ? route() : new Response('not here', { status: 404 })
      }
      return { base, seen }
    }
    const moved = (location: string, status = 301) => () => new Response(null, { status, headers: { location } })

    it('drops the sign-in on a redirect to another origin, even of the same site', async () => {
      const { base, seen } = server({
        'https://caldav.example.com/dav/': moved('https://other.example.com/dav/'),
        'https://other.example.com/dav/': () => ok('<multistatus/>'),
      })
      const http = calendarHttp({ base, auth: { username: 'sam', password: 'pw', origin: 'https://caldav.example.com/' } })
      const response = await http.fetch('https://caldav.example.com/dav/', { method: 'PROPFIND', body: '<propfind/>' })
      expect(await response.text()).toBe('<multistatus/>')
      expect(response.url).toBe('https://other.example.com/dav/')
      expect(seen.map((s) => [s.url, s.auth])).toEqual([
        ['https://caldav.example.com/dav/', basic],
        ['https://other.example.com/dav/', null],
      ])
      // Every request asked the base not to follow, and the PROPFIND kept its method and body.
      expect(seen.every((s) => s.redirect === 'manual')).toBe(true)
      expect(seen[1]).toMatchObject({ method: 'PROPFIND', body: '<propfind/>' })
    })

    it('keeps the sign-in on a redirect within the same origin, relative Location included', async () => {
      const { base, seen } = server({
        'https://caldav.example.com/.well-known/caldav': moved('/dav/', 308),
        'https://caldav.example.com/dav/': () => ok('yes'),
      })
      const http = calendarHttp({ base, auth: { username: 'sam', password: 'pw', origin: 'https://caldav.example.com/' } })
      await http.fetch('https://caldav.example.com/.well-known/caldav', { method: 'PROPFIND' })
      expect(seen.map((s) => s.auth)).toEqual([basic, basic])
    })

    it('never sends the sign-in to plain http or another port on a redirect', async () => {
      const { base, seen } = server({
        'https://caldav.example.com/a': moved('http://caldav.example.com/b'),
        'http://caldav.example.com/b': moved('https://caldav.example.com:8443/c'),
        'https://caldav.example.com:8443/c': () => ok(''),
      })
      const http = calendarHttp({ base, auth: { username: 'sam', password: 'pw', origin: 'https://caldav.example.com/' } })
      await http.fetch('https://caldav.example.com/a')
      expect(seen.map((s) => s.auth)).toEqual([basic, null, null])
    })

    it('keeps a bearer token to its own origin only', async () => {
      const { base, seen } = server({
        'https://graph.microsoft.com/v1.0/me/calendars': moved('https://graph.microsoft.com/v1.0/me/calendars?page=2', 302),
        'https://graph.microsoft.com/v1.0/me/calendars?page=2': moved('https://evil.example.com/collect', 307),
        'https://evil.example.com/collect': () => ok('{}'),
      })
      const http = calendarHttp({ base, bearer: { token: 't0k', origin: 'https://graph.microsoft.com' } })
      await http.fetch('https://graph.microsoft.com/v1.0/me/calendars')
      expect(seen.map((s) => s.auth)).toEqual(['Bearer t0k', 'Bearer t0k', null])
    })

    it('stops after five redirects, and never leaves http and https', async () => {
      const loop = server({ 'https://example.com/a': moved('https://example.com/a', 302) })
      await expect(calendarHttp({ base: loop.base }).fetch('https://example.com/a')).rejects.toThrow('too many')
      expect(loop.seen).toHaveLength(6)

      const away = server({ 'https://example.com/a': moved('file:///etc/passwd') })
      await expect(calendarHttp({ base: away.base }).fetch('https://example.com/a')).rejects.toThrow('not a web address')
      expect(away.seen).toHaveLength(1)
    })

    it('asks again with GET after a 303', async () => {
      const { base, seen } = server({
        'https://example.com/a': moved('https://example.com/b', 303),
        'https://example.com/b': () => ok('x'),
      })
      await calendarHttp({ base }).fetch('https://example.com/a', { method: 'REPORT', body: '<q/>' })
      expect(seen[1]).toMatchObject({ method: 'GET', body: undefined })
    })
  })

  it('knows sites', () => {
    expect(siteOf('p52-caldav.icloud.com')).toBe('icloud.com')
    expect(siteOf('dav.example.co.uk')).toBe('example.co.uk')
    expect(siteOf('127.0.0.1')).toBe('127.0.0.1')
    expect(siteOf('localhost')).toBe('localhost')
    expect(mayCarrySignIn('http://127.0.0.1:5232/sam/', 'http://127.0.0.1:5232/')).toBe(true)
    expect(mayCarrySignIn('https://other.com/', 'https://caldav.fastmail.com/')).toBe(false)
  })

  it('stops a calendar that is too large, by its header or its body', async () => {
    const big = calendarHttp({ base: async () => ok('x'.repeat(100)), maxBytes: 50 })
    await expect(big.fetch('https://example.com/a')).rejects.toThrow('too large')
    const declared = calendarHttp({ base: async () => ok('x', { 'content-length': '999' }), maxBytes: 50 })
    await expect(declared.fetch('https://example.com/a')).rejects.toThrow('too large')
  })

  it('gives up after its time limit', async () => {
    const base: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))
    const http = calendarHttp({ base, timeoutMs: 20 })
    await expect(http.fetch('https://example.com/a')).rejects.toThrow('took too long')
  })

  it('says network failures plainly', async () => {
    const http = calendarHttp({ base: async () => { throw new Error('net::ERR_NAME_NOT_RESOLVED') } })
    await expect(http.fetch('https://nowhere.invalid/')).rejects.toThrow('Could not find the server')
    const offline = calendarHttp({ base: async () => { throw new Error('net::ERR_INTERNET_DISCONNECTED') } })
    await expect(offline.fetch('https://example.com/')).rejects.toThrow('No internet connection.')
  })

  it('maps statuses to sentences without an address in them', () => {
    expect(statusMessage(401, 'account').message).toBe('Wrong user name or app password.')
    expect(statusMessage(403, 'account').message).toContain('403')
    expect(statusMessage(404, 'link').message).toContain('no longer works')
    expect(statusMessage(503, 'link').message).toContain('503')
    // A library's own error (with the address in it) is never shown: the statuses seen decide.
    const error = new Error('Invalid credentials: PROPFIND https://dav.example.com/sam/ returned 401 Unauthorized')
    expect(asCalendarError(error, { statuses: [207, 401] }, 'account').message).toBe('Wrong user name or app password.')
    expect(asCalendarError(error, { statuses: [] }, 'account').message).not.toContain('example.com')
  })
})

describe('CalDAV server addresses', () => {
  it('uses the preset\'s server, or the typed one with https and Nextcloud\'s path', () => {
    expect(caldavServerUrl('icloud', 'ignored')).toBe('https://caldav.icloud.com/')
    expect(caldavServerUrl('nextcloud', 'cloud.example.com')).toBe('https://cloud.example.com/remote.php/dav/')
    expect(caldavServerUrl('nextcloud', 'https://cloud.example.com/remote.php/dav/')).toBe('https://cloud.example.com/remote.php/dav/')
    expect(caldavServerUrl('other', 'http://127.0.0.1:5232')).toBe('http://127.0.0.1:5232/')
    expect(caldavServerUrl('other', '')).toBeNull()
    expect(caldavServerUrl('other', 'ftp://x')).toBeNull()
  })
})

describe('a calendar link', () => {
  const FEED = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:a\r\nDTSTART:20261110T090000Z\r\nDTEND:20261110T100000Z\r\nSUMMARY:A\r\nEND:VEVENT\r\nEND:VCALENDAR'

  function context(base: FetchLike): SourceContext {
    return { http: (options) => calendarHttp({ base, ...options }), now: () => Date.now() }
  }

  it('reads once on connect, then asks with If-None-Match and If-Modified-Since', async () => {
    const sent: Headers[] = []
    let notModified = false
    const base: FetchLike = async (_url, init) => {
      sent.push(new Headers(init?.headers))
      if (notModified) return new Response(null, { status: 304 })
      return ok(FEED, { etag: '"v1"', 'last-modified': 'Tue, 10 Nov 2026 08:00:00 GMT' })
    }
    const ctx = context(base)
    const connected = await icsLinkSource.connect({ name: ' Work ', url: 'webcal://example.com/secret.ics' }, ctx)
    expect(connected.name).toBe('Work')
    expect(connected.config.url).toBe('https://example.com/secret.ics')
    const first = connected.firstReads!.feed
    expect(first.status).toBe('changed')
    if (first.status !== 'changed') return
    expect(first.validators).toMatchObject({ etag: '"v1"', lastModified: 'Tue, 10 Nov 2026 08:00:00 GMT' })

    notModified = true
    const previous = { documents: first.documents, validators: first.validators, fetchedAt: 1, busyOnly: false }
    const again = await icsLinkSource.read(connected.config, 'feed', { from: new Date(), to: new Date(), previous }, ctx)
    expect(again.status).toBe('unchanged')
    expect(sent[1].get('if-none-match')).toBe('"v1"')
    expect(sent[1].get('if-modified-since')).toBe('Tue, 10 Nov 2026 08:00:00 GMT')
  })

  it('treats the same file again as unchanged when the server sends no validators', async () => {
    const ctx = context(async () => ok(FEED))
    const first = await icsLinkSource.read({ url: 'https://example.com/a.ics' }, 'feed', { from: new Date(), to: new Date() }, ctx)
    if (first.status !== 'changed') throw new Error('expected a copy')
    const previous = { documents: first.documents, validators: first.validators, fetchedAt: 1, busyOnly: false }
    expect((await icsLinkSource.read({ url: 'https://example.com/a.ics' }, 'feed', { from: new Date(), to: new Date(), previous }, ctx)).status).toBe('unchanged')
  })

  it('refuses what is not a calendar, and says a dead link plainly', async () => {
    await expect(icsLinkSource.connect({ url: 'https://example.com/page' }, context(async () => ok('<html>')))).rejects.toThrow('does not give a calendar')
    await expect(icsLinkSource.connect({ url: 'https://example.com/gone.ics' }, context(async () => new Response('', { status: 404 })))).rejects.toThrow('no longer works')
    await expect(icsLinkSource.connect({ url: 'ftp://example.com/a.ics' }, context(async () => ok(FEED)))).rejects.toThrow('https://')
  })

  it('reads a stored config written by the proof of concept (the bare link)', () => {
    expect(icsLinkSource.parseConfig('https://example.com/a.ics')).toEqual({ url: 'https://example.com/a.ics' })
    expect(icsLinkSource.parseConfig({ url: 'webcal://example.com/a.ics' })).toEqual({ url: 'https://example.com/a.ics' })
    expect(icsLinkSource.parseConfig({})).toBeNull()
    expect(icsLinkSource.describe({ url: 'https://calendar.google.com/calendar/ical/secret/basic.ics' })).toBe('calendar.google.com')
  })
})
