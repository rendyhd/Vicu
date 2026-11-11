// EVT (calendar plan, phase 1; contract 20.6 and 20.7): your own Events on the Plan screen.
//
//   A. Draw a stretch, pick Event and Every day: one synced preference, daily at that time.
//   B. Move tomorrow's occurrence by dragging it: the question asks which times; This time only
//      skips that day and makes a new Event that does not repeat.
//   C. Drag the bottom edge of the next day's: All times changes the length of the series.
//   D. The popover: This and following, a new length: the series ends the day before, a new one
//      starts there; the popover follows it.
//   E. Ends on: On a date, then a date typed in the field.
//   F. New event from the palette with quick-add text ("every Tue 10:00 for 30m"), and Ctrl+Shift+N.
//   G. Keyboard: Alt+Shift+Down moves an Event that does not repeat at once; a repeating one asks,
//      Escape leaves it, All times moves the series.
//   H. Plan my day: the meter's free time counts a busy Event (and not once it does not count).
//   I. axe on the Plan screen and on the open popover; forced colours.
//
// Only its own Events (titles start with "EVT "); every synced key it adds is removed at the end.

export const meta = {
  id: 'EVT',
  wave: 6,
  title: 'Events on the Plan screen: draw, move, resize, which times, ends on, new event, Plan my day',
}

