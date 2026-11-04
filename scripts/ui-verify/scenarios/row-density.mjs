// row-density: Settings, General, Task rows (design system section 4, tokens in design-tokens-v1.json).
//
//   A. Compact, the default: a long title stays on one line, the notes show as the icon only.
//   B. Comfortable from Settings: the row takes up to three title lines and one line of notes, and the
//      notes icon goes, at once and without a restart.
//   C. A row in Comfortable still opens its card, and the card's title is the whole title.
//   D. Compact again puts the row back.
//
// It adds one task to the Inbox and deletes it again. Run it alone: --scenario row-density.
import { createApi, readApiToken } from '../lib.mjs'

export const meta = {
  id: 'row-density',
  wave: null,
  title: 'Task rows: Compact and Comfortable, chosen in Settings and applied at once',
}

const TITLE = 'Density probe: a title that runs well past the first line of the row and on past the second line and the third line too, so that even a wide window has to cut it off somewhere, with quite a few more words after that point to be sure of it'
const NOTES = '<p>Call the bank about the <b>savings</b> account &amp; ask for Sam.</p><p>Second paragraph on the same line.</p>'

export default async function run(h) {
  const page = h.page
  const api = createApi(readApiToken())
  await h.resize(1280, 820)
  const config = await page.evaluate(() => window.api.getConfig())
  const task = await api.call('POST', `/projects/${config.inbox_project_id}/tasks`, { title: TITLE, description: NOTES })
  const row = page.locator(`[data-task-id="${task.id}"]`)
  const measure = () => row.evaluate((el) => {
    const title = el.querySelector('[class*="line-clamp"], [class*="truncate"]')
    return {
      height: Math.round(el.getBoundingClientRect().height),
      text: el.innerText,
      titleClass: title?.className ?? '',
      titleLines: title ? Math.round(title.getBoundingClientRect().height / parseFloat(getComputedStyle(title).lineHeight)) : 0,
    }
  })
  const choose = async (label) => {
    await h.goto('/settings')
    await h.wait(500)
    await page.getByRole('radiogroup', { name: 'Task rows' }).getByText(label, { exact: true }).click()
    await h.wait(900)
    await h.goto('/inbox')
    await h.wait(900)
    await row.waitFor({ timeout: 8000 })
  }

  try {
    // ---- A. Compact ----------------------------------------------------------------------------
    await choose('Compact')
    const compact = await measure()
    await h.capture('compact', { clip: page.locator('main').first() })
    await h.assert('A: compact keeps a long title on one line', { ok: compact.titleLines === 1, detail: JSON.stringify(compact) })
    await h.assert('A: compact shows no notes text', { ok: !compact.text.includes('Call the bank'), detail: compact.text.slice(0, 120) })

    // ---- B. Comfortable ------------------------------------------------------------------------
    await choose('Comfortable')
    const saved = await page.evaluate(async () => (await window.api.getConfig()).row_density)
    await h.assert('B: the choice is saved as row_density', { ok: saved === 'comfortable', detail: String(saved) })
    const comfortable = await measure()
    await h.capture('comfortable', { clip: page.locator('main').first() })
    await h.assert('B: comfortable shows up to three title lines', { ok: comfortable.titleLines > 1 && comfortable.titleLines <= 3, detail: JSON.stringify(comfortable) })
    await h.assert('B: comfortable shows the notes as plain text, entities decoded', {
      ok: comfortable.text.includes('Call the bank about the savings account & ask for Sam.'),
      detail: comfortable.text.slice(-160),
    })
    await h.assert('B: the row is taller than compact', { ok: comfortable.height > compact.height, detail: `${compact.height} -> ${comfortable.height}` })

    // ---- C. It still opens ---------------------------------------------------------------------
    await row.click({ position: { x: 180, y: 12 } })
    await h.wait(700)
    await h.capture('comfortable-open', { clip: page.locator('main').first() })
    const opened = await page.evaluate(() => document.querySelectorAll('[data-prop]').length)
    await h.assert('C: a comfortable row opens its card', { ok: opened > 0, detail: String(opened) })
    await page.keyboard.press('Escape')
    await h.wait(400)

    // ---- D. Back to Compact --------------------------------------------------------------------
    await choose('Compact')
    const again = await measure()
    await h.assert('D: compact again puts the row back', { ok: again.titleLines === 1 && !again.text.includes('Call the bank'), detail: JSON.stringify(again) })
  } finally {
    await page.evaluate(() => window.api.saveConfigPatch({ row_density: 'compact' })).catch(() => {})
    await api.call('DELETE', `/tasks/${task.id}`).catch(() => {})
  }
}
