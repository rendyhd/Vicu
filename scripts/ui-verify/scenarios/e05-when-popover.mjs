// E5 (cards 3.4a1 and 3.4a2, the When panel): the Schedule popover reads typed text, follows the grid,
// keeps its focus order and sends the right due date; the reminder picker uses the same panel.
//
//   A. "tomorrow 9am" selects tomorrow at 09:00 (grid, time chip, preview); Enter saves it.
//   B. "next mon" is the coming Monday, date-only (local 23:59:59).
//   C. A click on day 20 updates the text and saves; the popover stays open.
//   D. "Next week" (quick choice) saves the coming Monday and closes.
//   E. Keyboard on the grid: arrows, End, PageDown, Enter.
//   F. Clear sends the null date.
//   G. Reminders: a quick choice adds a reminder at once; a day in the grid plus "Add reminder" is two clicks.
//
// Everything runs on one throwaway task in the Inbox, deleted at the end. Dates are computed from the
// run day; what was really saved is read back from the server.
import { comingWeekday, localDate } from '../lib.mjs'

export const meta = {
  id: 'E5',
  wave: 3,
  title: 'When popover: "tomorrow 9am", day 20, "Next week"; Clear; keyboard grid; reminders in two clicks',
}

const POP = '[popover][aria-label="Schedule"]:popover-open'
const REMINDER_POP = '[popover][aria-label="Reminders"]:popover-open'
const NULL_PREFIX = '0001-01-01'

