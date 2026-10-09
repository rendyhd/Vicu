// context-menu-keys (card 3.2b, D-18): the task context menu is a real menu.
//
//   A. Shift+F10 on a focused row opens a menu named "Task actions" inside the window, with focus
//      on its first item.
//   B. Arrows, Home, End and type-ahead move focus between items; priority items are radios and
//      the current one is checked; only real shortcuts are shown; the icon column lines labels up.
//   C. Right opens the Move to project list, Left closes it and returns to the item.
//   D. Tab closes the menu; Escape closes it; Enter on an item chooses it and closes the menu;
//      focus is back on the row each time.
//   E. A right click opens it at the pointer and Escape closes it.
//   F. axe finds nothing serious in the open menu.
//   G. The sidebar tag and project menus: Delete opens a confirmation, and cancelling it returns focus to the row.
export const meta = {
  id: 'CMK',
  wave: 3,
  title: 'Context menu by keyboard: Shift+F10, arrows, type-ahead, radios, submenu keys, Tab/Escape/Enter, focus returns',
}

const menuState = (page) =>
  page.evaluate(() => {
    const menu = document.querySelector('[role="menu"]')
    const active = document.activeElement
    const r = menu?.getBoundingClientRect()
    return {
      open: !!menu && menu.matches(':popover-open'),
      label: menu?.getAttribute('aria-label') ?? null,
      inside: r ? r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight : false,
      box: r ? { x: Math.round(r.x), y: Math.round(r.y), right: Math.round(r.right), bottom: Math.round(r.bottom) } : null,
      activeRole: active?.getAttribute('role') ?? null,
      activeName: (active?.getAttribute('data-typeahead') || active?.textContent || '').trim().slice(0, 40),
      activeInMenu: !!menu && !!active && menu.contains(active),
      activeRow: active?.closest('[data-task-id]')?.getAttribute('data-task-id') ?? null,
    }
  })

