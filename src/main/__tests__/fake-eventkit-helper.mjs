// A stand-in for the macOS calendar helper (native/calendar-macos/VicuCalendar.swift) for
// calendar-eventkit.test.ts: the same JSON-line protocol, driven by the FAKE_EVENTKIT environment
// variable (JSON). It does not drop cancelled or declined events, so the tests see that main does.
//   access         status answer ('full', 'denied', 'not-determined' ...)
//   grant          what "request" turns 'not-determined' into
//   calendars      [{ id, title, color, source, sourceType, type }]
//   events         [{ key, calendarId, title, start, end, allDay, availability, status, self, location }]
//   changes        how many {"type":"changed"} lines to send after "watch", 30 ms apart
//   exitAfterWatch exit with code 1 this many ms after answering "watch" (first run only)
//   crashOn        a command after which it exits without answering
//   hangOn         a command it never answers
// FAKE_EVENTKIT_LOG: a file each run appends "start", "<cmd>" and "end" lines to.

import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const config = JSON.parse(process.env.FAKE_EVENTKIT || '{}')
const logFile = process.env.FAKE_EVENTKIT_LOG
const log = (line) => { if (logFile) appendFileSync(logFile, `${line}\n`) }
const firstRun = !logFile || !existsSync(logFile) || !readFileSync(logFile, 'utf8').includes('start')
log('start')
let access = config.access ?? 'full'

const send = (object) => process.stdout.write(`${JSON.stringify(object)}\n`)
// A line that is not the protocol (a stray log) must be ignored.
process.stdout.write('fake helper ready\n')

const lines = createInterface({ input: process.stdin })
lines.on('line', (line) => {
  let request
  try {
    request = JSON.parse(line)
  } catch {
    send({ id: null, ok: false, code: 'bad-request', message: 'Not a JSON request.' })
    return
  }
  const { id, cmd } = request
  log(cmd)
  if (config.crashOn === cmd) process.exit(3)
  if (config.hangOn === cmd) return
  switch (cmd) {
    case 'status':
      return send({ id, ok: true, status: access })
    case 'request':
      if (access === 'not-determined') access = config.grant ?? 'full'
      return send({ id, ok: true, status: access })
    case 'calendars':
      if (access !== 'full') return send({ id, ok: false, code: 'denied', message: 'denied' })
      return send({ id, ok: true, calendars: config.calendars ?? [] })
    case 'events': {
      if (access !== 'full') return send({ id, ok: false, code: 'denied', message: 'denied' })
      const known = new Set((config.calendars ?? []).map((c) => c.id))
      const ids = request.calendarIds ?? []
      const events = (config.events ?? []).filter((e) => ids.includes(e.calendarId) && e.start < request.to && e.end > request.from)
      return send({ id, ok: true, events, missing: ids.filter((c) => !known.has(c)), truncated: false })
    }
    case 'watch': {
      send({ id, ok: true, watching: true })
      for (let i = 1; i <= (config.changes ?? 0); i++) setTimeout(() => send({ type: 'changed' }), 30 * i)
      if (config.exitAfterWatch !== undefined && firstRun) setTimeout(() => process.exit(1), config.exitAfterWatch)
      return
    }
    default:
      return send({ id, ok: false, code: 'bad-request', message: 'Unknown command.' })
  }
})
lines.on('close', () => {
  log('end')
  process.exit(0)
})
