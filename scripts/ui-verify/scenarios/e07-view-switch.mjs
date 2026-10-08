// E7 (card 4.6): changing views.
//
//   A. Today to Upcoming by mouse (full motion): a page transition runs; only the content region
//      (and the sidebar pill) animate, the root does not, so the sidebar and title bar stay; the old
//      page fades out (90 ms), the new one fades in (210 ms) with a rise of at most 6 px; a frozen
//      mid-transition frame differs from both ends; nothing is left behind.
//   B. By keyboard (Enter on a sidebar item): instant, no transition. A mouse click afterwards
//      animates again.
//   C. A task morph (card 4.4) and a navigation do not break each other: opening a card and going
//      straight to another view, and clicking a row in the middle of a view change.
//   D. --motion reduce (emulated for this part): the same switch is a cross-fade only, no rise.
import { keyboardSwitch, leftovers, mouseSwitch } from './_view-switch.mjs'

export const meta = {
  id: 'E7',
  wave: 4,
  title: 'Today to Upcoming by mouse, then by keyboard: cross-fade with a rise, sidebar pill slides, keyboard switch instant',
}

export default async function run(h) {
  const page = h.page
  await h.resize(1280, 820)
  await h.setMotion('full')

  await h.startMotionAudit()
  await mouseSwitch(h, page, { full: true })
  const fullAudit = await h.stopMotionAudit()
  // The control for the reduced-motion audits of E3 and E11: with full motion the same audit sees the rise.
  await h.assert('full motion: the motion audit sees the page rise and the pill slide (the reduced-motion audits can find a moving animation)', {
    ok: fullAudit.moving.length > 0,
    detail: `${fullAudit.seen} animations seen; ${JSON.stringify(fullAudit.moving.slice(0, 3))}`,
  })
  await keyboardSwitch(h, page)

  // ---- C. Task morph and navigation ----------------------------------------------------------
  await h.dismiss()
  await h.goto('/today')
  await h.wait(400)
  const first = h.rows().first()
  await first.click({ position: { x: 180, y: 12 } })
  await page.locator('aside nav[aria-label="Lists"] button', { hasText: 'Upcoming' }).first().click()
  await h.wait(1300)
  let s = await leftovers(page)
  await h.assert('C: opening a card and going straight to another view leaves the new view with nothing left over', {
    ok: /upcoming/.test(s.route) && !s.active && s.mainName === 'none' && s.taskNames === 0 && s.attr === null,
    detail: JSON.stringify(s),
  })
  await h.dismiss()
  await h.wait(400)

  await page.locator('aside nav[aria-label="Lists"] button', { hasText: 'Anytime' }).first().click()
  await h.wait(120)
  const row = h.rows().first()
  await row.click({ position: { x: 180, y: 12 } })
  await h.wait(1300)
  s = await leftovers(page)
  const cards = await page.locator('.vicu-card').count()
  await h.assert('C: a row clicked in the middle of a view change still opens its card and nothing is left over', {
    ok: /anytime/.test(s.route) && cards === 1 && !s.active && s.mainName === 'none' && s.taskNames === 0 && s.attr === null,
    detail: JSON.stringify({ ...s, cards }),
  })
  await h.dismiss()

  // ---- D. Reduced motion ---------------------------------------------------------------------
  await h.setMotion('reduce')
  await h.assert('prefers-reduced-motion is emulated as reduce', () => page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches))
  await mouseSwitch(h, page, { full: false })
  await h.setMotion('full')
  await h.dismiss()
}
