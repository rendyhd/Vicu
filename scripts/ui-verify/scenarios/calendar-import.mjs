// IMP: importing a calendar file into Events (contract 20.10, plan phase 2f), through the real
// dialogs: "Import calendar file..." in the Plan gear, the file picked (Electron's open dialog is
// replaced in the main process by one that answers with this scenario's fixture), the preview with
// its counts, titles and Busy only, Import as one synced change, the Events on the timeline, Undo.
// Then Settings: the same button, and a cancelled file dialog does nothing.
//
// Its own throwaway data only (titles "IMP ..."): Undo removes the Events, and anything left at the
// end is deleted.

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const meta = {
  id: 'IMP',
  wave: 6,
  title: 'Import a calendar file into Events',
}

const pad = (n) => String(n).padStart(2, '0')
const dayAt = (offset) => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + offset)
  return d
}
const ymd = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
const floating = (offset, h, m) => `${ymd(dayAt(offset))}T${pad(h)}${pad(m)}00`
const WEEKDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

function fixture() {
  const tomorrow = dayAt(1)
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Vicu//IMP//EN',
    // A weekly series on tomorrow's weekday: one repeating Event.
    'BEGIN:VEVENT', 'UID:imp-weekly', 'SUMMARY:IMP Weekly standup', `DTSTART:${floating(1, 9, 30)}`, `DTEND:${floating(1, 9, 45)}`, `RRULE:FREQ=WEEKLY;BYDAY=${WEEKDAY[tomorrow.getDay()]}`, 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:imp-dentist', 'SUMMARY:IMP Dentist', 'LOCATION:Main St 1', `DTSTART:${floating(1, 11, 0)}`, `DTEND:${floating(1, 12, 0)}`, 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:imp-focus', 'SUMMARY:IMP Focus time', 'TRANSP:TRANSPARENT', `DTSTART:${floating(1, 14, 0)}`, `DTEND:${floating(1, 16, 0)}`, 'END:VEVENT',
    // Three days off: an all-day Event that repeats daily until its last day.
    'BEGIN:VEVENT', 'UID:imp-break', 'SUMMARY:IMP Term break', `DTSTART;VALUE=DATE:${ymd(dayAt(3))}`, `DTEND;VALUE=DATE:${ymd(dayAt(6))}`, 'END:VEVENT',
    // Left out: cancelled, and over before today.
    'BEGIN:VEVENT', 'UID:imp-cancelled', 'SUMMARY:IMP Cancelled', 'STATUS:CANCELLED', `DTSTART:${floating(1, 16, 0)}`, `DTEND:${floating(1, 17, 0)}`, 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:imp-old', 'SUMMARY:IMP Old', `DTSTART:${floating(-3, 10, 0)}`, `DTEND:${floating(-3, 11, 0)}`, 'END:VEVENT',
    'END:VCALENDAR',
  ]
  const dir = mkdtempSync(join(tmpdir(), 'vicu-imp-'))
  const path = join(dir, 'IMP school year.ics')
  writeFileSync(path, lines.join('\r\n'))
  return path
}