const pad = (n) => String(n).padStart(2, '0')
const dayFrom = (days) => {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const PREFIX = 'EVT '

/** "9h 30m free" in minutes. */
const freeOf = (text) => {
  const match = /([\d]+h)?\s*([\d]+m)?\s*free/.exec(text ?? '')
  if (!match) return null
  return (match[1] ? parseInt(match[1], 10) * 60 : 0) + (match[2] ? parseInt(match[2], 10) : 0)
}

export default async function run(h) {
  const page = h.page
  await h.resize(1400, 900)
  await h.dismiss()

  const stored = () =>
    page.evaluate(async () => {
      const { values } = await window.api.getSyncedPrefs()
      return Object.fromEntries(Object.entries(values).filter(([key, value]) => key.startsWith('event.') && value !== null))
    })
  /** This run's Events: id to value. */
  const mine = async () =>
    Object.fromEntries(Object.entries(await stored()).filter(([, value]) => typeof value?.title === 'string' && value.title.startsWith(PREFIX)))
  const byTitle = async (title) => Object.entries(await mine()).filter(([, value]) => value.title === title)
  const waitUntil = async (check, ms = 4000) => {
    for (let waited = 0; waited < ms; waited += 150) {
      if (await check()) return true
      await h.wait(150)
    }
    return check()
  }

  // A run that was cut off leaves its Events behind; they would be on this run's days.
  const stale = Object.keys(await mine())
  if (stale.length) await page.evaluate((keys) => window.api.setSyncedPreferences(Object.fromEntries(keys.map((key) => [key, null]))), stale)

  const today = dayFrom(0)
  const d1 = dayFrom(1)
  const d2 = dayFrom(2)
  const d3 = dayFrom(3)
  const d5 = dayFrom(5)

  /** Scrolls so `minute` of the day shows and gives the point at that minute in the day's column. */
  const spot = (day, minute) =>
    page.evaluate(
      ({ day, minute }) => {
        const scroller = document.querySelector('[data-plan-scroller]')
        const column = document.querySelector(`[data-plan-column="${day}"]`)
        scroller.scrollTop = Math.max(0, minute - 200)
        const box = column.getBoundingClientRect()
        const top = document.querySelector('[data-plan-grid]').getBoundingClientRect().top
        return { x: box.left + box.width / 2, y: top + minute }
      },
      { day, minute },
    )
  const eventIn = (day, title) => page.locator(`[data-plan-column="${day}"] [data-plan-event]`, { hasText: title })
  const showDay = async (day) => {
    // Day view, starting from today, forward to `day`.
    await page.locator('[data-plan-today]').click()
    await h.wait(400)
    for (let d = today; d < day; ) {
      await page.locator('[data-plan-next]').click()
      await h.wait(350)
      const next = new Date(`${d}T12:00:00`)
      next.setDate(next.getDate() + 1)
      d = `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}`
    }
    await h.wait(400)
  }
  const menuItem = (name) => page.getByRole('menuitem', { name })
  const openPlanMyDayTomorrow = async () => {
    await page.locator('[data-plan-my-day]').click()
    await h.wait(600)
    await page.locator('[data-plan-target="tomorrow"]').click()
    await h.wait(400)
    await page.locator('[data-plan-next-step]').click()
    await page.locator('[data-plan-meter]').waitFor({ timeout: 8000 })
    await h.wait(1200)
    return page.locator('[data-plan-meter] p').first().innerText()
  }

  try {
    await page.evaluate(() => window.api.saveConfigPatch({ planner_enabled: true, planner_view: 'day', planner_source: 'day' }))
    await page.reload()
    await h.wait(1200)
    await h.goto('/plan')
    await page.locator('[data-plan-totals]').waitFor({ timeout: 10000 })
    await h.wait(500)

    // --- A. Draw an Event that repeats ----------------------------------------------------------
    const a = await spot(today, 10 * 60)
    await page.mouse.move(a.x, a.y + 1)
    await page.mouse.down()
    await page.mouse.move(a.x, a.y + 8, { steps: 2 })
    await page.mouse.move(a.x, a.y + 29, { steps: 8 })
    await page.mouse.up()
    await h.wait(400)
    await page.locator('[data-plan-draw-kind="event"]').click()
    await h.type(`${PREFIX}Standup`)
    await page.selectOption('[data-plan-draw-repeat]', { label: 'Every day' })
    await h.capture('a-draw-event')
    await page.locator('[data-plan-draw-title] input').click()
    await h.key('Enter')
    await waitUntil(async () => (await byTitle(`${PREFIX}Standup`)).length === 1)
    const [[standupKey, standup]] = await byTitle(`${PREFIX}Standup`)
    await h.assert('A: the drawn Event is one synced preference, daily at 10:00 for 30m', standup.repeat?.kind === 'daily' && standup.time === '10:00' && standup.minutes === 30 && standup.start === today, standup)
    await h.assert('A: it is drawn on today, movable', (await eventIn(today, 'EVT Standup').getAttribute('data-plan-event-editable')) === 'true')

    // --- B. Drag tomorrow's occurrence: This time only -------------------------------------------
    await showDay(d1)
    await spot(d1, 10 * 60)
    const b = await eventIn(d1, 'EVT Standup').boundingBox()
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await page.mouse.down()
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 + 6, { steps: 2 })
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 + 60, { steps: 10 })
    await h.wait(150)
    await h.assert('B: a preview shows where it goes while it moves', (await page.locator('[data-plan-preview]').count()) === 1)
    await page.mouse.up()
    await menuItem('This time only').waitFor({ timeout: 4000 })
    await h.assert('B: letting go asks which times, the move waiting dashed', (await page.locator('[data-plan-event-pending]').count()) === 1)
    await h.capture('b-which-times')
    await menuItem('This time only').click()
    await waitUntil(async () => (await byTitle(`${PREFIX}Standup`)).length === 2)
    {
      const all = await byTitle(`${PREFIX}Standup`)
      const series = all.find(([key]) => key === standupKey)?.[1]
      const single = all.find(([key]) => key !== standupKey)?.[1]
      await h.assert('B: This time only skips that day of the series', JSON.stringify(series?.skips) === JSON.stringify([d1]) && series?.time === '10:00', series)
      await h.assert('B: and makes a new Event on that day at 11:00 that does not repeat', single?.start === d1 && single?.time === '11:00' && single?.minutes === 30 && single?.repeat === undefined, single)
    }
    await h.wait(400)
    await spot(d1, 10 * 60)
    await h.capture('b-moved-this-time')

    // --- C. Resize the next day's: All times -----------------------------------------------------
    await showDay(d2)
    await spot(d2, 10 * 60)
    const c = await eventIn(d2, 'EVT Standup').boundingBox()
    await page.mouse.move(c.x + c.width / 2, c.y + c.height - 2)
    await page.mouse.down()
    await page.mouse.move(c.x + c.width / 2, c.y + c.height + 4, { steps: 2 })
    await page.mouse.move(c.x + c.width / 2, c.y + c.height + 14, { steps: 6 })
    await page.mouse.up()
    await menuItem('All times').waitFor({ timeout: 4000 })
    await menuItem('All times').click()
    await waitUntil(async () => (await stored())[standupKey]?.minutes === 45)
    {
      const all = await byTitle(`${PREFIX}Standup`)
      const series = all.find(([key]) => key === standupKey)?.[1]
      const single = all.find(([key]) => key !== standupKey)?.[1]
      await h.assert('C: All times gives the series 45 minutes', series?.minutes === 45 && series?.time === '10:00' && series?.start === today, series)
      await h.assert('C: the Event made for one day keeps its own length', single?.minutes === 30, single)
    }

    // Escape while the question waits leaves the Event as it was.
    await spot(d2, 10 * 60)
    const esc = await eventIn(d2, 'EVT Standup').boundingBox()
    await page.mouse.move(esc.x + esc.width / 2, esc.y + esc.height / 2)
    await page.mouse.down()
    await page.mouse.move(esc.x + esc.width / 2, esc.y + esc.height / 2 + 6, { steps: 2 })
    await page.mouse.move(esc.x + esc.width / 2, esc.y + esc.height / 2 + 90, { steps: 8 })
    await page.mouse.up()
    await menuItem('All times').waitFor({ timeout: 4000 })
    await h.key('Escape')
    await h.wait(500)
    await h.assert('C: Escape on the question changes nothing', (await stored())[standupKey]?.time === '10:00' && (await page.locator('[data-plan-event-pending]').count()) === 0)

    // --- D. The popover: This and following, a new length ----------------------------------------
    await showDay(d3)
    await spot(d3, 10 * 60)
    await eventIn(d3, 'EVT Standup').click()
    await page.locator('[data-plan-event-editor]').waitFor({ timeout: 4000 })
    await h.assert('D: a press without a drag opens the popover, which asks which times at its top', (await page.locator('[data-plan-event-scope]').count()) === 1)
    await page.locator('[data-plan-event-scope-option="following"]').click()
    await page.selectOption('[data-plan-event-length]', '60')
    await waitUntil(async () => (await byTitle(`${PREFIX}Standup`)).length === 3)
    let following
    {
      const all = await byTitle(`${PREFIX}Standup`)
      const series = all.find(([key]) => key === standupKey)?.[1]
      following = all.find(([, value]) => value.start === d3)
      await h.assert('D: This and following ends the series the day before', series?.until === d2 && series?.minutes === 45, series)
      await h.assert('D: and starts a new one that day with the new length', following?.[1].repeat?.kind === 'daily' && following?.[1].minutes === 60 && following?.[1].time === '10:00', following?.[1])
    }
    await h.wait(500)
    await h.assert('D: the popover stays open on the new series', (await page.locator(`[data-plan-event-editor="${following?.[0].slice('event.'.length)}"]`).count()) === 1)
    const gap = await page.evaluate((id) => {
      const popover = document.querySelector('[data-plan-event-editor]')?.closest('[popover]')?.getBoundingClientRect()
      const event = document.querySelector(`[data-plan-event="${id}"]`)?.getBoundingClientRect()
      if (!popover || !event) return null
      const dx = Math.max(0, event.left - popover.right, popover.left - event.right)
      const dy = Math.max(0, event.top - popover.bottom, popover.top - event.bottom)
      return Math.hypot(dx, dy)
    }, `vicu:events:${following?.[0].slice('event.'.length)}:${d3}`)
    await h.assert('D: and next to the event, not where the old one was', gap !== null && gap < 40, gap)
    await h.assert('D: the choice of times stays', (await page.locator('[data-plan-event-scope-option="following"]').getAttribute('aria-checked')) === 'true')

    // --- E. Ends on --------------------------------------------------------------------------------
    await page.locator('[data-plan-event-scope-option="all"]').click()
    await page.selectOption('[data-plan-event-ends]', 'date')
    await page.locator('[data-plan-event-until]').waitFor({ timeout: 4000 })
    await page.locator('[data-plan-event-until]').fill(d5)
    await page.locator('[data-plan-event-until]').press('Enter')
    await waitUntil(async () => (await stored())[following[0]]?.until === d5)
    await h.assert('E: Ends on writes the last day', (await stored())[following[0]]?.until === d5, (await stored())[following[0]])
    await h.capture('e-popover-ends-on')
    await h.axe('[data-plan-event-editor]', { label: 'event popover' })
    await h.key('Escape')
    await h.wait(300)
    await page.locator('[data-plan-view="week"]').click()
    await h.wait(800)
    await spot(d3, 10 * 60)
    await h.wait(300)
    await h.capture('e-week')
    await page.locator('[data-plan-view="day"]').click()
    await h.wait(500)

    // --- F. New event: the palette with quick-add text, and Ctrl+Shift+N --------------------------
    await page.locator('[data-plan-today]').click()
    await h.wait(400)
    await h.key('Control+Shift+P')
    await h.wait(300)
    await h.type('New event')
    await h.wait(200)
    await h.key('Enter')
    await page.locator('[data-plan-draw-title]').waitFor({ timeout: 4000 })
    await h.assert('F: the palette opens the title box as an Event', (await page.locator('[data-plan-draw-kind="event"]').getAttribute('aria-checked')) === 'true')
    await h.type(`${PREFIX}Manager call every Tue 10:00 for 30m`)
    await h.wait(300)
    await h.capture('f-quick-add')
    const repeatShown = await page.locator('[data-plan-draw-repeat] option:checked').innerText()
    await h.assert('F: the repeat list shows the repeat the text names', repeatShown === 'Every Tuesday', repeatShown)
    await h.key('Enter')
    await waitUntil(async () => (await byTitle(`${PREFIX}Manager call`)).length === 1)
    {
      const [[, call] = []] = await byTitle(`${PREFIX}Manager call`)
      const weekday = call ? new Date(`${call.start}T12:00:00`).getDay() : -1
      await h.assert('F: quick add sets the title, time, length and weekly repeat on a Tuesday', call?.time === '10:00' && call?.minutes === 30 && call?.repeat?.kind === 'weekly' && JSON.stringify(call?.repeat?.days) === '[2]' && weekday === 2, call)
    }

    await showDay(d1)
    await h.key('Control+Shift+N')
    await page.locator('[data-plan-draw-title]').waitFor({ timeout: 4000 })
    await h.assert('F: Ctrl+Shift+N opens the title box as an Event', (await page.locator('[data-plan-draw-kind="event"]').getAttribute('aria-checked')) === 'true')
    await h.type(`${PREFIX}Focus 14:00 for 1h`)
    await h.key('Enter')
    await waitUntil(async () => (await byTitle(`${PREFIX}Focus`)).length === 1)
    const [[focusKey, focus] = []] = await byTitle(`${PREFIX}Focus`)
    await h.assert('F: on the selected day, at the time and length typed', focus?.start === d1 && focus?.time === '14:00' && focus?.minutes === 60 && focus?.repeat === undefined, focus)

    // --- G. Keyboard ---------------------------------------------------------------------------------
    await spot(d1, 14 * 60)
    await eventIn(d1, 'EVT Focus').locator('[data-plan-focus]').focus()
    await h.key('Alt+Shift+ArrowDown')
    await waitUntil(async () => (await stored())[focusKey]?.time === '14:15')
    await h.assert('G: Alt+Shift+Down moves an Event that does not repeat at once', (await stored())[focusKey]?.time === '14:15', (await stored())[focusKey])
    await h.key('Shift+ArrowDown')
    await waitUntil(async () => (await stored())[focusKey]?.minutes === 75)
    await h.assert('G: Shift+Down makes it 15 minutes longer', (await stored())[focusKey]?.minutes === 75, (await stored())[focusKey])
    await h.assert('G: the focus stays on the event', await page.evaluate(() => !!document.activeElement?.closest('[data-plan-event]')))

    await showDay(d5)
    await spot(d5, 10 * 60)
    await eventIn(d5, 'EVT Standup').locator('[data-plan-focus]').focus()
    await h.key('Alt+Shift+ArrowDown')
    await menuItem('All times').waitFor({ timeout: 4000 })
    await h.capture('g-keyboard-question')
    await h.key('Escape')
    await h.wait(400)
    await h.assert('G: Escape on the question leaves it', (await stored())[following[0]]?.time === '10:00')
    await eventIn(d5, 'EVT Standup').locator('[data-plan-focus]').focus()
    await h.key('Alt+Shift+ArrowDown')
    await menuItem('All times').waitFor({ timeout: 4000 })
    await h.key('ArrowDown')
    await h.key('ArrowDown')
    await h.key('Enter')
    await waitUntil(async () => (await stored())[following[0]]?.time === '10:15')
    await h.assert('G: All times by keyboard moves the series 15 minutes', (await stored())[following[0]]?.time === '10:15', (await stored())[following[0]])

    // --- H. Plan my day counts a busy Event -----------------------------------------------------------
    await page.locator('[data-plan-today]').click()
    await h.wait(400)
    const single = (await byTitle(`${PREFIX}Standup`)).find(([, value]) => value.start === d1 && value.repeat === undefined)
    const busyMeter = await openPlanMyDayTomorrow()
    await h.capture('h-plan-my-day')
    await page.locator('[data-plan-exit]').click()
    await h.wait(500)
    // The same day with that Event and the focus block not counting as busy.
    await page.evaluate(
      async ({ keys }) => {
        const { values } = await window.api.getSyncedPrefs()
        await window.api.setSyncedPreferences(Object.fromEntries(keys.map((key) => [key, { ...values[key], busy: false }])))
      },
      { keys: [single[0], focusKey] },
    )
    await page.reload()
    await h.wait(1200)
    await h.goto('/plan')
    await page.locator('[data-plan-totals]').waitFor({ timeout: 10000 })
    const freeMeter = await openPlanMyDayTomorrow()
    await page.locator('[data-plan-exit]').click()
    await h.wait(300)
    const busyFree = freeOf(busyMeter)
    const plainFree = freeOf(freeMeter)
    // Tomorrow's Events in the work hours: the 11:00 one (30m) and the focus (75m); a block of a task
    // at the same time would count once, so at most that.
    await h.assert('H: the meter has less free time while the Events count as busy', busyFree !== null && plainFree !== null && plainFree - busyFree > 0 && plainFree - busyFree <= 105, { busyMeter, freeMeter, less: plainFree - busyFree })

    // --- I. axe on the Plan screen ----------------------------------------------------------------------
    await showDay(d1)
    await spot(d1, 10 * 60)
    await h.axe('[data-plan-screen]', { label: 'plan screen with events' })
    await h.capture('i-day-events')
    await h.setForcedColors(true)
    await h.wait(300)
    await h.capture('i-day-events-forced-colors')
    await h.setForcedColors(false)
  } finally {
    await h.dismiss().catch(() => {})
    await page
      .evaluate(async (prefix) => {
        // Only this run's Events: another run on the same account may have its own.
        const { values } = await window.api.getSyncedPrefs()
        const added = Object.keys(values).filter((key) => key.startsWith('event.') && String(values[key]?.title ?? '').startsWith(prefix))
        if (added.length) await window.api.setSyncedPreferences(Object.fromEntries(added.map((key) => [key, null])))
        await window.api.saveConfigPatch({ planner_enabled: false, planner_view: 'day', planner_source: 'day' })
      }, PREFIX)
      .catch(() => {})
  }
}
