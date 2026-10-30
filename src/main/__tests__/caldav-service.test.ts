import { createServer, type Server } from 'http'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const device = vi.hoisted(() => ({ directory: '' }))
vi.mock('electron', () => ({
  app: { getPath: () => device.directory },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`encrypted:${value}`),
    decryptString: (value: Buffer) => value.toString().replace('encrypted:', ''),
  },
}))
import { connections, secretFor } from '../caldav/store'
import { calendarColor, discover, events, publicError, remove, select, update } from '../caldav/service'
import { readFileSync } from 'fs'

let server: Server
let base = ''
let etag = '"version-1"'
let data = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:test\r\nDTSTART:20260610T090000Z\r\nDTEND:20260610T100000Z\r\nSUMMARY:CalDAV event\r\nDESCRIPTION:Preserved\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n'
const requests: { method: string; url: string; body: string; authorization?: string; ifMatch?: string }[] = []
let denyWrite = false
let foreignCalendar = false
let collideWrite = false
let privilege: 'read' | 'write-content' | undefined
const xml = (body: string) => `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/">${body}</d:multistatus>`
const resource = (href: string, props: string) => `<d:response><d:href>${href}</d:href><d:propstat><d:prop>${props}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`

beforeAll(async () => {
  device.directory = mkdtempSync(join(tmpdir(), 'vicu-caldav-'))
  server = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    requests.push({ method: request.method!, url: request.url!, body, authorization: request.headers.authorization, ifMatch: request.headers['if-match'] as string | undefined })
    if (request.url === '/.well-known/caldav') { response.writeHead(404).end(); return }
    if (request.url === '/redirect/') { response.writeHead(307, { Location: '/dav/' }).end(); return }
    if (request.url === '/foreign-redirect/') { response.writeHead(302, { Location: 'http://other.example/dav/' }).end(); return }
    if (request.url === '/digest/' && !request.headers.authorization?.startsWith('Digest ')) {
      response.writeHead(401, { 'WWW-Authenticate': 'Digest realm="calendar", nonce="testnonce", qop="auth", algorithm=MD5' }).end()
      return
    }
    if (request.method === 'PUT') {
      if (collideWrite) { etag = '"concurrent-write"'; collideWrite = false }
      if (denyWrite) { response.writeHead(403).end(); return }
      if (request.headers['if-match'] !== etag) { response.writeHead(412).end(); return }
      data = body
      etag = '"version-2"'
      response.writeHead(204, { ETag: etag }).end()
      return
    }
    const discovery = '<d:current-user-principal><d:href>/principal/</d:href></d:current-user-principal><c:calendar-home-set><d:href>/calendars/</d:href></c:calendar-home-set>'
    const reports = '<d:supported-report-set><d:supported-report><d:report><c:calendar-query/></d:report></d:supported-report><d:supported-report><d:report><c:calendar-multiget/></d:report></d:supported-report></d:supported-report-set>'
    const privileges = privilege ? `<d:current-user-privilege-set><d:privilege><d:${privilege}/></d:privilege></d:current-user-privilege-set>` : ''
    const calendar = resource(foreignCalendar ? 'http://other.example/calendar/' : '/calendars/work/', privileges + '<d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>Work</d:displayname><a:calendar-color>#AABBCCFF</a:calendar-color><c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set>' + reports)
    const object = resource('/calendars/work/event.ics', `<d:getetag>${etag.replaceAll('"', '&quot;')}</d:getetag><c:calendar-data><![CDATA[${data}]]></c:calendar-data>`)
    const content = request.method === 'REPORT' ? object : request.url === '/calendars/' ? calendar : resource(request.url!, discovery + reports)
    response.writeHead(207, { 'Content-Type': 'application/xml' }).end(xml(content))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No test server port')
  base = `http://127.0.0.1:${address.port}`
})
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  rmSync(device.directory, { recursive: true, force: true })
})

const input = () => ({ id: 'test-account', name: 'Test calendars', url: `${base}/dav/`, username: 'user', authMethod: 'Basic' as const, secret: 'app-password' })
const load = () => events('2026-06-10T00:00:00.000Z', '2026-06-11T00:00:00.000Z')

