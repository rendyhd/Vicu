// sidebar-arrange: Settings → General → Sidebar is one list, dragged into the person's order.
//
//   A. The default: the smart lists, the three blocks, the Logbook last. The Logbook's row says it
//      stays in view, and the sidebar draws it under the part that scrolls. No Reset order yet.
//   B. Move up (the keyboard's way) takes the Logbook back among the lists: it scrolls with them,
//      nothing is left at the bottom, sidebar_order is saved and Reset order appears.
//   C. A drag by the grip puts the Projects block first: the sidebar draws it above the lists.
//   D. A drag puts Today under Labels: it stays in view at the bottom, with its count.
//   E. The order is still there after a reload.
//   F. Reset order brings the default back.
// Puts the default order back at the end.
export const meta = {
  id: 'arrange',
  wave: null,
  title: 'Sidebar: the lists and blocks are dragged into an order of your own, and it stays',
}

/** The sidebar top to bottom: each stretch of smart lists and each block, by what it shows first. */
const sidebarLayout = (page) =>
  page.evaluate(() => {
    const aside = document.querySelector('aside')
    const scroller = aside?.querySelector('.overflow-y-auto')
    const read = (el) => {
      if (el.matches('[data-sidebar-lists]')) return [...el.querySelectorAll('button')].map((b) => (b.textContent ?? '').replace(/\d+$/, '').trim()).join(',')
      const header = [...el.querySelectorAll('span')].find((s) => ['Projects', 'Lists', 'Labels'].includes((s.textContent ?? '').trim()))
      return header ? `[${header.textContent.trim()}]` : null
    }
    const scrolling = scroller ? [...scroller.children].map(read).filter(Boolean) : []
    const pinned = [...(aside?.querySelectorAll('[data-sidebar-lists]') ?? [])].filter((el) => !scroller?.contains(el)).map(read)
    return { scrolling, pinned }
  })