const pad = (n) => String(n).padStart(2, '0')
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** The local wall-clock pieces of a stored instant. */
function parts(iso) {
  const d = new Date(iso)
  return { date: ymd(d), time: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` }
}

export default async function run(h) {
  const page = h.page
  await h.resize(1280, 820)
  await h.dismiss()

  const today = new Date()
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)
  const monday = comingWeekday(1)

  const made = await h.api('POST', `/projects/${h.ids.inbox}/tasks`, { title: 'E5 throwaway: when popover' })
  const id = made.id
  try {
    const dueOnServer = async () => (await h.api('GET', `/tasks/${id}`)).due_date
    /** Waits (up to 4 s) until the saved due date satisfies `ok`; returns it. */
    const savedDue = async (ok) => {
      let due = await dueOnServer()
      for (let i = 0; i < 16 && !ok(due); i++) {
        await h.wait(250)
        due = await dueOnServer()
      }
      return due
    }
    const isNull = (due) => !due || due.startsWith(NULL_PREFIX)

    await h.goto('/inbox')
    const row = page.locator(`[data-task-id="${id}"]`)
    await row.scrollIntoViewIfNeeded()
    await row.click({ position: { x: 180, y: 12 } })
    await h.wait(700)
    const trigger = row.locator('button[data-prop="schedule"]').first()
    const popover = page.locator(POP)
    const input = popover.getByLabel('Date and time')

    const open = async () => {
      if ((await popover.count()) === 0) {
        await trigger.click()
        await h.wait(450)
      }
    }
    const closeIt = async () => {
      if ((await popover.count()) > 0) {
        await h.key('Escape')
        await h.wait(350)
      }
    }
    const selectedDay = () => popover.locator('[role="gridcell"][aria-selected="true"] button').first().getAttribute('data-date')
    const pressedTime = async () => {
      const pressed = popover.locator('[role="group"][aria-label="Time"] button[aria-pressed="true"]')
      return (await pressed.count()) === 1 ? (await pressed.first().innerText()).trim() : null
    }
    /** Types into the text field like a user: focus, select all, type. */
    const typeText = async (text) => {
      await input.click()
      await h.key('Control+A')
      await h.type(text, { delay: 20 })
      await h.wait(250)
    }

    // ---- structure -------------------------------------------------------------------------
    await open()
    await h.capture('empty')
    await h.assert('the Schedule popover opens with a text field that has focus', async () => {
      const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))
      return { ok: (await popover.count()) === 1 && focused === 'Date and time', detail: focused }
    })
    await h.assert('the text field says what to type', async () => (await input.getAttribute('placeholder')) === 'Type a day, a date or a time')
    await h.assert('four quick choices with weekdays', async () => {
      const labels = await popover.locator('[role="group"][aria-label="Quick choices"] button').allInnerTexts()
      const norm = labels.map((t) => t.replace(/\s+/g, ' ').trim())
      return {
        ok: norm.length === 4 && /^Today /.test(norm[0]) && /^Tomorrow /.test(norm[1]) && /^This weekend Sat/.test(norm[2]) && /^Next week Mon \d+/.test(norm[3]),
        detail: norm.join(' | '),
      }
    })
    await h.assert('the month grid is a grid with today marked', async () => {
      const grid = popover.locator('[role="grid"]')
      const todayCell = popover.locator('button[aria-current="date"]')
      return { ok: (await grid.count()) === 1 && (await todayCell.count()) === 1 && (await todayCell.getAttribute('data-date')) === localDate(0), detail: await todayCell.getAttribute('data-date') }
    })
    await h.assert('the time row offers None, four times and a custom field', async () => {
      const chips = await popover.locator('[role="group"][aria-label="Time"] button').count()
      const custom = await popover.getByLabel('Custom time').count()
      return { ok: chips === 5 && custom === 1, detail: `${chips} chips, ${custom} custom` }
    })

    // ---- A. "tomorrow 9am" -------------------------------------------------------------------
    await typeText('tomorrow 9am')
    await h.capture('typed-tomorrow-9am')
    await h.assert('"tomorrow 9am" selects tomorrow in the grid', async () => {
      const day = await selectedDay()
      return { ok: day === ymd(tomorrow), detail: `${day} vs ${ymd(tomorrow)}` }
    })
    await h.assert('"tomorrow 9am" presses the 09:00 chip', async () => {
      const chip = await pressedTime()
      return { ok: /^(09:00|9:00 AM)$/i.test(chip ?? ''), detail: chip }
    })
    await h.assert('the preview names the result and says Enter sets it', async () => {
      const text = (await popover.getByTestId('when-preview').innerText()).trim()
      return { ok: /Enter to set/.test(text) && /\b9:00|09:00/.test(text), detail: text }
    })
    await h.assert('nothing is saved before Enter', async () => isNull(await dueOnServer()))
    await h.key('Enter')
    await h.wait(500)
    await h.assert('Enter closes the popover', async () => (await popover.count()) === 0)
    await h.assert('tomorrow 09:00 is saved', async () => {
      const got = parts(await savedDue((d) => !isNull(d)))
      return { ok: got.date === ymd(tomorrow) && got.time === '09:00:00', detail: `${got.date} ${got.time}` }
    })

    // ---- B. "next mon" -----------------------------------------------------------------------
    await open()
    await h.assert('reopened, the panel shows the saved day and time', async () => {
      const day = await selectedDay()
      const chip = await pressedTime()
      return { ok: day === ymd(tomorrow) && /^(09:00|9:00 AM)$/i.test(chip ?? ''), detail: `${day} ${chip}` }
    })
    await typeText('next mon')
    await h.assert('"next mon" selects the coming Monday with no time', async () => {
      const day = await selectedDay()
      const chip = await pressedTime()
      return { ok: day === ymd(monday) && chip === 'None', detail: `${day} ${chip} vs ${ymd(monday)}` }
    })
    await h.key('Enter')
    await h.wait(500)
    await h.assert('the coming Monday is saved as a date-only due date (local 23:59:59)', async () => {
      const got = parts(await savedDue((d) => parts(d).date === ymd(monday)))
      return { ok: got.date === ymd(monday) && got.time === '23:59:59', detail: `${got.date} ${got.time}` }
    })

    // ---- C. a click on day 20 ------------------------------------------------------------------
    await open()
    const month = (await selectedDay()).slice(0, 7)
    const day20 = popover.locator(`button[data-date="${month}-20"]`)
    await day20.click()
    await h.wait(400)
    await h.capture('day-20')
    await h.assert('a click on day 20 updates the text', async () => {
      const value = await input.inputValue()
      return { ok: /\b20\b/.test(value), detail: value }
    })
    await h.assert('day 20 is selected and the popover stays open', async () => ({
      ok: (await selectedDay()) === `${month}-20` && (await popover.count()) === 1,
      detail: await selectedDay(),
    }))
    await h.assert('day 20 is saved date-only', async () => {
      const got = parts(await savedDue((d) => parts(d).date === `${month}-20`))
      return { ok: got.date === `${month}-20` && got.time === '23:59:59', detail: `${got.date} ${got.time}` }
    })
    // A time chip on top of the picked day.
    await popover.locator('[role="group"][aria-label="Time"] button', { hasText: /^(15:00|3:00 PM)$/ }).click()
    await h.wait(400)
    await h.assert('a time chip keeps the day and saves its time', async () => {
      const got = parts(await savedDue((d) => parts(d).time === '15:00:00'))
      return { ok: got.date === `${month}-20` && got.time === '15:00:00', detail: `${got.date} ${got.time}` }
    })
    await h.assert('the text follows the time', async () => /3:00 PM|15:00/.test(await input.inputValue()))

    // ---- E. keyboard on the grid ---------------------------------------------------------------
    await popover.locator(`button[data-date="${month}-20"]`).focus()
    const focusedDate = () => page.evaluate(() => document.activeElement?.getAttribute('data-date') ?? null)
    await h.key('ArrowRight')
    await h.wait(100)
    await h.assert('ArrowRight moves to the next day', async () => (await focusedDate()) === `${month}-21`)
    await h.key('ArrowDown')
    await h.wait(100)
    await h.assert('ArrowDown moves a week', async () => (await focusedDate()) === `${month}-28`)
    await h.key('End')
    await h.wait(100)
    const endOfWeek = await focusedDate()
    await h.assert('End moves to the Sunday of that week', async () => ({ ok: !!endOfWeek && new Date(`${endOfWeek}T12:00:00`).getDay() === 0, detail: endOfWeek }))
    await h.key('Home')
    await h.wait(100)
    const startOfWeek = await focusedDate()
    await h.assert('Home moves to the Monday of that week', async () => ({ ok: !!startOfWeek && new Date(`${startOfWeek}T12:00:00`).getDay() === 1, detail: startOfWeek }))
    await h.key('PageDown')
    await h.wait(150)
    await h.assert('PageDown moves a month and the grid follows', async () => {
      const f = await focusedDate()
      const title = await popover.locator('[role="grid"]').getAttribute('aria-label')
      return { ok: !!f && f.slice(0, 7) !== month && (await popover.locator(`button[data-date="${f}"]`).count()) === 1, detail: `${f} ${title}` }
    })
    await h.assert('the focused day shows a focus ring', async () => {
      const ring = await page.evaluate(() => {
        const a = document.activeElement
        const cs = getComputedStyle(a)
        return { visible: a.matches(':focus-visible'), style: cs.outlineStyle, width: parseFloat(cs.outlineWidth) }
      })
      return { ok: ring.visible && ring.style !== 'none' && ring.width > 0, detail: JSON.stringify(ring) }
    })
    await h.key('Enter')
    await h.wait(400)
    await h.assert('Enter on a day picks it and saves', async () => {
      const f = await focusedDate()
      const got = parts(await savedDue((d) => parts(d).date === f))
      return { ok: got.date === f, detail: `${got.date} vs ${f}` }
    })
    await h.assert('Escape closes the popover and focus returns to the Schedule button', async () => {
      await h.key('Escape')
      await h.wait(400)
      const active = await page.evaluate(() => document.activeElement?.getAttribute('data-prop'))
      return { ok: (await popover.count()) === 0 && active === 'schedule', detail: active }
    })

    // ---- axe on the open popover ---------------------------------------------------------------
    await open()
    const found = await h.axe(POP, { label: 'when popover' })
    const serious = found.filter((v) => ['serious', 'critical'].includes(v.impact) && v.id !== 'color-contrast')
    await h.assert('no serious axe violation in the popover (colour contrast aside)', {
      ok: serious.length === 0,
      detail: serious.map((v) => `${v.id} ${v.targets[0] ?? ''}`).join('; '),
    })
    await h.capture('popover-with-date')

    // ---- D. "Next week" ------------------------------------------------------------------------
    await popover.locator('[role="group"][aria-label="Quick choices"] button', { hasText: 'Next week' }).click()
    await h.wait(500)
    await h.assert('"Next week" closes the popover', async () => (await popover.count()) === 0)
    await h.assert('"Next week" saves the coming Monday and keeps the time', async () => {
      const got = parts(await savedDue((d) => parts(d).date === ymd(monday)))
      return { ok: got.date === ymd(monday), detail: `${got.date} ${got.time}` }
    })

    // ---- F. Clear -----------------------------------------------------------------------------
    await open()
    await popover.getByRole('button', { name: 'Clear date' }).click()
    await h.wait(500)
    await h.assert('Clear closes the popover', async () => (await popover.count()) === 0)
    await h.assert('Clear sends the null date', async () => {
      const due = await savedDue(isNull)
      return { ok: isNull(due), detail: due }
    })
    await open()
    await h.assert('with no date there is nothing to clear', async () => (await popover.getByRole('button', { name: 'Clear date' }).count()) === 0)
    await closeIt()

    // ---- F2. the custom time is applied by Enter, never by leaving the popover ------------------
    await open()
    await popover.getByLabel('Custom time').click()
    await h.type('5pm', { delay: 20 })
    await h.key('Escape')
    await h.wait(700)
    await h.assert('Escape with an unconfirmed custom time closes the popover and saves nothing', async () => {
      const due = await savedDue((value) => !isNull(value))
      return { ok: (await popover.count()) === 0 && isNull(due), detail: due }
    })
    await open()
    await popover.getByLabel('Custom time').click()
    await h.type('5pm', { delay: 20 })
    await h.key('Enter')
    await h.wait(500)
    await h.assert('Enter in the custom time saves the time and keeps the popover open', async () => {
      const due = await savedDue((value) => !isNull(value))
      return { ok: (await popover.count()) === 1 && !isNull(due) && parts(due).time === '17:00:00', detail: due }
    })
    await closeIt()
    await open()
    await popover.getByRole('button', { name: 'Clear date' }).click()
    await h.wait(500)

    // ---- G. reminders --------------------------------------------------------------------------
    const remindersBtn = row.locator('button[data-prop="reminders"]').first()
    const reminders = page.locator(REMINDER_POP)
    const remindersOnServer = async () => (await h.api('GET', `/tasks/${id}`)).reminders ?? []
    await remindersBtn.click()
    await h.wait(450)
    await h.capture('reminders')
    await h.assert('the reminder picker has the panel and no native date-time input', async () => ({
      ok: (await reminders.getByLabel('Date and time').count()) === 1 && (await reminders.locator('input[type="datetime-local"]').count()) === 0,
    }))
    await h.assert('"Add reminder" is not shown until a day is picked (no disabled button)', async () => (await reminders.getByRole('button', { name: /^Add reminder/ }).count()) === 0)

    const before = (await remindersOnServer()).length
    await reminders.locator('[role="group"][aria-label="Quick choices"] button', { hasText: 'Tomorrow' }).click()
    await h.wait(700)
    await h.assert('after Add the new panel has focus on its text field (no fall to the document)', async () => {
      const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))
      return { ok: focused === 'Date and time' && (await reminders.getByLabel('Date and time').evaluate((el) => el === document.activeElement)), detail: focused }
    })
    await h.assert('a quick choice adds a reminder at once (one click)', async () => {
      let list = await remindersOnServer()
      for (let i = 0; i < 12 && list.length <= before; i++) {
        await h.wait(250)
        list = await remindersOnServer()
      }
      const added = list.find((r) => r.reminder && parts(r.reminder).date === ymd(tomorrow))
      return { ok: list.length === before + 1 && !!added && parts(added.reminder).time === '09:00:00', detail: `${list.length} reminders, ${added && JSON.stringify(parts(added.reminder))}` }
    })

    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 3)
    await reminders.locator(`button[data-date="${ymd(day)}"]`).click()
    await h.wait(300)
    await h.assert('after a day is picked the "Add reminder" button is there and enabled', async () => {
      const button = reminders.getByRole('button', { name: /^Add reminder/ })
      return { ok: (await button.count()) === 1 && (await button.isEnabled()), detail: await button.getAttribute('aria-label') }
    })
    await h.capture('reminders-day-picked')
    await reminders.getByRole('button', { name: /^Add reminder/ }).click()
    await h.wait(700)
    await h.assert('two clicks (a day, then Add reminder) add the reminder', async () => {
      let list = await remindersOnServer()
      for (let i = 0; i < 12 && list.length <= before + 1; i++) {
        await h.wait(250)
        list = await remindersOnServer()
      }
      const added = list.find((r) => r.reminder && parts(r.reminder).date === ymd(day))
      return { ok: list.length === before + 2 && !!added, detail: `${list.length} reminders` }
    })
    await h.dismiss()
  } finally {
    await h.api('DELETE', `/tasks/${id}`).catch(() => {})
  }
}
