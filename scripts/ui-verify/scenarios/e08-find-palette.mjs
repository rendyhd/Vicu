// E8 (card 3.8, D-8): Quick find in the sidebar and the command palette.
//
//   A. Ctrl+F focuses "Quick find"; typing "plumb" lists the task before the server answer could
//      have come (cached, well inside the 250 ms debounce); arrows move the highlight; Enter
//      opens the task in its list.
//   B. Escape clears the field, a second Escape gives focus back to where it was.
//   C. Ctrl+Shift+P opens the palette (a modal dialog); "logbook" + Enter goes to Logbook.
//   D. The Toggle theme action flips the theme (and is flipped back).
//   E. axe on both.
export const meta = {
  id: 'E8',
  wave: 3,
  title: 'Ctrl+F "plumb"; Ctrl+Shift+P "logbook", Enter: live results before Enter, palette navigates',
}

const finder = (page) =>
  page.evaluate(() => {
    const input = document.querySelector('input[aria-label="Quick find"]')
    const list = document.querySelector('[role="listbox"][aria-label="Quick find results"]')
    const options = list ? [...list.querySelectorAll('[role="option"]')] : []
    return {
      focused: document.activeElement === input,
      expanded: input?.getAttribute('aria-expanded') ?? null,
      value: input?.value ?? null,
      options: options.map((o) => (o.textContent ?? '').trim()),
      selected: options.findIndex((o) => o.getAttribute('aria-selected') === 'true'),
      activeDescendantIsSelected: !!input?.getAttribute('aria-activedescendant') && options.some((o) => o.id === input.getAttribute('aria-activedescendant') && o.getAttribute('aria-selected') === 'true'),
      listVisible: !!list && list.matches(':popover-open'),
    }
  })

const palette = (page) =>
  page.evaluate(() => {
    const dialog = document.querySelector('dialog[aria-label="Command palette"]')
    const options = dialog ? [...dialog.querySelectorAll('[role="option"]')] : []
    const input = dialog?.querySelector('input')
    return {
      open: !!dialog && dialog.matches(':modal'),
      focused: !!input && document.activeElement === input,
      options: options.map((o) => (o.textContent ?? '').trim()),
      selected: options.findIndex((o) => o.getAttribute('aria-selected') === 'true'),
    }
  })