export default async function run(h) {
  const page = h.page
  const card = page.locator('div.rounded-card', { has: page.locator('h2', { hasText: /^Sidebar$/ }) })
  const rows = () => page.evaluate(() => [...document.querySelectorAll('[data-sidebar-arrange] [data-sidebar-entry]')].map((row) => row.getAttribute('data-sidebar-entry')))
  const row = (entry) => card.locator(`[data-sidebar-entry="${entry}"]`)
  const grip = (entry) => row(entry).locator('button[aria-hidden="true"]').first()
  const saved = () => page.evaluate(async () => (await window.api.getConfig())?.sidebar_order ?? null)
  const openGeneral = async () => {
    await h.goto('/settings')
    await h.wait(600)
    // Settings opens on the tab that was open last.
    await page.getByRole('navigation', { name: 'Settings' }).getByRole('button', { name: 'General', exact: true }).click()
    await h.wait(400)
    await card.scrollIntoViewIfNeeded()
  }

  await h.resize(1280, 820)
  try {
    await page.evaluate(() => window.api.saveConfigPatch({ sidebar_order: [], sidebar_hidden_lists: [], pro_enabled: false }))
    await page.reload()
    await h.wait(1200)
    await openGeneral()

    // ---- A. The default -------------------------------------------------------------------------
    const first = await rows()
    await h.assert('A: Settings lists the smart lists, the three blocks and the Logbook last', {
      ok: first[0] === 'inbox' && first.at(-1) === 'logbook' && first.slice(-4, -1).join() === 'projects,lists,labels',
      detail: JSON.stringify(first),
    })
    await h.assert('A: only the Logbook says it stays in view at the bottom', async () => {
      const notes = await card.locator('[data-sidebar-entry]', { hasText: 'Stays in view at the bottom' }).evaluateAll((els) => els.map((el) => el.getAttribute('data-sidebar-entry')))
      return { ok: notes.join() === 'logbook', detail: notes.join() }
    })
    await h.assert('A: the Inbox and the blocks have no checkbox, every other list has one', async () => {
      const boxes = await card.locator('[data-sidebar-entry]').evaluateAll((els) => els.filter((el) => el.querySelector('input[type="checkbox"]')).map((el) => el.getAttribute('data-sidebar-entry')))
      return { ok: !boxes.includes('inbox') && !boxes.includes('projects') && boxes.includes('today') && boxes.includes('logbook'), detail: boxes.join() }
    })
    const defaultLayout = await sidebarLayout(page)
    await h.assert('A: the sidebar draws the lists, the blocks, and the Logbook under the scrolling part', {
      ok: defaultLayout.scrolling.slice(1).join() === '[Projects],[Lists],[Labels]' && defaultLayout.scrolling[0].startsWith('Inbox,') && defaultLayout.pinned.join() === 'Logbook',
      detail: JSON.stringify(defaultLayout),
    })
    await h.assert('A: there is no Reset order while the order is the default', (await card.getByRole('button', { name: 'Reset order' }).count()) === 0)
    await h.capture('settings-default', { clip: card })

    // ---- B. Move up from the keyboard -------------------------------------------------------------
    const up = card.getByRole('button', { name: 'Move Logbook up' })
    await up.focus()
    for (let i = 0; i < 3; i++) {
      await h.key('Enter')
      await h.wait(250)
    }
    await h.wait(300)
    const afterKeys = await rows()
    await h.assert('B: three times Move up puts the Logbook above the Projects block', {
      ok: afterKeys.indexOf('logbook') === afterKeys.indexOf('projects') - 1,
      detail: JSON.stringify(afterKeys),
    })
    await h.assert('B: the focus stays on its Move up button', async () => {
      const label = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '')
      return { ok: label === 'Move Logbook up', detail: label }
    })
    await h.assert('B: the Logbook scrolls with the other lists and nothing is left at the bottom', async () => {
      const layout = await sidebarLayout(page)
      return { ok: layout.scrolling[0].endsWith(',Logbook') && layout.pinned.length === 0, detail: JSON.stringify(layout) }
    })
    await h.assert('B: the order is saved as sidebar_order', async () => {
      const order = await saved()
      return { ok: Array.isArray(order) && order.indexOf('logbook') < order.indexOf('projects') && order.includes('plan') && order.includes('pro'), detail: JSON.stringify(order) }
    })
    await h.assert('B: Reset order is offered now', (await card.getByRole('button', { name: 'Reset order' }).count()) === 1)

    // ---- C. Drag the Projects block to the top ----------------------------------------------------
    await h.drag(grip('projects'), row('inbox'), { steps: 20 })
    await h.wait(700)
    const afterDrag = await rows()
    await h.assert('C: dragged by its grip onto the first row, Projects is first', { ok: afterDrag[0] === 'projects', detail: JSON.stringify(afterDrag) })
    await h.assert('C: the sidebar draws the projects above the lists', async () => {
      const layout = await sidebarLayout(page)
      return { ok: layout.scrolling[0] === '[Projects]' && layout.scrolling[1].startsWith('Inbox,'), detail: JSON.stringify(layout) }
    })

    // ---- D. Drag Today under Labels ---------------------------------------------------------------
    await h.drag(grip('today'), row('labels'), { steps: 24 })
    await h.wait(700)
    const afterToday = await rows()
    await h.assert('D: dragged onto the last row, Today is under Labels', { ok: afterToday.at(-1) === 'today' && afterToday.at(-2) === 'labels', detail: JSON.stringify(afterToday) })
    await h.assert('D: Today stays in view at the bottom of the sidebar, with its count', async () => {
      const layout = await sidebarLayout(page)
      const count = await page.evaluate(() => document.querySelector('aside nav[aria-label="More lists"] [data-rolling-count]')?.textContent?.trim() ?? null)
      return { ok: layout.pinned.join() === 'Today' && !layout.scrolling.join().includes('Today') && !!count, detail: `${JSON.stringify(layout)} count ${count}` }
    })
    await h.capture('settings-arranged', { clip: card })
    await h.capture('sidebar-arranged', { clip: page.locator('aside').first() })
    const axe = await h.axe('[data-sidebar-arrange]', { label: 'the arrangement list' })
    await h.assert('D: axe finds no serious or critical violation in the list', {
      ok: axe.filter((v) => v.impact === 'serious' || v.impact === 'critical').length === 0,
      detail: axe.map((v) => v.id).join(', '),
    })
    await page.locator('aside nav[aria-label="More lists"] button', { hasText: 'Today' }).click()
    await h.wait(600)
    await h.assert('D: the row at the bottom opens Today', async () => {
      const hash = await page.evaluate(() => location.hash)
      return { ok: hash.includes('/today'), detail: hash }
    })

    // ---- E. Still there after a reload ------------------------------------------------------------
    const before = await sidebarLayout(page)
    await page.reload()
    await h.wait(1500)
    await h.assert('E: the sidebar is in the same order after a reload', async () => {
      const layout = await sidebarLayout(page)
      return { ok: JSON.stringify(layout) === JSON.stringify(before), detail: JSON.stringify(layout) }
    })

    // ---- F. Reset ---------------------------------------------------------------------------------
    await openGeneral()
    await card.getByRole('button', { name: 'Reset order' }).click()
    await h.wait(600)
    await h.assert('F: Reset order brings the default back in Settings and in the sidebar', async () => {
      const list = await rows()
      const layout = await sidebarLayout(page)
      const order = await saved()
      return {
        ok: JSON.stringify(list) === JSON.stringify(first) && JSON.stringify(layout) === JSON.stringify(defaultLayout) && Array.isArray(order) && order.length === 0,
        detail: `${JSON.stringify(list)} ${JSON.stringify(layout)} ${JSON.stringify(order)}`,
      }
    })
    await h.assert('F: Reset order is gone again', (await card.getByRole('button', { name: 'Reset order' }).count()) === 0)
  } finally {
    await page.evaluate(() => window.api.saveConfigPatch({ sidebar_order: [] })).catch(() => {})
  }
}
