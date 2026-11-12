// CALF (contract 20.9): calendars that stay on this computer, in the running app.
//
//   A. A calendar file: Add a calendar, Calendar file, Choose file (Electron's open dialog replaced)
//      adds it; its event shows on Plan.
//   B. The file changes: Plan shows the new event without a refresh (the folder is watched).
//   C. The file is removed: the calendar keeps its last copy and says the file is gone.
//   D. Classic Outlook (Windows): the form says what it means, Continue waits for the tick, and a
//      closed Outlook is said plainly. Outlook is never started.
//
// Its own temporary file and connection; both are removed at the end.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const meta = {
  id: 'CALF',
  wave: 6,
  title: 'A calendar file on this computer, and classic Outlook',
}

const pad = (n) => String(n).padStart(2, '0')
const tomorrowAt = (h, m) => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + 1)
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(h)}${pad(m)}00`
}
const calendar = (title, h) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Vicu//CALF//EN', 'BEGIN:VEVENT', 'UID:calf-1', `SUMMARY:${title}`, `DTSTART:${tomorrowAt(h, 0)}`, `DTEND:${tomorrowAt(h + 1, 0)}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n')

export default async function run(h) {
  const page = h.page
  await h.resize(1400, 900)
  await h.dismiss()
  const dir = mkdtempSync(join(tmpdir(), 'vicu-calf-'))
  const path = join(dir, 'CALF rota.ics')
  writeFileSync(path, calendar('CALF Design review', 10))

  const pickFile = (filePath) => h.app.evaluate(({ dialog }, chosen) => {
    globalThis.__calfOriginalDialog = globalThis.__calfOriginalDialog ?? dialog.showOpenDialog
    dialog.showOpenDialog = async () => (chosen ? { canceled: false, filePaths: [chosen] } : { canceled: true, filePaths: [] })
  }, filePath)
  const eventTexts = () => page.locator('[data-plan-event]').evaluateAll((nodes) => nodes.map((n) => n.textContent ?? ''))
  const waitForEvent = async (text, ms = 8000) => {
    const until = Date.now() + ms
    while (Date.now() < until) {
      if ((await eventTexts()).some((t) => t.includes(text))) return true
      await h.wait(250)
    }
    return false
  }
  const ourConnections = async () => ((await page.evaluate(() => window.api.calendar.list())).connections ?? []).filter((c) => c.kind === 'ics-file' && c.name === 'CALF file')

  try {
    for (const stale of await ourConnections()) await page.evaluate((id) => window.api.calendar.remove(id), stale.id)
    await page.evaluate(() => window.api.saveConfigPatch({ planner_enabled: true, planner_view: 'day', planner_source: 'day' }))
    await page.reload()
    await h.wait(1200)

    // --- A. Add the file --------------------------------------------------------------------------
    await pickFile(path)
    await h.goto('/settings?section=calendars')
    await page.locator('[data-calendar-open-add]').waitFor({ timeout: 10000 })
    await page.locator('[data-calendar-open-add]').scrollIntoViewIfNeeded()
    await page.locator('[data-calendar-open-add]').click()
    await page.locator('[data-calendar-dialog]').waitFor()
    await page.locator('[data-calendar-choice="kind:file"]').click()
    await page.locator('[data-calendar-file-name]').fill('CALF file')
    await h.capture('file-form')
    await h.axe('[data-calendar-dialog]', { label: 'calendar file form' })
    await page.locator('[data-calendar-file-choose]').click()
    await page.locator('[data-calendar-dialog]').waitFor({ state: 'detached', timeout: 10000 })
    const added = await ourConnections()
    await h.assert('A: the file is added as one calendar', added.length === 1 && added[0].calendars.length === 1, added)
    await h.assert('A: its description names the file, not the folder', added[0]?.detail === 'File on this computer: CALF rota.ics', added[0]?.detail)
    await h.capture('file-added')

    await h.goto('/plan')
    await page.locator('[data-plan-today]').click()
    await page.locator('[data-plan-next]').click()
    await h.wait(800)
    await page.evaluate(() => {
      const scroller = document.querySelector('[data-plan-scroller]')
      if (scroller) scroller.scrollTop = 9 * 60 - 20
    })
    await h.assert('A: Plan shows the file\'s event', await waitForEvent('CALF Design review'), await eventTexts())
    await h.capture('plan-file-event')

    // --- B. The file changes ----------------------------------------------------------------------
    writeFileSync(path, calendar('CALF Moved review', 11))
    const moved = await waitForEvent('CALF Moved review')
    await h.assert('B: a change to the file shows without a refresh', moved, await eventTexts())
    await h.assert('B: the old event is gone', !(await eventTexts()).some((t) => t.includes('CALF Design review')), await eventTexts())
    await h.capture('plan-file-changed')

    // --- C. The file is removed ---------------------------------------------------------------------
    rmSync(path)
    let said = ''
    for (let i = 0; i < 40 && !said.includes('no longer there'); i++) {
      await h.wait(250)
      said = ((await ourConnections())[0]?.calendars?.[0]?.error) ?? ''
    }
    await h.assert('C: the calendar says the file is gone', said === 'The file CALF rota.ics is no longer there. Put it back, or remove this calendar.', said)
    await h.assert('C: the last copy stays on screen', (await eventTexts()).some((t) => t.includes('CALF Moved review')), await eventTexts())

    // --- D. Classic Outlook ---------------------------------------------------------------------------
    if (process.platform === 'win32') {
      await h.goto('/settings?section=calendars')
      await page.locator('[data-calendar-open-add]').waitFor({ timeout: 10000 })
      await page.locator('[data-calendar-open-add]').scrollIntoViewIfNeeded()
      await page.locator('[data-calendar-open-add]').click()
      await page.locator('[data-calendar-dialog]').waitFor()
      await page.locator('[data-calendar-choice="kind:outlook"]').click()
      await page.locator('[data-calendar-outlook]').waitFor()
      await h.wait(2500)
      const text = await page.locator('[data-calendar-outlook]').innerText()
      await h.assert('D: the form says only classic Outlook, while open', /Only classic Outlook can be read, and only while it is open/.test(text), text)
      await h.assert('D: the form mentions Outlook\'s own prompt and work PCs', /may ask whether to allow a program/.test(text) && /organisation allows it/.test(text), text)
      const state = await page.evaluate(() => window.api.calendar.outlook.status())
      h.emit({ t: 'note', outlook: state.state })
      if (state.state !== 'missing') {
        await h.assert('D: Continue waits for the tick', await page.locator('[data-calendar-outlook-continue]').isDisabled())
        await page.locator('[data-calendar-outlook-allowed]').click()
        await h.assert('D: the tick enables Continue', await page.locator('[data-calendar-outlook-continue]').isEnabled())
      }
      if (state.state === 'closed') {
        const problem = await page.locator('[data-calendar-outlook-problem]').innerText()
        await h.assert('D: a closed Outlook is said plainly', /Open classic Outlook to read its calendars/.test(problem), problem)
        await page.locator('[data-calendar-outlook-continue]').click()
        await page.locator('[data-calendar-outlook-error]').waitFor({ timeout: 40000 })
        const error = await page.locator('[data-calendar-outlook-error]').innerText()
        await h.assert('D: Continue with Outlook closed says to open it, and starts nothing', /Open classic Outlook/.test(error), error)
        const outlookRuns = execFileSync('tasklist', ['/FI', 'IMAGENAME eq OUTLOOK.EXE', '/NH'], { encoding: 'utf8' }).includes('OUTLOOK.EXE')
        await h.assert('D: Outlook was not started', !outlookRuns)
        await h.assert('D: the sentence is said once', (await page.locator('[data-calendar-outlook]').innerText()).split('Open classic Outlook').length === 2)
      }
      await h.capture('outlook-form')
      await h.axe('[data-calendar-dialog]', { label: 'classic Outlook form' })
      await page.keyboard.press('Escape')
    }
  } finally {
    for (const connection of await ourConnections().catch(() => [])) await page.evaluate((id) => window.api.calendar.remove(id), connection.id).catch(() => {})
    await h.app.evaluate(({ dialog }) => {
      if (globalThis.__calfOriginalDialog) dialog.showOpenDialog = globalThis.__calfOriginalDialog
    }).catch(() => {})
    rmSync(dir, { recursive: true, force: true })
  }
}