export default async function run(h) {
  const page = h.page
  await h.resize(1280, 820)
  await h.goto('/today')
  await h.wait(500)

  // ---- A. Quick find -----------------------------------------------------------------------
  const row = h.rows().first()
  await row.focus()
  await h.key('Control+f')
  await h.wait(150)
  let s = await finder(page)
  await h.assert('Ctrl+F focuses the Quick find field in the sidebar', { ok: s.focused, detail: JSON.stringify(s) })
  const inSidebar = await page.evaluate(() => !!document.querySelector('aside input[aria-label="Quick find"]'))
  await h.assert('the field is in the sidebar, not in the window controls', inSidebar)
  await h.assert('no search button is left in the window controls', async () => (await page.locator('header button[title^="Search tasks"]').count()) === 0)

  await h.type('plumb', { delay: 20 })
  await h.wait(120) // less than the 250 ms debounce: only the cache can have answered
  s = await finder(page)
  await h.assert('typing "plumb" lists the plumber task before the server could answer', {
    ok: s.expanded === 'true' && s.listVisible && s.options.some((o) => /plumber/i.test(o)),
    detail: JSON.stringify(s),
  })
  await h.assert('the last entry offers all results', { ok: /Search all tasks/.test(s.options[s.options.length - 1] ?? ''), detail: JSON.stringify(s.options) })
  await h.assert('the first result is highlighted and is the active descendant', { ok: s.selected === 0 && s.activeDescendantIsSelected, detail: JSON.stringify(s) })
  await h.capture('quick-find')
  const found = await h.axe('[role="listbox"][aria-label="Quick find results"]', { label: 'quick find results' })
  const foundField = await h.axe('aside [role="search"]', { label: 'quick find field' })
  await h.assert('axe: no serious or critical violation in Quick find', { ok: [...found, ...foundField].filter((v) => v.impact === 'serious' || v.impact === 'critical').length === 0, detail: [...found, ...foundField].map((v) => v.id).join(', ') })

  await h.key('ArrowDown')
  s = await finder(page)
  await h.assert('ArrowDown moves the highlight (focus stays in the field)', { ok: s.selected === 1 && s.focused, detail: JSON.stringify(s) })
  await h.key('ArrowUp')
  s = await finder(page)
  await h.assert('ArrowUp moves it back', { ok: s.selected === 0, detail: JSON.stringify(s) })

  await h.wait(600) // the server answer has merged in by now
  s = await finder(page)
  await h.assert('the server answer keeps the plumber task listed once', { ok: s.options.filter((o) => /plumber/i.test(o)).length === 1, detail: JSON.stringify(s.options) })

  await h.key('Enter')
  await h.wait(900)
  const opened = await page.evaluate(() => {
    const card = [...document.querySelectorAll('[data-task-id]')].find((r) => /plumber/i.test(r.textContent ?? '') && r.querySelector('button[title="Schedule"]'))
    return { hash: location.hash, card: !!card }
  })
  await h.assert('Enter opens the task: its list shows and the row is expanded', { ok: opened.card && /#\/(project|inbox|today)/.test(opened.hash), detail: JSON.stringify(opened) })
  s = await finder(page)
  await h.assert('the field is cleared and closed after opening', { ok: s.value === '' && !s.listVisible, detail: JSON.stringify(s) })

  // ---- B. Escape ---------------------------------------------------------------------------
  await h.dismiss()
  await h.goto('/today')
  const first = h.rows().first()
  await first.focus()
  const firstId = await first.getAttribute('data-task-id')
  await h.key('Control+f')
  await h.type('zzzq', { delay: 20 })
  await h.wait(200)
  await h.key('Escape')
  s = await finder(page)
  await h.assert('the first Escape clears the field and keeps focus in it', { ok: s.value === '' && s.focused, detail: JSON.stringify(s) })
  await h.key('Escape')
  await h.wait(150)
  const back = await page.evaluate((id) => document.activeElement?.closest(`[data-task-id="${id}"]`) != null, firstId)
  await h.assert('the second Escape returns focus to where it was before Ctrl+F', back)

  // ---- C. Command palette ------------------------------------------------------------------
  await h.dismiss()
  await h.goto('/today')
  await h.key('Control+Shift+P')
  await h.wait(350)
  let p = await palette(page)
  await h.assert('Ctrl+Shift+P opens the palette as a modal dialog with focus in its field', { ok: p.open && p.focused, detail: JSON.stringify(p) })
  await h.assert('with no query it lists actions and smart lists', {
    ok: ['New task', 'Toggle theme', 'Settings', 'Logbook'].every((n) => p.options.some((o) => o.startsWith(n))),
    detail: JSON.stringify(p.options),
  })
  await h.capture('palette')
  const pal = await h.axe('dialog[aria-label="Command palette"]', { label: 'command palette' })
  await h.assert('axe: no serious or critical violation in the palette', { ok: pal.filter((v) => v.impact === 'serious' || v.impact === 'critical').length === 0, detail: pal.map((v) => v.id).join(', ') })

  await h.type('logbook', { delay: 25 })
  await h.wait(150)
  p = await palette(page)
  await h.assert('"logbook" puts the Logbook list first', { ok: p.selected === 0 && /^Logbook/.test(p.options[0] ?? ''), detail: JSON.stringify(p.options) })
  await h.key('Enter')
  await h.wait(700)
  p = await palette(page)
  const hash = await page.evaluate(() => location.hash)
  await h.assert('Enter goes to Logbook and closes the palette', { ok: !p.open && /#\/logbook/.test(hash), detail: `${hash} ${JSON.stringify(p)}` })

  // ---- D. Toggle theme ---------------------------------------------------------------------
  await h.goto('/today')
  const isDark = () => page.evaluate(() => document.documentElement.classList.contains('dark'))
  const before = await isDark()
  await h.key('Control+Shift+P')
  await h.wait(300)
  await h.type('toggle theme', { delay: 20 })
  await h.key('Enter')
  await h.wait(500)
  await h.assert('Toggle theme flips the theme', async () => (await isDark()) !== before)
  await h.key('Control+Shift+P')
  await h.wait(300)
  await h.type('toggle theme', { delay: 20 })
  await h.key('Enter')
  await h.wait(500)
  await h.assert('and flips it back', async () => (await isDark()) === before)

  // ---- E. Escape closes the palette and returns focus --------------------------------------
  await h.goto('/today')
  const target = h.rows().first()
  await target.focus()
  const targetId = await target.getAttribute('data-task-id')
  await h.key('Control+Shift+P')
  await h.wait(300)
  await h.key('Escape')
  await h.wait(300)
  p = await palette(page)
  await h.assert('Escape closes the palette', !p.open)
  await h.assert('focus returns to the row that had it', await page.evaluate((id) => document.activeElement?.closest(`[data-task-id="${id}"]`) != null, targetId))
}
