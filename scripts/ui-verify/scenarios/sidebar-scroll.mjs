// sidebar-scroll: with Pro on in a short window the whole sidebar between search and the footer
// scrolls as one, and the wheel over the smart lists moves it (the checks are in _sidebar-scroll.mjs,
// shared with the web harness). Pro is turned off again at the end.
import { sidebarScroll, sidebarScrollChecks } from './_sidebar-scroll.mjs'

export const meta = {
  id: 'sidebar-scroll',
  wave: null,
  title: 'Sidebar: with Pro on in a short window the smart lists, Pro and projects scroll as one',
}

export default async function run(h) {
  const page = h.page
  await h.dismiss()
  try {
    await page.evaluate(() => window.api.saveConfigPatch({ pro_enabled: true, pro_onboarding_seen: true }))
    await page.reload()
    await h.wait(1200)
    await h.resize(1280, 560)
    await h.goto('/today')
    await h.wait(800)
    const facts = await sidebarScroll(page)
    for (const [name, ok, detail] of sidebarScrollChecks(facts)) await h.assert(name, { ok, detail })
    await page.mouse.wheel(0, 250)
    await h.wait(300)
    await h.capture('pro-short-window-scrolled')
  } finally {
    await page.evaluate(() => window.api.saveConfigPatch({ pro_enabled: false })).catch(() => {})
    await page.reload().catch(() => {})
    await h.wait(800)
  }
}
