// CALS: connected calendars, finished links (phase 2a) and CalDAV accounts (phase 2c), contract 20.9.
//
//   A. Settings, Plan: Add calendar opens the dialog; a link is typed and added (real input). It is
//      served here with an ETag. More links through the API: a VFREEBUSY share, a file whose event
//      names a Windows time zone without a VTIMEZONE, and one that will start failing.
//   B. Plan, tomorrow: the link's events, the free/busy periods drawn as "Busy" (one tentative), the
//      Windows-zone event at its real time.
//   C. A manual refresh (F5) reads every link again: the ETag link answers 304, nothing is lost.
//   D. The failing link keeps its last copy on screen and says "Not updated since" with the reason.
//   E. A CalDAV account against the local Radicale (scripts/ui-verify/radicale.mjs): a wrong
//      password is said plainly, then the right one; only calendars with events are offered; the
//      recurring standup with its moved and skipped occurrences, the other calendar's events.
//   F. Rename and colour a calendar; Busy only hides its titles, also in the copy kept on disk; no
//      link or password in calendar-feeds.json.
//   G. The Plan gear shows a summary; Manage opens Settings at the calendars. axe on the dialog
//      and the list.
//
// Needs Docker for Radicale. Its own throwaway data only: every calendar is removed at the end.

import { createServer } from 'node:http'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { radicaleCredentials, seedRadicale } from '../radicale.mjs'

export const meta = {
  id: 'CALS',
  wave: 6,
  title: 'Connected calendars: links finished, CalDAV accounts',
}

