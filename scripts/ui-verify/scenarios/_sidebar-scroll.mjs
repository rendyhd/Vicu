// Shared by the desktop scenario sidebar-scroll and the web harness (web.mjs): with Pro on in a short
// window the smart lists and Pro's section fill the sidebar's height, so they scroll together with the
// projects, custom lists and labels in one scroller. Before, only the part under Pro's section scrolled
// and was then a few rows tall.

/** Facts about the sidebar's scroller, read with the wheel over the smart lists (real input). */
export async function sidebarScroll(page) {
  const layout = () =>
    page.evaluate(() => {
      const aside = document.querySelector('aside')
      const lists = aside?.querySelector('nav[aria-label="Lists"]')
      const labels = [...(aside?.querySelectorAll('span') ?? [])].find((s) => s.textContent?.trim() === 'Labels')
      const scrollerOf = (el) => {
        for (let n = el?.parentElement; n && n !== aside; n = n.parentElement) {
          const y = getComputedStyle(n).overflowY
          if (y === 'auto' || y === 'scroll') return n
        }
        return null
      }
      const scroller = scrollerOf(lists)
      if (!aside || !lists || !scroller) return null
      scroller.setAttribute('data-harness-sidebar-scroller', '')
      const box = lists.getBoundingClientRect()
      return {
        sameAsLabels: scroller === scrollerOf(labels),
        share: scroller.clientHeight / aside.clientHeight,
        overflows: scroller.scrollHeight > scroller.clientHeight + 1,
        point: { x: box.left + box.width / 2, y: box.top + Math.min(box.height / 2, 60) },
      }
    })
  const facts = await layout()
  if (!facts) return { found: false }
  const scrollTop = () => page.evaluate(() => document.querySelector('[data-harness-sidebar-scroller]').scrollTop)
  await page.evaluate(() => { document.querySelector('[data-harness-sidebar-scroller]').scrollTop = 0 })
  await page.mouse.move(facts.point.x, facts.point.y)
  await page.mouse.wheel(0, 400)
  await page.waitForTimeout(400)
  const wheeled = await scrollTop()
  const end = await page.evaluate(() => {
    const s = document.querySelector('[data-harness-sidebar-scroller]')
    s.scrollTop = s.scrollHeight
    const labels = [...document.querySelectorAll('aside span')].find((x) => x.textContent?.trim() === 'Labels')
    const r = labels?.getBoundingClientRect()
    const b = s.getBoundingClientRect()
    const labelsShown = !!r && r.top >= b.top && r.bottom <= b.bottom
    s.scrollTop = 0
    s.removeAttribute('data-harness-sidebar-scroller')
    return { labelsShown }
  })
  return { found: true, ...facts, wheeled, ...end }
}

/** The assertions both harnesses make, as [name, ok, detail]. */
export function sidebarScrollChecks(facts) {
  const detail = JSON.stringify(facts)
  return [
    ['the sidebar has one scroller that holds the smart lists', facts.found, detail],
    ['the smart lists and the labels scroll together', !!facts.sameAsLabels, detail],
    // Search, the footer and the Logbook's row at the bottom (the default order) are outside it.
    ['the scroller takes most of the sidebar, not a few rows under Pro', (facts.share ?? 0) > 0.65, detail],
    ['in a short window with Pro on the list is longer than the sidebar', !!facts.overflows, detail],
    ['the wheel over the smart lists scrolls the sidebar', (facts.wheeled ?? 0) > 0, detail],
    ['scrolled to the end, the Labels header is in view', !!facts.labelsShown, detail],
  ]
}