export default async function run(h) {
  const page = h.page
  await h.resize(1400, 900)
  await h.dismiss()
  const path = fixture()

  const pickFile = (filePath) => h.app.evaluate(({ dialog }, chosen) => {
    globalThis.__impOriginalDialog = globalThis.__impOriginalDialog ?? dialog.showOpenDialog
    dialog.showOpenDialog = async () => (chosen ? { canceled: false, filePaths: [chosen] } : { canceled: true, filePaths: [] })
  }, filePath)
  const impEvents = async () => {
    const snapshot = await page.evaluate(() => window.api.getSyncedPrefs())
    return Object.entries(snapshot.values ?? {}).filter(([key, value]) => key.startsWith('event.') && value && typeof value === 'object' && String(value.title ?? '').startsWith('IMP ')).map(([key, value]) => ({ key, value }))
  }
  const eventTexts = () => page.locator('[data-plan-event]').evaluateAll((nodes) => nodes.map((n) => n.textContent))

  try {
    await page.evaluate(() => window.api.saveConfigPatch({ planner_enabled: true, planner_view: 'day', planner_source: 'day' }))
    await page.reload()
    await h.wait(1200)
    const before = await impEvents()
    await h.assert('no IMP Events before the run', before.length === 0, before.map((e) => e.key))

    // --- From the Plan gear ------------------------------------------------------------------------
    await pickFile(path)
    await h.goto('/plan')
    await page.locator('[data-plan-gear]').click()
    await page.locator('[data-calendar-summary]').waitFor()
    await h.capture('gear-import-button')
    await page.locator('[data-calendar-import-open]').click()
    await page.locator('[data-calendar-import-dialog]').waitFor({ timeout: 10000 })
    await h.wait(300)
    const title = await page.locator('[data-calendar-import-dialog] h2').innerText()
    await h.assert('the preview names the file', title === 'Import IMP school year.ics', title)
    const count = await page.locator('[data-calendar-import-count]').innerText()
    await h.assert('the preview counts repeating and single Events', count === '4 Events: 2 repeating, 2 single.', count)
    const titles = await page.locator('[data-calendar-import-item] span:first-child').allInnerTexts()
    await h.assert('the preview lists the titles by first day; cancelled and past ones are left out', JSON.stringify(titles) === JSON.stringify(['IMP Weekly standup', 'IMP Dentist', 'IMP Focus time', 'IMP Term break']), titles)
    await h.assert('the gear closed behind the preview', (await page.locator('[data-calendar-summary]').count()) === 0)
    await h.capture('preview')
    await h.axe('[data-calendar-import-dialog]', { label: 'import preview' })

    await page.locator('[data-calendar-import-busy-only]').click()
    await h.wait(200)
    const busyTitles = await page.locator('[data-calendar-import-item] span:first-child').allInnerTexts()
    await h.assert('Busy only drops the titles (Free for a free event)', JSON.stringify(busyTitles.slice().sort()) === JSON.stringify(['Busy', 'Busy', 'Busy', 'Free']), busyTitles)
    await h.capture('preview-busy-only')
    await page.locator('[data-calendar-import-busy-only]').click()

    await page.locator('[data-calendar-import-confirm]').click()
    await page.locator('[data-calendar-import-dialog]').waitFor({ state: 'detached', timeout: 10000 })
    const toastText = await page.locator('[data-toast-kind="success"]').last().innerText()
    await h.assert('one toast says how many were imported', /Imported 4 Events/.test(toastText), toastText)
    let written = await impEvents()
    await h.assert('four event.<id> entries were written', written.length === 4, written.map((e) => e.value.title))
    const weekly = written.find((e) => e.value.title === 'IMP Weekly standup')?.value
    await h.assert('the weekly series is one repeating Event', weekly?.repeat?.kind === 'weekly' && weekly.time === '09:30' && weekly.minutes === 15, weekly)
    const focus = written.find((e) => e.value.title === 'IMP Focus time')?.value
    await h.assert('a free event is not busy', focus?.busy === false, focus)
    const brk = written.find((e) => e.value.title === 'IMP Term break')?.value
    await h.assert('three days off repeat daily until the last day', brk?.repeat?.kind === 'daily' && typeof brk.until === 'string' && brk.time === undefined, brk)

    await page.locator('[data-plan-view="day"]').click()
    await page.locator('[data-plan-today]').click()
    await page.locator('[data-plan-next]').click()
    await h.wait(1000)
    await page.evaluate(() => {
      const scroller = document.querySelector('[data-plan-scroller]')
      if (scroller) scroller.scrollTop = 9 * 60 - 20
    })
    await h.wait(300)
    const drawn = await eventTexts()
    await h.assert('the imported Events are on tomorrow\'s timeline', ['IMP Weekly standup', 'IMP Dentist', 'IMP Focus time'].every((t) => drawn.some((text) => text.includes(t))), drawn)
    await h.capture('plan-imported')

    // Undo, from the toast, removes all four in one change.
    await page.locator('[data-toast-kind="success"]').last().getByRole('button', { name: 'Undo' }).click()
    await h.wait(1200)
    written = await impEvents()
    await h.assert('Undo removes every imported Event', written.length === 0, written.map((e) => e.value.title))
    const left = await eventTexts()
    await h.assert('and they leave the timeline', !left.some((text) => text.includes('IMP ')), left)

    // --- From Settings; a cancelled file dialog does nothing ---------------------------------------
    await h.goto('/settings?section=calendars')
    await page.locator('[data-calendar-feeds]').waitFor({ timeout: 10000 })
    await page.locator('[data-plan-my-events]').scrollIntoViewIfNeeded()
    await pickFile(null)
    await page.locator('[data-plan-my-events] [data-calendar-import-open]').click()
    await h.wait(800)
    await h.assert('a cancelled file dialog opens no preview', (await page.locator('[data-calendar-import-dialog]').count()) === 0)
    await h.capture('settings-import-button')
    await pickFile(path)
    await page.locator('[data-plan-my-events] [data-calendar-import-open]').click()
    await page.locator('[data-calendar-import-dialog]').waitFor({ timeout: 10000 })
    await h.assert('Settings opens the same preview', (await page.locator('[data-calendar-import-item]').count()) === 4)
    await page.keyboard.press('Escape')
    await page.locator('[data-calendar-import-dialog]').waitFor({ state: 'detached', timeout: 5000 })
    await h.assert('closing the preview imports nothing', (await impEvents()).length === 0)
  } finally {
    await page.evaluate(async () => {
      const snapshot = await window.api.getSyncedPrefs()
      const stale = {}
      for (const [key, value] of Object.entries(snapshot.values ?? {})) {
        if (key.startsWith('event.') && value && typeof value === 'object' && String(value.title ?? '').startsWith('IMP ')) stale[key] = null
      }
      if (Object.keys(stale).length) await window.api.setSyncedPreferences(stale)
      await window.api.saveConfigPatch({ planner_enabled: false, planner_view: 'day', planner_source: 'day' })
    }).catch(() => {})
    await h.app.evaluate(({ dialog }) => {
      if (globalThis.__impOriginalDialog) dialog.showOpenDialog = globalThis.__impOriginalDialog
    }).catch(() => {})
  }
}
