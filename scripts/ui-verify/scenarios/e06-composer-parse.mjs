// E6 (card 3.5, composer chips follow the parser): what the chips show is what is saved.
//
//   A. "E6 call Ana saturday 3pm +Personal !3" (the profile uses Vikunja syntax: +project, *label):
//      the chips read the coming Saturday at 15:00, "Personal" and "High", the buttons under the input
//      agree, the tokens are highlighted, and Enter saves exactly those.
//   B. A control wins: with the same text, picking Low in the priority picker changes the chip, drops the
//      "!3" highlight, and the saved task has priority Low (the other two still come from the text).
//   C. The suggestion list is a listbox under the word being typed; the input is its combobox with
//      aria-activedescendant; Escape closes the list and not the composer.
//   D. The send button sits next to the text with an Enter hint; the placeholder is "New task".
//
// The tasks it creates are found by their title and deleted at the end.
import { comingWeekday } from '../lib.mjs'

export const meta = {
  id: 'E6',
  wave: 3,
  title: 'Composer: Call Ana Saturday 3pm with project and priority, Enter: chips and the saved task agree',
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const pad = (n) => String(n).padStart(2, '0')
const TEXT = 'E6 call Ana saturday 3pm +Personal !3'

export default async function run(h) {
  const page = h.page
  await h.resize(1280, 820)
  await h.dismiss()

  const saturday = comingWeekday(6)
  const created = []
  const findE6 = async () => {
    const body = await h.api('GET', `/projects/${h.ids.personal}/tasks?per_page=1000`)
    const items = Array.isArray(body) ? body : (body?.items ?? [])
    return items.filter((t) => String(t.title).includes('E6 call Ana'))
  }
  const waitForTask = async () => {
    for (let i = 0; i < 20; i++) {
      const found = (await findE6()).filter((t) => !created.includes(t.id))
      if (found.length) {
        created.push(found[0].id)
        return found[0]
      }
      await h.wait(250)
    }
    return null
  }

  const composer = () => page.locator('button[aria-label="Create task"]').locator('xpath=ancestor::div[contains(@class,"border-b")][1]')
  const input = () => page.getByPlaceholder('New task').first()
  const chipsOf = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('[data-chip-type]')].map((el) => ({
        type: el.getAttribute('data-chip-type'),
        source: el.getAttribute('data-chip-source'),
        text: el.textContent.replace(/×/g, '').trim(),
      })),
    )
  const highlightCount = () =>
    page.evaluate(() => [...document.querySelectorAll('[aria-hidden="true"] span[style*="background"]')].length)
  const openComposer = async () => {
    await h.goto('/inbox')
    await h.dismiss()
    await page.locator('button[aria-label="New task"]').last().click()
    await h.wait(400)
  }

  try {
    // ---- D (first, on the empty composer): placeholder -----------------------------------------
    await openComposer()
    await h.assert('the placeholder reads "New task"', async () => (await input().getAttribute('placeholder')) === 'New task')
    await h.assert('no Enter hint while the field is empty', async () => (await page.locator('kbd', { hasText: 'Enter' }).count()) === 0)

    // ---- A. chips read the text ---------------------------------------------------------------
    await input().click()
    await h.type(TEXT, { delay: 15 })
    await h.wait(500)
    await h.capture('typed')
    const chips = await chipsOf()
    const date = chips.find((c) => c.type === 'date')
    await h.assert('the date chip is the coming Saturday at 15:00', async () => {
      const text = date?.text ?? ''
      const ok = text.includes('Sat') && text.includes(MONTHS[saturday.getMonth()]) && new RegExp(`\\b${saturday.getDate()}\\b`).test(text) && /15:00|3:00 PM/.test(text)
      return { ok, detail: text }
    })
    await h.assert('the project chip reads Personal', { ok: chips.some((c) => c.type === 'project' && c.text === 'Personal'), detail: JSON.stringify(chips) })
    await h.assert('the priority chip reads High', { ok: chips.some((c) => c.type === 'priority' && c.text === 'High'), detail: JSON.stringify(chips) })
    await h.assert('all three come from the text', { ok: chips.length === 3 && chips.every((c) => c.source === 'text'), detail: JSON.stringify(chips) })
    await h.assert('the buttons under the input show the same values', async () => {
      const labels = await page.evaluate(() => ({
        date: document.querySelector('button[title="Date and repeat"]')?.textContent?.trim(),
        priority: document.querySelector('button[title="Priority"]')?.textContent?.trim(),
        project: document.querySelector('button[title="Project"]')?.textContent?.trim(),
      }))
      return { ok: labels.date === date?.text && labels.priority === 'High' && labels.project === 'Personal', detail: JSON.stringify(labels) }
    })
    const highlighted = await highlightCount()
    await h.assert('the three tokens are highlighted', { ok: highlighted === 3, detail: String(highlighted) })

    // ---- D. send button and hint --------------------------------------------------------------
    await h.assert('the Enter hint is next to the send button, after the text', async () => {
      const hint = await page.locator('kbd', { hasText: 'Enter' }).first().boundingBox()
      const send = await page.locator('button[aria-label="Create task"]').boundingBox()
      const field = await input().boundingBox()
      return {
        ok: !!hint && !!send && !!field && hint.x + hint.width <= send.x + 1 && send.x >= field.x && Math.abs(hint.y - send.y) < 20,
        detail: JSON.stringify({ field: field && Math.round(field.x + field.width), hint: hint && Math.round(hint.x), send: send && Math.round(send.x) }),
      }
    })
    await h.assert('the send button has a name and a title that mention Enter', async () => (await page.locator('button[aria-label="Create task"]').getAttribute('title')) === 'Create task (Enter)')

    await h.key('Enter')
    const a = await waitForTask()
    await h.assert('the task was created', !!a)
    if (a) {
      const t = await h.api('GET', `/tasks/${a.id}`)
      const due = new Date(t.due_date)
      await h.assert('the server task is due the coming Saturday at 15:00', {
        ok: due.getFullYear() === saturday.getFullYear() && due.getMonth() === saturday.getMonth() && due.getDate() === saturday.getDate() && due.getHours() === 15 && due.getMinutes() === 0,
        detail: t.due_date,
      })
      await h.assert('the server task is in Personal with priority 3 and the title without the tokens', {
        ok: t.project_id === h.ids.personal && t.priority === 3 && t.title === 'E6 call Ana',
        detail: `project ${t.project_id}, priority ${t.priority}, title "${t.title}"`,
      })
    }

    // ---- B. a control wins --------------------------------------------------------------------
    await openComposer()
    await input().click()
    await h.type(TEXT, { delay: 15 })
    await h.wait(400)
    const before = await highlightCount()
    await page.locator('button[title="Priority"]').first().click()
    await h.wait(400)
    await page.locator('[popover][aria-label="Priority"]:popover-open').getByRole('option', { name: /Low/ }).click()
    await h.wait(500)
    await h.capture('chip-wins')
    const after = await chipsOf()
    await h.assert('the priority chip now reads Low and says it came from the control', {
      ok: after.some((c) => c.type === 'priority' && c.text === 'Low' && c.source === 'chip') && !after.some((c) => c.text === 'High'),
      detail: JSON.stringify(after),
    })
    await h.assert('the date and project chips still come from the text', {
      ok: after.some((c) => c.type === 'date' && c.source === 'text') && after.some((c) => c.type === 'project' && c.source === 'text'),
      detail: JSON.stringify(after),
    })
    await h.assert('the "!3" token lost its highlight and stays in the text', async () => {
      const count = await highlightCount()
      return { ok: before === 3 && count === 2 && (await input().inputValue()).includes('!3'), detail: `${before} -> ${count}` }
    })
    // The picker returned focus to its button; back to the text, as a user would, then send.
    await input().click()
    await h.key('End')
    await h.key('Enter')
    const b = await waitForTask()
    await h.assert('the second task was created', !!b)
    if (b) {
      const t = await h.api('GET', `/tasks/${b.id}`)
      await h.assert('the server task has priority Low (the chip), the Saturday and Personal (the text)', {
        ok: t.priority === 1 && t.project_id === h.ids.personal && new Date(t.due_date).getDate() === saturday.getDate() && new Date(t.due_date).getHours() === 15,
        detail: `priority ${t.priority}, project ${t.project_id}, due ${t.due_date}`,
      })
      await h.assert('the title keeps the token that no longer counted', { ok: t.title.includes('!3'), detail: t.title })
    }

    // ---- C. the suggestion list ---------------------------------------------------------------
    await openComposer()
    await input().click()
    await h.type('E6 call Ana +Pe', { delay: 30 })
    await h.wait(500)
    const list = page.locator('[popover][role="listbox"]:popover-open')
    await h.capture('suggestions')
    await h.assert('the suggestions are a listbox on the popover primitive', async () => ({ ok: (await list.count()) === 1, detail: String(await list.count()) }))
    await h.assert('the input is the combobox of the list', async () => {
      const a11y = await page.evaluate(() => {
        const el = document.querySelector('input[role="combobox"]')
        if (!el) return null
        const listbox = document.getElementById(el.getAttribute('aria-controls') ?? '')
        const active = document.getElementById(el.getAttribute('aria-activedescendant') ?? '')
        return {
          expanded: el.getAttribute('aria-expanded'),
          listboxRole: listbox?.getAttribute('role') ?? null,
          activeRole: active?.getAttribute('role') ?? null,
          activeSelected: active?.getAttribute('aria-selected') ?? null,
          focused: document.activeElement === el,
        }
      })
      return { ok: !!a11y && a11y.expanded === 'true' && a11y.listboxRole === 'listbox' && a11y.activeRole === 'option' && a11y.activeSelected === 'true' && a11y.focused, detail: JSON.stringify(a11y) }
    })
    await h.assert('the list sits under the "+" of the word, not at the left edge', async () => {
      const box = await list.boundingBox()
      const field = await input().boundingBox()
      const textWidth = await page.evaluate(() => {
        const el = document.querySelector('input[role="combobox"]')
        const cs = getComputedStyle(el)
        const ctx = document.createElement('canvas').getContext('2d')
        ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
        return ctx.measureText('E6 call Ana ').width
      })
      const expected = field.x + textWidth
      return { ok: !!box && box.y >= field.y + field.height - 2 && Math.abs(box.x - expected) < 24, detail: `list ${box && Math.round(box.x)},${box && Math.round(box.y)} expected x ${Math.round(expected)}, field ${Math.round(field.x)},${Math.round(field.y + field.height)}` }
    })
    const optionCount = await list.getByRole('option').count()
    if (optionCount > 1) {
      const first = await page.evaluate(() => document.querySelector('input[role="combobox"]').getAttribute('aria-activedescendant'))
      await h.key('ArrowDown')
      await h.wait(120)
      const second = await page.evaluate(() => document.querySelector('input[role="combobox"]').getAttribute('aria-activedescendant'))
      await h.assert('ArrowDown moves aria-activedescendant to the next option', { ok: !!first && !!second && first !== second, detail: `${first} -> ${second}` })
      await h.key('ArrowUp')
      await h.wait(120)
    }
    await h.key('Escape')
    await h.wait(400)
    await h.assert('Escape closes the list and leaves the composer open', async () => ({
      ok: (await list.count()) === 0 && (await input().count()) === 1 && (await input().inputValue()).includes('+Pe'),
      detail: `${await list.count()} lists, ${await input().count()} inputs`,
    }))
    await h.assert('the combobox is collapsed again', async () => (await page.evaluate(() => document.querySelector('input[role="combobox"]')?.getAttribute('aria-expanded'))) === 'false')
    // Type on: the list comes back, Tab takes the highlighted project.
    await h.type('r', { delay: 30 })
    await h.wait(400)
    await h.key('Tab')
    await h.wait(300)
    await h.assert('Tab takes the highlighted suggestion into the text', async () => {
      const value = await input().inputValue()
      return { ok: /\+Personal\s*$/.test(value), detail: value }
    })
    await h.key('Escape')
    await h.wait(300)
    await h.dismiss()
  } finally {
    for (const id of created) await h.api('DELETE', `/tasks/${id}`).catch(() => {})
    for (const t of await findE6().catch(() => [])) await h.api('DELETE', `/tasks/${t.id}`).catch(() => {})
  }
}