const pad = (n) => String(n).padStart(2, '0')
const dayAt = (offset, h = 0, m = 0) => {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  d.setHours(h, m, 0, 0)
  return d
}
const floating = (offset, h, m) => {
  const d = dayAt(offset, h, m)
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(h)}${pad(m)}00`
}
const utc = (date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')
const calendar = (...lines) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Vicu//CALS//EN', ...lines, 'END:VCALENDAR'].join('\r\n')
const vevent = (uid, lines) => ['BEGIN:VEVENT', `UID:${uid}@cals`, `DTSTAMP:${utc(new Date())}`, ...lines, 'END:VEVENT']

function windowsZoneHere() {
  const offset = -new Date().getTimezoneOffset()
  const zones = { 60: 'W. Europe Standard Time', 120: 'W. Europe Standard Time', 0: 'GMT Standard Time', [-300]: 'Eastern Standard Time', [-240]: 'Eastern Standard Time', 780: 'New Zealand Standard Time', 720: 'New Zealand Standard Time' }
  return zones[offset] ?? null
}

const FEEDS = {
  etag: () => calendar(
    ...vevent('etag-review', ['SUMMARY:CALS Link review', 'LOCATION:Room 9', `DTSTART:${floating(1, 11, 0)}`, `DTEND:${floating(1, 12, 0)}`]),
    ...vevent('etag-gym', ['SUMMARY:CALS Gym', 'STATUS:TENTATIVE', `DTSTART:${floating(1, 18, 0)}`, `DTEND:${floating(1, 19, 0)}`]),
  ),
  freebusy: () => calendar(
    'BEGIN:VFREEBUSY',
    'UID:fb@cals',
    `DTSTART:${utc(dayAt(0))}`,
    `DTEND:${utc(dayAt(7))}`,
    `FREEBUSY:${utc(dayAt(1, 14, 0))}/${utc(dayAt(1, 15, 0))}`,
    `FREEBUSY;FBTYPE=BUSY-TENTATIVE:${utc(dayAt(1, 15, 30))}/${utc(dayAt(1, 16, 0))}`,
    `FREEBUSY;FBTYPE=FREE:${utc(dayAt(1, 7, 0))}/${utc(dayAt(1, 8, 0))}`,
    'END:VFREEBUSY',
  ),
  windows: (zone) => calendar(
    ...vevent('win', ['SUMMARY:CALS Windows zone', `DTSTART;TZID=${zone}:${floating(1, 17, 0)}`, `DTEND;TZID=${zone}:${floating(1, 17, 30)}`]),
  ),
  flaky: () => calendar(
    ...vevent('flaky', ['SUMMARY:CALS Flaky feed', `DTSTART:${floating(1, 7, 0)}`, `DTEND:${floating(1, 7, 30)}`]),
  ),
}

export default async function run(h) {
  const page = h.page
  await h.resize(1400, 900)
  await h.dismiss()

  // --- The local link server -----------------------------------------------------------------
  const log = []
  let flakyFails = false
  const zone = windowsZoneHere()
  const server = createServer((req, res) => {
    const name = (req.url ?? '').split('/').pop().replace('.ics', '')
    log.push({ name, inm: req.headers['if-none-match'] ?? null })
    if (name === 'flaky' && flakyFails) {
      res.writeHead(500)
      res.end('boom')
      return
    }
    if (name === 'etag' && req.headers['if-none-match'] === '"cals-v1"') {
      res.writeHead(304, { ETag: '"cals-v1"' })
      res.end()
      return
    }
    const body = name === 'windows' ? FEEDS.windows(zone ?? 'W. Europe Standard Time') : FEEDS[name]?.()
    if (!body) {
      res.writeHead(404)
      res.end()
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8', ...(name === 'etag' ? { ETag: '"cals-v1"' } : {}) })
    res.end(body)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}/secret-cals-7f3a`
  const link = (name) => `${base}/${name}.ics`

  const radicale = await seedRadicale()

  const eventTitles = () => page.locator('[data-plan-event]').evaluateAll((nodes) => nodes.map((n) => ({ text: n.textContent, title: n.getAttribute('title'), top: parseFloat(n.style.top) })))
  const scrollTo = (hour) =>
    page.evaluate((hour) => {
      const scroller = document.querySelector('[data-plan-scroller]')
      if (scroller) scroller.scrollTop = hour * 60 - 20
    }, hour)
  const openTomorrow = async () => {
    await h.goto('/plan')
    await page.locator('[data-plan-view="day"]').click()
    await page.locator('[data-plan-today]').click()
    await page.locator('[data-plan-next]').click()
    await h.wait(1200)
  }
  const openCalendarsSettings = async () => {
    await h.goto('/settings?section=calendars')
    await page.locator('[data-calendar-feeds]').waitFor({ timeout: 10000 })
    await page.locator('[data-calendar-feeds]').scrollIntoViewIfNeeded()
    await h.wait(300)
  }
  const userData = await h.app.evaluate(({ app }) => app.getPath('userData'))

  try {
    await page.evaluate(() => window.api.saveConfigPatch({ planner_enabled: true, planner_view: 'day', planner_source: 'day' }))
    await page.reload()
    await h.wait(1200)

    // --- A. Add a link through the dialog ------------------------------------------------------
    await openCalendarsSettings()
    await page.locator('[data-calendar-open-add]').click()
    await page.locator('[data-calendar-dialog]').waitFor()
    await page.locator('[data-calendar-name]').click()
    await h.type('Team link')
    await page.locator('[data-calendar-url]').click()
    await h.type(link('etag'), { delay: 2 })
    await h.capture('dialog-link')
    await h.axe('[data-calendar-dialog]', { label: 'add-calendar dialog' })
    await page.locator('[data-calendar-add]').click()
    await page.locator('[data-calendar-dialog]').waitFor({ state: 'detached', timeout: 15000 })
    await h.assert('A: the link is listed', (await page.locator('[data-calendar-feed-name]', { hasText: 'Team link' }).count()) === 1)
    await page.evaluate(async ({ links }) => {
      for (const [name, url] of links) {
        const result = await window.api.calendar.add({ name, url })
        if (!result.success) throw new Error(`${name}: ${result.error}`)
      }
    }, { links: [['Free/busy share', link('freebusy')], ['Outlook export', link('windows')], ['Flaky feed', link('flaky')]] })
    await page.reload()
    await h.wait(1000)

    // --- B. Plan, tomorrow ---------------------------------------------------------------------
    await openTomorrow()
    await scrollTo(10)
    await h.wait(400)
    let events = await eventTitles()
    const titleOf = (text) => events.find((e) => e.text.includes(text))
    await h.assert('B: the link\'s events are drawn', Boolean(titleOf('CALS Link review')) && Boolean(titleOf('CALS Gym')), events.map((e) => e.text))
    const busy = events.filter((e) => e.text.startsWith('Busy'))
    await h.assert('B: free/busy periods are Busy blocks (FREE left out)', busy.length === 2 && busy.some((e) => e.top === 14 * 60) && busy.some((e) => e.top === 15 * 60 + 30), busy)
    await h.assert('B: the tentative free/busy period is tentative', busy.some((e) => /Tentative/.test(e.title ?? '')), busy.map((e) => e.title))
    if (zone) {
      await h.assert('B: a Windows zone name without VTIMEZONE lands at its real time', titleOf('CALS Windows zone')?.top === 17 * 60, titleOf('CALS Windows zone'))
    } else {
      await h.skip('B: Windows zone', 'no Windows zone in the table matches this machine\'s offset')
    }
    await h.capture('plan-links')

    // --- C. F5 reads again; the ETag link answers 304 ------------------------------------------
    log.length = 0
    await page.keyboard.press('F5')
    await h.wait(2500)
    const etagRequests = log.filter((r) => r.name === 'etag')
    await h.assert('C: a manual refresh asks the ETag link with If-None-Match', etagRequests.length >= 1 && etagRequests.every((r) => r.inm === '"cals-v1"'), log)
    events = await eventTitles()
    await h.assert('C: after the 304 the events are still there', events.some((e) => e.text.includes('CALS Link review')))

    // --- D. A failing link keeps its last copy -------------------------------------------------
    flakyFails = true
    await page.keyboard.press('F5')
    await h.wait(2500)
    await scrollTo(6)
    await h.wait(300)
    events = await eventTitles()
    await h.assert('D: the failing link keeps its last copy on screen', events.some((e) => e.text.includes('CALS Flaky feed')), events.map((e) => e.text))
    await openCalendarsSettings()
    const flakyStatus = await page.locator('[data-calendar-feed]', { hasText: 'Flaky feed' }).locator('[data-calendar-status]').innerText()
    await h.assert('D: it says when it was last read and why', /^Not updated since .+ The server had a problem \(500\)/.test(flakyStatus), flakyStatus)
    await h.capture('settings-links')

    // --- E. A CalDAV account against Radicale --------------------------------------------------
    await page.locator('[data-calendar-open-add]').click()
    await page.locator('[data-calendar-dialog]').waitFor()
    await page.locator('[data-calendar-choice="kind:account"]').click()
    await page.locator('[data-calendar-choice="preset:other"]').click()
    await page.locator('[data-caldav-server]').click()
    await h.type(radicale.url.replace(/\/$/, ''), { delay: 2 })
    await page.locator('[data-caldav-user]').click()
    await h.type(radicale.username)
    await page.locator('[data-caldav-password]').click()
    await h.type('not-the-password', { delay: 2 })
    await page.locator('[data-caldav-sign-in]').click()
    await page.locator('[data-caldav-error]').waitFor({ timeout: 15000 })
    const wrong = await page.locator('[data-caldav-error]').innerText()
    await h.assert('E: a wrong password is said plainly', wrong === 'Wrong user name or app password.', wrong)
    await h.capture('dialog-caldav-wrong')
    await page.locator('[data-caldav-password]').fill('')
    await page.locator('[data-caldav-password]').click()
    await h.type(radicaleCredentials().password, { delay: 2 })
    await page.locator('[data-caldav-sign-in]').click()
    await page.locator('[data-calendar-found]').waitFor({ timeout: 15000 })
    const found = await page.locator('[data-calendar-found] li').allInnerTexts()
    await h.assert('E: only calendars with events are offered', found.length === 2 && found.includes('Work') && found.includes('Personal'), found)
    await h.capture('dialog-caldav-pick')
    await h.axe('[data-calendar-dialog]', { label: 'caldav pick' })
    await page.locator('[data-calendar-account-save]').click()
    await page.locator('[data-calendar-dialog]').waitFor({ state: 'detached', timeout: 15000 })
    await h.assert('E: the account is listed with its calendars', (await page.locator('[data-calendar-connection] [data-calendar-feed]').count()) === 2)

    await openTomorrow()
    await scrollTo(8)
    await h.wait(800)
    events = await eventTitles()
    const caldav = events.filter((e) => e.text.includes('CALS ') && !e.text.includes('Link') && !e.text.includes('Gym') && !e.text.includes('Windows') && !e.text.includes('Flaky'))
    await h.assert('E: the moved standup occurrence is at 10:00', caldav.some((e) => e.text.includes('CALS Standup (moved)') && e.top === 600), caldav)
    await h.assert('E: the other events of both calendars are drawn', ['CALS Planning', 'CALS Dentist', 'CALS Lunch'].every((t) => caldav.some((e) => e.text.includes(t))), caldav.map((e) => e.text))
    if (radicale.zoned) await h.assert('E: the Windows-zoned CalDAV event is at 16:00', caldav.some((e) => e.text.includes('CALS Zoned call') && e.top === 960), caldav)
    await h.capture('plan-caldav')
    // The day after tomorrow's standup is skipped (EXDATE).
    await page.locator('[data-plan-next]').click()
    await h.wait(1000)
    events = await eventTitles()
    await h.assert('E: a removed occurrence is not drawn', !events.some((e) => e.text.includes('CALS Standup')), events.map((e) => e.text))

    // --- F. Rename, colour, Busy only ------------------------------------------------------------
    await openCalendarsSettings()
    const work = page.locator('[data-calendar-connection] [data-calendar-feed]', { hasText: 'Work' })
    await work.locator('[data-calendar-options]').click()
    await work.locator('[data-calendar-rename]').fill('Work (Radicale)')
    await work.locator('[data-calendar-rename]').press('Enter')
    await h.wait(400)
    const renamed = page.locator('[data-calendar-connection] [data-calendar-feed]', { hasText: 'Work (Radicale)' })
    await renamed.locator('[data-calendar-color="#e5484d"]').click()
    await renamed.locator('[data-calendar-busy-toggle]').click()
    await h.wait(600)
    await h.capture('settings-caldav-options')
    await h.axe('[data-calendar-feeds]', { label: 'calendars list' })
    const view = await page.evaluate(() => window.api.calendar.list())
    const workFeed = view.connections.flatMap((c) => c.calendars).find((c) => c.name === 'Work (Radicale)')
    await h.assert('F: rename and colour are kept', workFeed?.color === '#e5484d' && workFeed.busyOnly === true, workFeed)

    await openTomorrow()
    await scrollTo(8)
    await h.wait(800)
    events = await eventTitles()
    await h.assert('F: Busy only hides the Work titles', !events.some((e) => /CALS (Standup|Planning|Zoned)/.test(e.text)) && events.some((e) => e.text.includes('CALS Dentist')), events.map((e) => e.text))
    await h.capture('plan-busy-only')

    const store = readFileSync(join(userData, 'calendar-feeds.json'), 'utf8')
    await h.assert('F: calendar-feeds.json holds no link or password', !store.includes('secret-cals') && !store.includes(radicaleCredentials().password) && !store.includes('127.0.0.1'))
    const cacheDir = join(userData, 'calendar-cache')
    const cached = existsSync(cacheDir) ? readdirSync(cacheDir).map((f) => readFileSync(join(cacheDir, f), 'utf8')).join('\n') : ''
    await h.assert('F: the copies on disk are encrypted (no title in clear)', cached.length > 0 && !cached.includes('CALS') && !cached.includes('BEGIN:VCALENDAR'), { files: existsSync(cacheDir) ? readdirSync(cacheDir).length : 0 })

    // --- G. The gear's summary and Manage --------------------------------------------------------
    await page.locator('[data-plan-gear]').click()
    await page.locator('[data-calendar-summary]').waitFor()
    await h.capture('gear-summary')
    await page.locator('[data-calendar-manage]').click()
    await page.locator('[data-calendar-feeds]').waitFor({ timeout: 10000 })
    await h.wait(500)
    const inView = await page.evaluate(() => {
      const box = document.querySelector('[data-calendar-feeds]')?.getBoundingClientRect()
      return box ? box.top >= 0 && box.top < window.innerHeight : false
    })
    await h.assert('G: Manage opens Settings at the calendars', inView)
    await h.assert('G: only the settings column scrolled, not the window', await page.evaluate(() =>
      document.scrollingElement.scrollTop === 0 &&
      [...document.querySelectorAll('*')].every((el) => el.scrollTop === 0 || !['hidden', 'clip', 'visible'].includes(getComputedStyle(el).overflowY))))
    await h.capture('settings-managed')
  } finally {
    await page.evaluate(async () => {
      const view = await window.api.calendar.list()
      for (const connection of view.connections) await window.api.calendar.remove(connection.id)
      await window.api.saveConfigPatch({ planner_enabled: false, planner_view: 'day', planner_source: 'day' })
    }).catch(() => {})
    server.close()
  }
}