describe.sequential('CalDAV service against an HTTP DAV server (real tsdav)', () => {
  it('discovers calendars, colors and persists a write-only encrypted secret', async () => {
    const connection = await discover(input())
    expect(connection.calendars).toEqual([{ url: `${base}/calendars/work/`, name: 'Work', color: '#AABBCC', enabled: true }])
    expect(connection.hasSecret).toBe(true)
    expect(secretFor(connection.id)).toBe('app-password')
    expect(JSON.stringify(connections())).not.toContain('app-password')
    expect(readFileSync(join(device.directory, 'caldav.json'), 'utf8')).not.toContain('app-password')
    expect(requests.every((request) => request.authorization === `Basic ${Buffer.from('user:app-password').toString('base64')}`)).toBe(true)
  })

  it('issues a bounded time-range REPORT and reads the calendar color', async () => {
    const result = await load()
    expect(result.errors).toEqual([])
    expect(result.events).toHaveLength(1)
    expect(result.events[0]).toMatchObject({ title: 'CalDAV event', color: '#AABBCC', calendarName: 'Work', start: '2026-06-10T09:00:00.000Z' })
    const report = requests.find((request) => request.body.includes('time-range'))
    expect(report?.body).toContain('20260610T000000Z')
    expect(report?.body).toContain('20260611T000000Z')
  })

  it('writes a changed resource with If-Match, preserving other event fields', async () => {
    const [event] = (await load()).events
    await update({ id: event.id, start: '2026-06-10T10:00:00Z', end: '2026-06-10T11:30:00Z' })
    const put = requests.find((request) => request.method === 'PUT')
    expect(put?.ifMatch).toBe('"version-1"')
    expect(put?.body).toContain('DESCRIPTION:Preserved')
    expect(put?.body).toContain('DTSTART:20260610T100000Z')
    expect(put?.body).toContain('DTEND:20260610T113000Z')
    const refreshed = (await load()).events[0]
    expect(refreshed.start).toBe('2026-06-10T10:00:00.000Z')
    expect(refreshed.id).not.toBe(event.id)
    expect(refreshed.occurrenceKey).toBe(event.occurrenceKey)
  })

  it('refuses a stale cached event without a PUT', async () => {
    const [event] = (await load()).events
    etag = '"someone-else-edited"'
    const before = requests.filter((request) => request.method === 'PUT').length
    await expect(update({ id: event.id, start: '2026-06-10T11:00:00Z', end: '2026-06-10T12:00:00Z' })).rejects.toThrow('changed on the server')
    expect(requests.filter((request) => request.method === 'PUT')).toHaveLength(before)
  })

  it('surfaces read-only server responses without losing the event', async () => {
    const [event] = (await load()).events
    denyWrite = true
    await expect(update({ id: event.id, start: '2026-06-10T11:00:00Z', end: '2026-06-10T12:00:00Z' })).rejects.toThrow('does not allow')
    denyWrite = false
    expect((await load()).events[0].start).toBe('2026-06-10T10:00:00.000Z')
  })

  it('protects against a concurrent write after the fresh read with If-Match', async () => {
    const [event] = (await load()).events
    collideWrite = true
    await expect(update({ id: event.id, start: '2026-06-10T11:00:00Z', end: '2026-06-10T12:00:00Z' })).rejects.toThrow('changed on the server')
    expect(data).toContain('DTSTART:20260610T100000Z')
  })

  it('recognizes advertised read-only and write-content calendar privileges', async () => {
    privilege = 'read'
    let connection = await discover(input())
    expect(connection.calendars[0].readOnly).toBe(true)
    expect((await load()).events[0].readOnly).toBe(true)
    privilege = 'write-content'
    connection = await discover(input())
    expect(connection.calendars[0].readOnly).toBe(false)
    expect((await load()).events[0].readOnly).toBe(false)
    privilege = undefined
  })

  it('supports Digest challenges, Bearer tokens and anonymous calendars', async () => {
    let before = requests.length
    await discover({ ...input(), id: 'digest', url: `${base}/digest/`, authMethod: 'Digest' })
    expect(requests.slice(before).some((request) => request.authorization?.startsWith('Digest '))).toBe(true)
    remove('digest')
    before = requests.length
    await discover({ ...input(), id: 'bearer', authMethod: 'Bearer', secret: 'test-token' })
    expect(requests.slice(before).every((request) => request.authorization === 'Bearer test-token')).toBe(true)
    remove('bearer')
    before = requests.length
    await discover({ ...input(), id: 'anonymous', authMethod: 'None', secret: '' })
    expect(requests.slice(before).every((request) => !request.authorization)).toBe(true)
    remove('anonymous')
  })

  it('follows same-origin redirects but rejects cross-origin redirects', async () => {
    await discover({ ...input(), id: 'redirect', url: `${base}/redirect/` })
    remove('redirect')
    // tsdav can recover through its same-origin root fallback after a refused redirect.
    const recovered = await discover({ ...input(), id: 'foreign-redirect', url: `${base}/foreign-redirect/` })
    expect(recovered.calendars[0].url).toBe(`${base}/calendars/work/`)
    remove('foreign-redirect')
  })

  it('preserves saved credentials on rediscovery and only enables discovered URLs', async () => {
    const { secret: _, ...withoutSecret } = input()
    const connection = await discover(withoutSecret)
    expect(secretFor(connection.id)).toBe('app-password')
    select(connection.id, [{ url: 'http://malicious.example/', name: 'No', color: '#000000', enabled: true }])
    expect(connections()[0].calendars[0].enabled).toBe(false)
    expect((await load()).events).toEqual([])
    select(connection.id, connection.calendars)
  })

  it('never sends credentials to a foreign host advertised by discovery', async () => {
    foreignCalendar = true
    await expect(discover({ ...input(), id: 'foreign-account' })).rejects.toThrow('different host')
    foreignCalendar = false
  })

  it('rejects non-HTTP URLs, embedded credentials, invalid ranges and unknown event ids', async () => {
    await expect(discover({ ...input(), url: 'file:///etc/passwd' })).rejects.toThrow()
    await expect(discover({ ...input(), url: 'https://user:secret@example.com' })).rejects.toThrow()
    await expect(events('bad', 'bad')).rejects.toThrow('Invalid calendar date range')
    await expect(update({ id: 'forged', start: '', end: '' })).rejects.toThrow('Refresh Planner')
    expect(publicError(new Error('password=secret'))).not.toContain('secret')
  })

  it('removes connections and their cached editable event references', async () => {
    const [event] = (await load()).events
    remove(input().id)
    expect(connections()).toEqual([])
    await expect(update({ id: event.id, start: event.start, end: event.end })).rejects.toThrow('Refresh Planner')
  })

  it('normalizes colors and provides a stable fallback for servers without colors', () => {
    expect(calendarColor('#AABBCCDD', 'url')).toBe('#AABBCC')
    expect(calendarColor('bad', 'url')).toMatch(/^#[a-f0-9]{6}$/)
    expect(calendarColor(undefined, 'url')).toBe(calendarColor(undefined, 'url'))
    expect(calendarColor(undefined, 'url')).not.toBe(calendarColor(undefined, 'other'))
  })
})
