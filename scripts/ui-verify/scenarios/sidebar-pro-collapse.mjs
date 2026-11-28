// sidebar-pro-collapse: Pro's sidebar section folds to its header.
//
//   A. With Pro on the section has a header, open, with Pro's lists under it.
//   B. A click on the header folds it: the lists leave the sidebar, sidebar_pro_collapsed is saved,
//      and the command palette still opens a Pro list.
//   C. It stays folded after a reload, and a click opens it again.
//   D. The keyboard does the same (Enter on the header).
// Turns Pro off and opens the section again at the end.
export const meta = {
  id: 'pro-collapse',
  wave: null,
  title: 'Sidebar: the Pro section folds to its header and stays that way',
}

export default async function run(h) {
  const page = h.page
  const section = () => page.locator('aside [data-pro-nav]')
  const header = () => section().getByRole('button', { name: 'Pro', exact: true })
  const lists = () => page.locator('aside nav[aria-label="Pro"] button')
  const saved = () => page.evaluate(async () => (await window.api.getConfig())?.sidebar_pro_collapsed ?? null)
  const reload = async () => {
    await page.reload()
    await h.wait(1200)
    await h.goto('/today')
    await h.wait(600)
  }

  await h.resize(1280, 820)
  try {
    await page.evaluate(() => window.api.saveConfigPatch({ pro_enabled: true, pro_onboarding_seen: true, sidebar_pro_collapsed: false }))
    await reload()

    // ---- A. Open ------------------------------------------------------------------------------
    await header().waitFor({ timeout: 5000 }).catch(() => {})
    await h.assert('A: the Pro section has a header that says it is open', async () => {
      const expanded = await header().getAttribute('aria-expanded').catch(() => null)
      return { ok: expanded === 'true', detail: String(expanded) }
    })
    const open = await lists().allInnerTexts()
    await h.assert('A: Pro\'s lists are under it', { ok: open.includes('Flagged') && open.length >= 3, detail: JSON.stringify(open) })
    await h.capture('pro-open', { clip: page.locator('aside').first() })

    // ---- B. Fold ------------------------------------------------------------------------------
    await header().click()
    await h.wait(400)
    await h.assert('B: a click folds the section: no Pro list is left in the sidebar', async () => {
      const count = await lists().count()
      const expanded = await header().getAttribute('aria-expanded')
      return { ok: count === 0 && expanded === 'false', detail: `${count} lists, aria-expanded ${expanded}` }
    })
    await h.assert('B: the choice is saved as sidebar_pro_collapsed', async () => {
      const value = await saved()
      return { ok: value === true, detail: String(value) }
    })
    await h.capture('pro-folded', { clip: page.locator('aside').first() })
    const axe = await h.axe('aside [data-pro-nav]', { label: 'Pro section, folded' })
    await h.assert('B: axe finds no serious or critical violation in the folded section', {
      ok: axe.filter((v) => v.impact === 'serious' || v.impact === 'critical').length === 0,
      detail: axe.map((v) => v.id).join(', '),
    })
    await h.key('Control+Shift+P')
    await h.wait(350)
    await h.type('Flagged')
    await h.wait(250)
    await h.key('Enter')
    await h.wait(700)
    await h.assert('B: the command palette still opens Flagged', async () => {
      const hash = await page.evaluate(() => location.hash)
      return { ok: hash.includes('/flagged'), detail: hash }
    })

    // ---- C. Stays folded, opens again -------------------------------------------------------------
    await reload()
    await header().waitFor({ timeout: 5000 }).catch(() => {})
    await h.assert('C: it is still folded after a reload', async () => {
      const count = await lists().count()
      return { ok: count === 0 && (await header().getAttribute('aria-expanded')) === 'false', detail: `${count} lists` }
    })
    await header().click()
    await h.wait(400)
    const again = await lists().allInnerTexts()
    await h.assert('C: a click opens it again with the same lists', { ok: JSON.stringify(again) === JSON.stringify(open), detail: JSON.stringify(again) })

    // ---- D. Keyboard ------------------------------------------------------------------------------
    await header().focus()
    await h.key('Enter')
    await h.wait(400)
    await h.assert('D: Enter on the header folds it and keeps the focus there', async () => {
      const count = await lists().count()
      const focused = await page.evaluate(() => document.activeElement?.closest('[data-pro-nav]') != null && document.activeElement?.getAttribute('aria-expanded'))
      return { ok: count === 0 && focused === 'false', detail: `${count} lists, focus ${focused}` }
    })
  } finally {
    await page.evaluate(() => window.api.saveConfigPatch({ pro_enabled: false, sidebar_pro_collapsed: false })).catch(() => {})
  }
}