export default async function run(h) {
  const page = h.page
  await h.resize(1280, 820)
  await h.goto('/today')

  // The first Today row is "Renew passport" (urgent) in the seed.
  const row = h.rows().first()
  const taskId = await row.getAttribute('data-task-id')
  const rowFocusIs = async () => (await menuState(page)).activeRow === taskId
  const reopen = async () => {
    await page.evaluate((id) => document.querySelector(`[data-task-id="${id}"]`)?.focus(), taskId)
    await h.key('Shift+F10')
    await h.wait(350)
    return menuState(page)
  }

  // ---- A. Open by keyboard -----------------------------------------------------------------
  let s = await reopen()
  if (!s.open) {
    // Some platforms deliver the context menu key instead.
    await page.evaluate((id) => document.querySelector(`[data-task-id="${id}"]`)?.focus(), taskId)
    await h.key('ContextMenu')
    await h.wait(350)
    s = await menuState(page)
  }
  await h.assert('Shift+F10 opens the menu', { ok: s.open, detail: JSON.stringify(s) })
  if (!s.open) return
  await h.assert('the menu is named "Task actions" and sits inside the window', { ok: s.label === 'Task actions' && s.inside, detail: JSON.stringify(s) })
  await h.assert('focus is on the first menu item', { ok: s.activeInMenu && s.activeRole === 'menuitem', detail: JSON.stringify(s) })
  await h.capture('menu')

  // ---- B. Moving, radios, hints ------------------------------------------------------------
  const names = await page.getByRole('menuitem').evaluateAll((els) => els.map((e) => e.getAttribute('data-typeahead')))
  await h.key('ArrowDown')
  s = await menuState(page)
  await h.assert('ArrowDown moves to the second item', { ok: s.activeName === names[1], detail: `${s.activeName} vs ${names[1]}` })
  await h.key('ArrowUp')
  await h.key('ArrowUp')
  s = await menuState(page)
  await h.assert('ArrowUp from the first item wraps to the last (Delete task)', { ok: /^Delete task/.test(s.activeName), detail: s.activeName })
  await h.key('Home')
  s = await menuState(page)
  await h.assert('Home goes to the first item', { ok: s.activeName === names[0], detail: s.activeName })
  await h.key('End')
  s = await menuState(page)
  await h.assert('End goes to the last item', { ok: /^Delete task/.test(s.activeName), detail: s.activeName })
  await h.type('cop', { delay: 40 })
  s = await menuState(page)
  await h.assert('typing "cop" lands on Copy task', { ok: s.activeName === 'Copy task', detail: s.activeName })

  const radios = await page.getByRole('menuitemradio').evaluateAll((els) => els.map((e) => [e.getAttribute('data-typeahead'), e.getAttribute('aria-checked')]))
  await h.assert('four priority radios', { ok: radios.map((r) => r[0]).join() === 'Low,Medium,High,Urgent', detail: JSON.stringify(radios) })
  await h.assert('exactly one is checked and it is Urgent', { ok: radios.filter((r) => r[1] === 'true').length === 1 && radios.find((r) => r[1] === 'true')?.[0] === 'Urgent', detail: JSON.stringify(radios) })

  const layout = await page.evaluate(() => {
    const items = [...document.querySelectorAll('[role="menu"] [role^="menuitem"]')]
    const hints = items.map((i) => [i.getAttribute('data-typeahead'), i.querySelector('kbd')?.textContent ?? null]).filter((x) => x[1])
    const labelXs = [...new Set(items.map((i) => Math.round(i.querySelector('span:nth-of-type(2)')?.getBoundingClientRect().x ?? -1)))]
    const iconMarks = items.filter((i) => !i.querySelector('span[aria-hidden="true"]')).length
    const rightEdges = [...new Set(items.filter((i) => i.querySelector('kbd')).map((i) => Math.round(i.querySelector('kbd').getBoundingClientRect().right)))]
    return { hints, labelXs, iconMarks, rightEdges }
  })
  await h.assert('only Set Today, Copy, Complete and Delete show a shortcut', {
    ok: layout.hints.map((x) => x[0]).join('|') === 'Set Today|Copy task|Complete task|Delete task',
    detail: JSON.stringify(layout.hints),
  })
  await h.assert('every item has the icon column, so all labels start at one x', { ok: layout.iconMarks === 0 && layout.labelXs.length === 1, detail: JSON.stringify(layout) })
  await h.assert('shortcut hints share one right edge', { ok: layout.rightEdges.length === 1, detail: JSON.stringify(layout.rightEdges) })
  await h.capture('menu-copy-focus')

  // ---- C. Submenu keys ---------------------------------------------------------------------
  await h.wait(900) // a pause starts a new search
  await h.type('move to p', { delay: 40 })
  s = await menuState(page)
  await h.assert('typing "move to p" lands on Move to project', { ok: s.activeName === 'Move to project…', detail: s.activeName })
  await h.key('ArrowRight')
  await h.wait(450)
  const listbox = await page.evaluate(() => {
    const lb = document.querySelector('[role="menu"] [role="listbox"]')
    return { open: !!lb && lb.matches(':popover-open'), focusInside: !!lb && lb.contains(document.activeElement) }
  })
  await h.assert('ArrowRight opens the project list and focus enters it', { ok: listbox.open && listbox.focusInside, detail: JSON.stringify(listbox) })
  await h.key('ArrowLeft')
  await h.wait(350)
  s = await menuState(page)
  const closedList = await page.evaluate(() => !document.querySelector('[role="menu"] [role="listbox"]'))
  await h.assert('ArrowLeft closes the list and focus returns to Move to project', { ok: closedList && s.open && s.activeName === 'Move to project…', detail: JSON.stringify({ closedList, ...s }) })

  // ---- D. Tab, Escape, Enter ---------------------------------------------------------------
  await h.key('Tab')
  await h.wait(300)
  s = await menuState(page)
  await h.assert('Tab closes the menu', { ok: !s.open, detail: JSON.stringify(s) })
  await h.assert('focus is back on the row after Tab', await rowFocusIs())

  s = await reopen()
  await h.key('Escape')
  await h.wait(300)
  s = await menuState(page)
  await h.assert('Escape closes the menu', { ok: !s.open, detail: JSON.stringify(s) })
  await h.assert('focus is back on the row after Escape', await rowFocusIs())
  await h.assert('the row is not collapsed or deselected by that Escape', async () => (await h.rows().count()) > 0)

  await reopen()
  await h.type('cop', { delay: 40 })
  await h.key('Enter')
  await h.wait(400)
  s = await menuState(page)
  await h.assert('Enter on Copy task chooses it and closes the menu', { ok: !s.open, detail: JSON.stringify(s) })
  await h.assert('focus is back on the row after a choice', await rowFocusIs())

  // ---- E. Right click ----------------------------------------------------------------------
  await h.dismiss()
  await h.goto('/today')
  const box = await h.rows().nth(1).boundingBox()
  const px = Math.round(box.x + 200)
  const py = Math.round(box.y + 10)
  await page.mouse.click(px, py, { button: 'right' })
  await h.wait(400)
  s = await menuState(page)
  await h.assert('a right click opens the menu at the pointer', {
    ok: s.open && !!s.box && Math.abs(s.box.x - px) <= 12 && Math.abs(s.box.y - py) <= 12,
    detail: JSON.stringify({ px, py, ...s }),
  })
  await h.assert('focus is on its first item', { ok: s.activeInMenu && s.activeRole === 'menuitem', detail: JSON.stringify(s) })

  // ---- F. axe ------------------------------------------------------------------------------
  const found = await h.axe('[role="menu"]', { label: 'context menu' })
  await h.assert('axe finds no serious or critical violation in the menu', {
    ok: found.filter((v) => v.impact === 'serious' || v.impact === 'critical').length === 0,
    detail: found.map((v) => v.id).join(', '),
  })
  await h.key('Escape')
  await h.wait(300)
  await h.assert('Escape closes it', async () => !(await menuState(page)).open)

  // ---- G. Sidebar menus: the confirmation gives focus back to the row ---------------------
  await h.dismiss()
  // The harness profile turns the delete confirmation off, which would make Delete real here: turn it
  // on for this section (the dialog reads it at start-up, so reload), and cancel every dialog.
  await page.evaluate(() => window.api.saveConfigPatch({ confirm_before_delete: true }))
  await page.reload()
  await h.goto('/today')
  await h.wait(800)
  const focusedLabel = () =>
    page.evaluate(() => {
      const a = document.activeElement
      return a ? (a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 40) : null
    })
  for (const [kind, rows] of [
    ['tag', page.locator('button:has(> span[class*="h-2.5"][class*="rounded-full"])')],
    ['project', page.locator('[role="button"][tabindex="0"]', { hasText: 'Personal' })],
  ]) {
    const row = rows.first()
    if (!(await row.count())) {
      h.emit({ t: 'skip', id: 'CMK', message: `no sidebar ${kind} row found for the confirmation focus check` })
      continue
    }
    const name = ((await row.textContent()) ?? '').trim()
    await row.click({ button: 'right' })
    await h.wait(300)
    s = await menuState(page)
    await h.assert(`the sidebar ${kind} menu is a menu named for the row, inside the window, with focus on its first item`, {
      ok: s.open && /actions$/.test(s.label ?? '') && s.inside && s.activeInMenu && s.activeRole === 'menuitem',
      detail: JSON.stringify(s),
    })
    await h.key('ArrowDown')
    s = await menuState(page)
    await h.assert(`ArrowDown moves inside the sidebar ${kind} menu`, { ok: s.activeInMenu && s.activeName !== '' && s.activeName !== 'Edit', detail: JSON.stringify(s) })
    await h.key('Escape')
    await h.wait(300)
    s = await menuState(page)
    const afterEscape = await focusedLabel()
    await h.assert(`Escape closes the sidebar ${kind} menu and focus returns to the row`, { ok: !s.open && !!afterEscape && afterEscape.includes(name.slice(0, 10)), detail: String(afterEscape) })
    await row.click({ button: 'right' })
    await h.wait(300)
    await page.locator('[role="menu"] [role="menuitem"]', { hasText: 'Delete' }).first().click()
    await h.wait(300)
    const dialogOpen = await page.evaluate(() => !!document.querySelector('dialog[open][role="alertdialog"]'))
    await h.assert(`the sidebar ${kind} Delete opens a confirmation`, dialogOpen)
    await h.key('Escape')
    await h.wait(300)
    const back = await focusedLabel()
    await h.assert(`cancelling it returns focus to the ${kind} row (${name})`, { ok: !!back && back.includes(name.slice(0, 10)), detail: String(back) })
  }
  await page.evaluate(() => window.api.saveConfigPatch({ confirm_before_delete: false }))
}
