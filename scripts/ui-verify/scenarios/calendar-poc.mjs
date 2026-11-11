// CAL (proof of concept, branch feat/calendar-poc): calendar events on the Plan screen.
//
//   A. A calendar is connected through the gear's form (real typing) from a secret ICS link,
//      served here on a local port: a weekday standup series, a meeting that overlaps a task block,
//      a free (transparent) lunch, a tentative 1:1, an event with a place, an all-day event.
//   B. Day view: events sit beside the blocks in shared columns, the all-day event in the top row,
//      and the free time counts the busy events (not the free or all-day ones).
//   C. 3 days and Week.
//   D. "Busy" only hides the titles. Removing the calendar removes its events.
//   E. Events typed by hand: draw a stretch, pick Event and a repeat; it repeats on the right days,
//      is a synced preference, opens in a popover, skips one day, is listed in the gear, deletes.
//
// Its own throwaway tasks; everything is put back at the end.

import { createServer } from 'node:http'

export const meta = {
  id: 'CAL',
  wave: 6,
  title: 'Calendar events on the Plan screen (proof of concept)',
}

const pad = (n) => String(n).padStart(2, '0')
const localDay = (offset) => {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return d
}
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
/** A floating iCalendar time: the reader's local time, like most "same zone" feeds. */
const floating = (offset, h, m) => {
  const d = localDay(offset)
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(h)}${pad(m)}00`
}
const dateValue = (offset) => ymd(localDay(offset)).replaceAll('-', '')
const at = (offset, h, m) => {
  const d = localDay(offset)
  d.setHours(h, m, 0, 0)
  return d.toISOString()
}
const dueOf = (offset) => {
  const d = localDay(offset)
  d.setHours(23, 59, 59, 0)
  return d.toISOString()
}

function demoFeed() {
  const event = (uid, lines) => ['BEGIN:VEVENT', `UID:${uid}@vicu-poc`, `DTSTAMP:${floating(0, 8, 0)}Z`, ...lines, 'END:VEVENT']
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Vicu//Calendar POC//EN',
    ...event('standup', ['SUMMARY:Standup', `DTSTART:${floating(-14, 9, 30)}`, `DTEND:${floating(-14, 9, 45)}`, 'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR']),
    ...event('review', ['SUMMARY:Design review', `DTSTART:${floating(0, 11, 0)}`, `DTEND:${floating(0, 12, 0)}`, 'LOCATION:Room 4']),
    ...event('lunch', ['SUMMARY:Lunch with Sam', 'TRANSP:TRANSPARENT', `DTSTART:${floating(0, 12, 30)}`, `DTEND:${floating(0, 13, 30)}`]),
    ...event('one-on-one', ['SUMMARY:1:1 with Alex', 'STATUS:TENTATIVE', `DTSTART:${floating(0, 15, 0)}`, `DTEND:${floating(0, 15, 30)}`]),
    ...event('dentist', ['SUMMARY:Dentist', 'LOCATION:Main Street 12', `DTSTART:${floating(1, 8, 30)}`, `DTEND:${floating(1, 9, 30)}`]),
    ...event('planning', ['SUMMARY:Sprint planning', `DTSTART:${floating(1, 13, 0)}`, `DTEND:${floating(1, 14, 30)}`]),
    ...event('holiday', ['SUMMARY:Team offsite', `DTSTART;VALUE=DATE:${dateValue(2)}`, `DTEND;VALUE=DATE:${dateValue(3)}`]),
    'END:VCALENDAR',
  ].join('\r\n')
}

export default async function run(h) {
  const page = h.page
  await h.resize(1400, 900)
  await h.dismiss()

  const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8' })
    res.end(demoFeed())
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const feedUrl = `http://127.0.0.1:${server.address().port}/secret-abc123/basic.ics`

  const created = []
  const makeTask = async (title, fields) => {
    const task = await h.api('POST', `/projects/${h.ids.inbox}/tasks`, { title, ...fields })
    created.push(task.id)
    return task
  }
  const scrollTo = (hour) =>
    page.evaluate((hour) => {
      const scroller = document.querySelector('[data-plan-scroller]')
      if (scroller) scroller.scrollTop = hour * 60 - 20
    }, hour)
  const totals = () => page.locator('[data-plan-totals]').innerText()
  /** Tomorrow's totals: today's work hours may be over when the run happens. */
  const tomorrowTotals = async () => {
    await page.locator('[data-plan-next]').click()
    await h.wait(900)
    const text = await totals()
    await page.locator('[data-plan-today]').click()
    await h.wait(500)
    return text
  }

  try {
    await page.evaluate(() => window.api.saveConfigPatch({ planner_enabled: true, planner_view: 'day', planner_source: 'day' }))
    await makeTask('CAL Draft the proposal', { due_date: dueOf(0), start_date: at(0, 10, 30), end_date: at(0, 11, 30) })
    await makeTask('CAL Inbox zero', { due_date: dueOf(0), start_date: at(0, 14, 0), end_date: at(0, 14, 45) })
    await page.reload()
    await h.wait(1200)
    await h.goto('/plan')
    await page.locator('[data-plan-totals]').waitFor({ timeout: 10000 })
    await h.wait(500)
    const freeBefore = await tomorrowTotals()

    // --- A. Connect a calendar through the form --------------------------------------------------
    await page.locator('[data-plan-gear]').click()
    await h.wait(300)
    await page.locator('[data-calendar-name]').click()
    await h.type('Work')
    await page.locator('[data-calendar-url]').click()
    await h.type(feedUrl, { delay: 2 })
    await h.capture('gear-form')
    await page.locator('[data-calendar-add]').click()
    await page.locator('[data-calendar-feed]').first().waitFor({ timeout: 10000 })
    await h.assert('A: the calendar is listed', (await page.locator('[data-calendar-feed]').count()) === 1)
    await h.capture('gear-connected')
    await h.key('Escape')
    await h.wait(800)

    // --- B. Day view -------------------------------------------------------------------------------
    await scrollTo(8)
    await h.wait(300)
    const titles = await page.locator('[data-plan-event]').evaluateAll((nodes) => nodes.map((node) => node.textContent))
    await h.assert('B: today\'s events are drawn', ['Standup', 'Design review', 'Lunch with Sam', '1:1 with Alex'].every((t) => titles.some((x) => x.includes(t))), titles)
    const overlap = await page.evaluate(() => {
      const review = [...document.querySelectorAll('[data-plan-event]')].find((n) => n.textContent.includes('Design review'))
      const block = [...document.querySelectorAll('[data-plan-block]')].find((n) => n.textContent.includes('CAL Draft the proposal'))
      if (!review || !block) return null
      const a = review.getBoundingClientRect()
      const b = block.getBoundingClientRect()
      return { sideBySide: a.right <= b.left + 1 || b.right <= a.left + 1 }
    })
    await h.assert('B: the meeting and the overlapping block sit side by side', overlap?.sideBySide === true, overlap)
    await h.capture('day')
    const freeAfter = await tomorrowTotals()
    await scrollTo(8)
    await h.assert('B: free time tomorrow drops by the busy events', freeBefore !== freeAfter, { freeBefore, freeAfter })

    // --- C. 3 days and Week ------------------------------------------------------------------------
    await page.locator('[data-plan-view="3days"]').click()
    await h.wait(700)
    await scrollTo(8)
    await h.wait(300)
    await h.assert('C: the all-day event is in its day\'s top row', (await page.locator('[data-plan-allday-event]').count()) >= 1)
    await h.capture('three-days')
    await page.locator('[data-plan-view="week"]').click()
    await h.wait(700)
    await scrollTo(8)
    await h.wait(300)
    await h.capture('week')

    // --- D. Busy only, then remove -----------------------------------------------------------------
    await page.locator('[data-plan-view="day"]').click()
    await h.wait(500)
    await page.locator('[data-plan-gear]').click()
    await h.wait(300)
    await page.locator('[data-calendar-feed] label', { hasText: 'not titles' }).click()
    await h.key('Escape')
    await h.wait(800)
    await scrollTo(8)
    await h.wait(300)
    const busyTitles = await page.locator('[data-plan-event]').evaluateAll((nodes) => nodes.map((node) => node.textContent))
    await h.assert('D: busy only shows no titles', busyTitles.length > 0 && busyTitles.every((t) => /^(Busy|Free)/.test(t) && !t.includes('Design')) && busyTitles.some((t) => t.startsWith('Free')), busyTitles)
    await h.capture('day-busy-only')
    await page.locator('[data-plan-gear]').click()
    await h.wait(300)
    await page.locator('[data-calendar-feed] button[aria-label^="Remove"]').click()
    await h.key('Escape')
    await h.wait(800)
    await h.assert('D: removing the calendar removes its events', (await page.locator('[data-plan-event]').count()) === 0)

    // --- E. Events typed by hand ---------------------------------------------------------------------
    const today = ymd(localDay(0))
    const spot = (day, minute) =>
      page.evaluate(({ day, minute }) => {
        const scroller = document.querySelector('[data-plan-scroller]')
        const column = document.querySelector(`[data-plan-column="${day}"]`)
        scroller.scrollTop = Math.max(0, minute - 200)
        const box = column.getBoundingClientRect()
        const top = document.querySelector('[data-plan-grid]').getBoundingClientRect().top
        return { x: box.left + box.width / 2, y: top + minute }
      }, { day, minute })
    const draw = async (fromMinute, toMinute, title, repeatIndex) => {
      const a = await spot(today, fromMinute)
      await page.mouse.move(a.x, a.y)
      await page.mouse.down()
      await page.mouse.move(a.x, a.y + 6, { steps: 2 })
      await page.mouse.move(a.x, a.y + (toMinute - fromMinute) - 1, { steps: 8 })
      await page.mouse.up()
      await h.wait(400)
      await page.locator('[data-plan-draw-kind="event"]').click()
      await h.type(title)
      await page.selectOption('[data-plan-draw-repeat]', { index: repeatIndex })
      if (title === 'Manager call') await h.capture('draw-event')
      await page.locator('[data-plan-draw-title] input').click()
      await h.key('Enter')
      await h.wait(800)
    }
    const named = (title) => page.locator('[data-plan-event]', { hasText: title })

    await draw(16 * 60, 16 * 60 + 30, 'Manager call', 3)
    await h.assert('E: the drawn Event is on today', (await named('Manager call').count()) === 1)
    const stored = await page.evaluate(async () => {
      const { values } = await window.api.getSyncedPrefs()
      return Object.entries(values).filter(([key]) => key.startsWith('event.')).map(([, value]) => value)
    })
    await h.assert('E: it is a synced preference, weekly on that day', stored.length === 1 && stored[0].repeat.kind === 'weekly' && stored[0].time === '16:00', stored)
    await draw(17 * 60, 17 * 60 + 15, 'Team sync', 2)

    await page.locator('[data-plan-view="week"]').click()
    await h.wait(700)
    await page.locator('[data-plan-next]').click()
    await h.wait(700)
    await scrollTo(9)
    await h.wait(300)
    await h.assert('E: next week has the weekly one once and the weekday one five times', (await named('Manager call').count()) === 1 && (await named('Team sync').count()) === 5, {
      manager: await named('Manager call').count(),
      sync: await named('Team sync').count(),
    })
    await scrollTo(14)
    await h.wait(300)
    await h.capture('week-events')
    await page.locator('[data-plan-view="day"]').click()
    await h.wait(400)
    await page.locator('[data-plan-today]').click()
    await h.wait(700)

    await spot(today, 17 * 60)
    await named('Team sync').click()
    await h.wait(400)
    await h.assert('E: a press opens the Event to change it', (await page.locator('[data-plan-event-editor]').count()) === 1)
    await h.capture('event-popover')
    await page.locator('[data-plan-event-skip]').click()
    await h.wait(800)
    await h.assert('E: Skip this one leaves today out', (await named('Team sync').count()) === 0)

    await page.locator('[data-plan-gear]').click()
    await h.wait(300)
    await page.locator('[data-plan-my-events]').scrollIntoViewIfNeeded()
    await h.assert('E: the gear lists both Events', (await page.locator('[data-plan-my-event]').count()) === 2)
    await h.capture('gear-events')
    await h.key('Escape')
    await h.wait(400)

    await spot(today, 16 * 60)
    await named('Manager call').click()
    await h.wait(400)
    await page.locator('[data-plan-event-delete]').click()
    await h.wait(800)
    await h.assert('E: Delete event removes it', (await named('Manager call').count()) === 0)
  } finally {
    await page.evaluate(async () => {
      const { values } = await window.api.getSyncedPrefs()
      const gone = Object.fromEntries(Object.keys(values).filter((key) => key.startsWith('event.')).map((key) => [key, null]))
      if (Object.keys(gone).length) await window.api.setSyncedPreferences(gone)
    }).catch(() => {})
    await page.evaluate(async () => {
      for (const feed of await window.api.calendar.list()) await window.api.calendar.remove(feed.id)
      await window.api.saveConfigPatch({ planner_enabled: false, planner_view: 'day', planner_source: 'day' })
    }).catch(() => {})
    for (const id of created) await h.api('DELETE', `/tasks/${id}`).catch(() => {})
    server.close()
  }
}
