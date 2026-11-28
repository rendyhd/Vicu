// A local CalDAV server for the calendar scenarios (calendar-sources, CALS): Radicale in Docker.
//
//   node scripts/ui-verify/radicale.mjs          start (or create) the container and seed it
//   node scripts/ui-verify/radicale.mjs --stop   stop the container
//
// The container is `vicu-test-radicale` (VICU_TEST_RADICALE_CONTAINER) on 127.0.0.1:5232
// (VICU_TEST_RADICALE_PORT), image tomsquest/docker-radicale, with plain htpasswd sign-in. The user
// is `vicu` with a random password kept in scripts/ui-verify/.local/radicale.json (git-ignored);
// its config and users file live in scripts/ui-verify/.local/radicale/. Seeding deletes the user's
// calendars and makes them again, with times relative to today:
//   Work      (events)  a weekday standup (recurring, one occurrence moved, one removed),
//                       a planning meeting, a call named in a Windows time zone without VTIMEZONE
//   Personal  (events)  a dentist appointment, a free lunch
//   Chores    (tasks only, VTODO) which Vicu must not offer
// Only this script writes to the server (MKCALENDAR, PUT, DELETE); Vicu only reads.
// Run it from PowerShell or Git Bash; on Git Bash, Docker needs MSYS_NO_PATHCONV=1 (set here).

import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { localPath, readLocalJson, writeLocal } from './lib.mjs'

const CONTAINER = process.env.VICU_TEST_RADICALE_CONTAINER ?? 'vicu-test-radicale'
const PORT = Number(process.env.VICU_TEST_RADICALE_PORT ?? 5232)
export const RADICALE_URL = `http://127.0.0.1:${PORT}/`
const USER = 'vicu'

const docker = (...args) =>
  execFileSync('docker', args, { encoding: 'utf8', env: { ...process.env, MSYS_NO_PATHCONV: '1' }, stdio: ['ignore', 'pipe', 'pipe'] }).trim()

/** The test credentials, made once. */
export function radicaleCredentials() {
  let creds = readLocalJson('radicale.json')
  if (!creds) {
    creds = { url: RADICALE_URL, username: USER, password: randomBytes(12).toString('base64url') }
    writeLocal('radicale.json', creds)
  }
  return creds
}

function containerState() {
  try {
    return docker('inspect', '-f', '{{.State.Running}}', CONTAINER)
  } catch {
    return 'missing'
  }
}

export async function ensureRadicale() {
  const creds = radicaleCredentials()
  const dir = localPath('radicale')
  mkdirSync(dir, { recursive: true })
  writeFileSync(`${dir}/config`, [
    '[server]',
    'hosts = 0.0.0.0:5232',
    '[auth]',
    'type = htpasswd',
    'htpasswd_filename = /config/users',
    'htpasswd_encryption = plain',
    '[rights]',
    'type = owner_only',
    '[storage]',
    'filesystem_folder = /data/collections',
    '',
  ].join('\n'))
  writeFileSync(`${dir}/users`, `${creds.username}:${creds.password}\n`, { mode: 0o600 })
  const state = containerState()
  if (state === 'missing') {
    docker('run', '-d', '--name', CONTAINER, '-p', `127.0.0.1:${PORT}:5232`, '-v', `${dir.replace(/\\/g, '/')}:/config:ro`, 'tomsquest/docker-radicale')
  } else if (state !== 'true') {
    docker('start', CONTAINER)
  }
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(RADICALE_URL, { method: 'PROPFIND', headers: { Depth: '0', Authorization: auth(creds) } })
      if (res.status === 207 || res.status === 200) return creds
    } catch {
      // Not up yet.
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error('Radicale did not start on ' + RADICALE_URL)
}

const auth = (creds) => `Basic ${Buffer.from(`${creds.username}:${creds.password}`).toString('base64')}`

