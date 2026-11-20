// sidebar-hidden-lists: the smart lists Settings → General → Sidebar takes out of the sidebar.
//
//   A. With nothing hidden the sidebar lists every smart list that is on, the Inbox first.
//   B. The Sidebar card offers each of them but the Inbox; unticking Logbook and Anytime saves
//      sidebar_hidden_lists and the sidebar leaves them out at once.
//   C. A hidden list keeps working: the command palette still lists it and opens it.
//   D. Ticking them again brings them back in their places.
//   E. In the default order the Logbook has its own row at the bottom of the sidebar, outside the
//      part that scrolls (sidebar-arrange covers moving it).
export const meta = {
  id: 'hidden-lists',
  wave: null,
  title: 'Sidebar: smart lists hidden in Settings leave the sidebar, stay in the palette and come back',
}

/** The names of the sidebar's smart lists, without their counts: the lists on top, then the Logbook's row at the bottom. */
const sidebarLists = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('aside [data-sidebar-lists] button')].map((b) =>
      (b.textContent ?? '').replace(/\d+$/, '').trim()))

/** The name of the sidebar navigation that holds the Logbook: "Lists" on top, "More lists" at the bottom. */
const logbookNav = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('aside nav')]
      .find((nav) => [...nav.querySelectorAll('button')].some((b) => (b.textContent ?? '').trim() === 'Logbook'))
      ?.getAttribute('aria-label') ?? null)

const savedHidden = (page) => page.evaluate(async () => (await window.api.getConfig())?.sidebar_hidden_lists ?? null)

export default async function run(h) {
  const page = h.page
  const openGeneral = async () => {
    await page.getByRole('navigation', { name: 'Settings' }).getByRole('button', { name: 'General', exact: true }).click()
    await h.wait(400)
  }
  await h.resize(1280, 820)
  await page.evaluate(() => window.api.saveConfigPatch({ sidebar_hidden_lists: [], sidebar_order: [] }))
  await h.goto('/today')
  await h.wait(800)

  // ---- A. Nothing hidden ----------------------------------------------------------------------
  const all = await sidebarLists(page)
  await h.assert('with nothing hidden the sidebar lists the Inbox, Today, Upcoming, Anytime and Logbook', {
    ok: all[0] === 'Inbox' && ['Today', 'Upcoming', 'Anytime', 'Logbook'].every((n) => all.includes(n)),
    detail: JSON.stringify(all),
  })

  // ---- B. Hide two in Settings ----------------------------------------------------------------
  await h.goto('/settings')
  await h.wait(600)
  // Settings opens on the tab that was open last (settings-menu leaves another one open).
  await openGeneral()
  const card = page.locator('div.rounded-card', { has: page.locator('h2', { hasText: /^Sidebar$/ }) })
  await card.scrollIntoViewIfNeeded()
  const offered = await card.locator('label').allInnerTexts()
  await h.assert('the Sidebar card offers every list but the Inbox', {
    ok: !offered.includes('Inbox') && ['Today', 'Upcoming', 'Anytime', 'Logbook'].every((n) => offered.includes(n)),
    detail: JSON.stringify(offered),
  })
  await card.getByLabel('Logbook', { exact: true }).uncheck()
  await card.getByLabel('Anytime', { exact: true }).uncheck()
  await h.wait(600)
  await h.capture('settings-sidebar', { clip: card })
  await h.assert('the choice is saved as sidebar_hidden_lists', async () => {
    const saved = await savedHidden(page)
    return { ok: JSON.stringify(saved) === JSON.stringify(['anytime', 'logbook']), detail: JSON.stringify(saved) }
  })
  const hidden = await sidebarLists(page)
  await h.assert('the sidebar leaves Logbook and Anytime out at once', {
    ok: !hidden.includes('Logbook') && !hidden.includes('Anytime') && hidden.includes('Today') && hidden[0] === 'Inbox',
    detail: JSON.stringify(hidden),
  })
  await h.capture('sidebar-hidden', { clip: page.locator('aside').first() })
  const axe = await h.axe('aside nav[aria-label="Lists"]', { label: 'smart lists' })
  await h.assert('axe: no serious or critical violation in the smart lists', {
    ok: axe.filter((v) => v.impact === 'serious' || v.impact === 'critical').length === 0,
    detail: axe.map((v) => v.id).join(', '),
  })

  // ---- C. The palette still has them (it shows a few entries until something is typed) -----------
  const paletteOptions = () => page.evaluate(() =>
    [...document.querySelectorAll('dialog[aria-label="Command palette"] [role="option"]')].map((o) => (o.textContent ?? '').trim()))
  await h.key('Control+Shift+P')
  await h.wait(350)
  await h.type('Anytime')
  await h.wait(200)
  const anytime = await paletteOptions()
  await h.assert('the command palette still finds Anytime', { ok: anytime.some((o) => o.startsWith('Anytime')), detail: JSON.stringify(anytime) })
  await h.key('Escape')
  await h.wait(300)
  await h.key('Control+Shift+P')
  await h.wait(350)
  await h.type('Logbook')
  await h.wait(200)
  const logbook = await paletteOptions()
  await h.assert('the command palette still finds Logbook', { ok: logbook.some((o) => o.startsWith('Logbook')), detail: JSON.stringify(logbook) })
  await h.key('Enter')
  await h.wait(600)
  await h.assert('choosing Logbook there opens it', async () => {
    const hash = await page.evaluate(() => location.hash)
    return { ok: hash.includes('/logbook'), detail: hash }
  })

  // ---- D. Show them again ---------------------------------------------------------------------
  await h.goto('/settings')
  await h.wait(600)
  // Settings opens on the tab that was open last (settings-menu leaves another one open).
  await openGeneral()
  await card.scrollIntoViewIfNeeded()
  await card.getByLabel('Logbook', { exact: true }).check()
  await card.getByLabel('Anytime', { exact: true }).check()
  await h.wait(600)
  const back = await sidebarLists(page)
  await h.assert('ticked again, both come back in their places', {
    ok: JSON.stringify(back) === JSON.stringify(all),
    detail: JSON.stringify(back),
  })
  await h.assert('nothing is left hidden', async () => {
    const saved = await savedHidden(page)
    return { ok: Array.isArray(saved) && saved.length === 0, detail: JSON.stringify(saved) }
  })

  // ---- E. The Logbook's place -----------------------------------------------------------------
  await h.assert('the Logbook has its own row at the bottom, after the scrolling part', async () => {
    const nav = await logbookNav(page)
    // The row is outside the part that scrolls (so it is always in view) and comes after it.
    const below = await page.evaluate(() => {
      const row = document.querySelector('aside nav[aria-label="More lists"]')
      const lists = document.querySelector('aside nav[aria-label="Lists"]')
      const scroller = lists?.parentElement
      if (!row || !scroller) return false
      const after = (scroller.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
      return after && !scroller.contains(row) && row.getBoundingClientRect().top >= scroller.getBoundingClientRect().bottom - 1
    })
    return { ok: nav === 'More lists' && below, detail: `${nav}, under the scrolling part: ${below}` }
  })
  await h.capture('sidebar-logbook-bottom', { clip: page.locator('aside').first() })
}