async function dav(creds, method, path, body, headers = {}) {
  const res = await fetch(new URL(path, RADICALE_URL), {
    method,
    headers: { Authorization: auth(creds), 'Content-Type': 'application/xml; charset=utf-8', ...headers },
    body,
  })
  if (res.status >= 400 && !(method === 'DELETE' && res.status === 404)) {
    throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`)
  }
  return res
}

const pad = (n) => String(n).padStart(2, '0')
function dayOffset(offset) {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + offset)
  return d
}
/** Floating local time: the reader's own clock, like most same-zone calendars. */
const floating = (offset, h, m) => {
  const d = dayOffset(offset)
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(h)}${pad(m)}00`
}
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')

/** A Windows zone name whose offset equals this machine's today, so the test can say where it lands. */
function windowsZoneHere() {
  const offset = -new Date().getTimezoneOffset()
  const zones = {
    60: 'W. Europe Standard Time', 120: 'W. Europe Standard Time', 0: 'GMT Standard Time',
    [-300]: 'Eastern Standard Time', [-240]: 'Eastern Standard Time', 780: 'New Zealand Standard Time', 720: 'New Zealand Standard Time',
  }
  return zones[offset] ?? null
}

function ics(uid, lines) {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Vicu//Radicale seed//EN', ...lines, 'END:VCALENDAR'].join('\r\n') + '\r\n'
}
const vevent = (uid, lines) => ['BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${stamp()}`, ...lines, 'END:VEVENT']

async function makeCalendar(creds, slug, name, component) {
  await dav(creds, 'DELETE', `/${creds.username}/${slug}/`)
  await dav(creds, 'MKCALENDAR', `/${creds.username}/${slug}/`, `<?xml version="1.0" encoding="utf-8"?>
<C:mkcalendar xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:set><D:prop>
    <D:displayname>${name}</D:displayname>
    <C:supported-calendar-component-set><C:comp name="${component}"/></C:supported-calendar-component-set>
  </D:prop></D:set>
</C:mkcalendar>`)
}

async function put(creds, slug, uid, text) {
  await dav(creds, 'PUT', `/${creds.username}/${slug}/${uid}.ics`, text, { 'Content-Type': 'text/calendar; charset=utf-8' })
}

/** Delete and make the test calendars again. Returns what the scenario checks. */
export async function seedRadicale() {
  const creds = await ensureRadicale()
  // The principal collection exists once the user has been seen.
  await dav(creds, 'PROPFIND', `/${creds.username}/`, undefined, { Depth: '0' })
  await makeCalendar(creds, 'work', 'Work', 'VEVENT')
  await makeCalendar(creds, 'personal', 'Personal', 'VEVENT')
  await makeCalendar(creds, 'chores', 'Chores', 'VTODO')

  // Standup on every day from a week ago, 09:30-09:45; tomorrow's is at 10:00, the day after is skipped.
  await put(creds, 'work', 'standup', ics('standup', [
    ...vevent('standup', ['SUMMARY:CALS Standup', `DTSTART:${floating(-7, 9, 30)}`, `DTEND:${floating(-7, 9, 45)}`, 'RRULE:FREQ=DAILY', `EXDATE:${floating(2, 9, 30)}`]),
    ...vevent('standup', [`RECURRENCE-ID:${floating(1, 9, 30)}`, 'SUMMARY:CALS Standup (moved)', `DTSTART:${floating(1, 10, 0)}`, `DTEND:${floating(1, 10, 15)}`]),
  ]))
  await put(creds, 'work', 'planning', ics('planning', vevent('planning', ['SUMMARY:CALS Planning', 'LOCATION:Room 2', `DTSTART:${floating(1, 13, 0)}`, `DTEND:${floating(1, 14, 0)}`])))
  const zone = windowsZoneHere()
  if (zone) {
    await put(creds, 'work', 'zoned', ics('zoned', vevent('zoned', ['SUMMARY:CALS Zoned call', `DTSTART;TZID=${zone}:${floating(1, 16, 0)}`, `DTEND;TZID=${zone}:${floating(1, 16, 30)}`])))
  }
  await put(creds, 'personal', 'dentist', ics('dentist', vevent('dentist', ['SUMMARY:CALS Dentist', `DTSTART:${floating(1, 8, 0)}`, `DTEND:${floating(1, 8, 45)}`])))
  await put(creds, 'personal', 'lunch', ics('lunch', vevent('lunch', ['SUMMARY:CALS Lunch', 'TRANSP:TRANSPARENT', `DTSTART:${floating(1, 12, 0)}`, `DTEND:${floating(1, 12, 45)}`])))
  await put(creds, 'chores', 'laundry', ics('laundry', ['BEGIN:VTODO', 'UID:laundry', `DTSTAMP:${stamp()}`, 'SUMMARY:Laundry', 'END:VTODO']))
  return { ...creds, zoned: Boolean(zone) }
}

/** Put one more event (the scenario checks that a change reaches the app). */
export async function putRadicaleEvent(slug, uid, lines) {
  const creds = radicaleCredentials()
  await put(creds, slug, uid, ics(uid, vevent(uid, lines)))
}

export { floating as radicaleTime }

if (process.argv[1] && process.argv[1].endsWith('radicale.mjs')) {
  if (process.argv.includes('--stop')) {
    if (containerState() === 'true') docker('stop', CONTAINER)
    console.log(`stopped ${CONTAINER}`)
  } else {
    const result = await seedRadicale()
    console.log(`Radicale is up on ${RADICALE_URL} (user ${result.username}); calendars Work, Personal and Chores seeded`)
  }
}
