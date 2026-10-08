// E3 (card 4.4): opening and closing a task morphs the row into the card.
//
//   Full motion (the harness default):
//     A. Click a row: a view transition runs (html[data-task-transition="morph"], a group named
//        task-<id>), the group's height passes through values between the row's and the card's, and
//        ends with one card. A mid-transition frame (the transition's animations paused at 30
//        percent) is captured and differs from the closed and the open captures.
//     B. Click a second row: the first card closes as the second opens (both groups exist in one
//        transition), and only the second card is left.
//     C. Focus a third row and press Enter: it opens, the second closes.
//     D. Latest wins: two clicks 40 ms apart leave only the second row's card; after a short wait no
//        transition attribute and no view-transition-name is left on the page.
//        (that second click is on the card, not the row, so it does not toggle).
//   --motion reduce (emulated for the rest of the scenario): no view transition at all, no
//   transform or scale on the card, the card fades in over fade.fast, and the end state is the same.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

export const meta = {
  id: 'E3',
  wave: 4,
  title: 'Click a row, then another; Enter on a third: the row grows into the card, the first card closes as the second opens',
}

const hash = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')

/**
 * Starts a requestAnimationFrame sampler and returns at once. Per frame it records the page's
 * transition attribute, the names of the view-transition groups that are animating, the height of
 * the group of task `watch`, and the opacity, transform and scale of the open card. With `freeze`
 * the transition's animations are paused at 30 percent on the first frame they exist.
 */
async function startSampler(page, { watch, freeze = false }) {
  await page.evaluate(
    ({ watch, freeze }) => {
      const state = { samples: [], frozen: null, anims: [] }
      window.__e3 = state
      const end = performance.now() + 3000
      const tick = () => {
        const html = document.documentElement
        const anims = document.getAnimations().filter((a) => a.effect && a.effect.pseudoElement && a.effect.pseudoElement.startsWith('::view-transition'))
        const groups = [...new Set(anims.map((a) => a.effect.pseudoElement).filter((n) => n.startsWith('::view-transition-group(task-')))]
        const groupStyle = watch == null ? null : getComputedStyle(html, `::view-transition-group(task-${watch})`)
        const card = document.querySelector('.vicu-card')
        const cs = card ? getComputedStyle(card) : null
        if (freeze && !state.frozen && groups.length > 0) {
          for (const a of anims) {
            const duration = Number(a.effect.getComputedTiming().duration)
            a.pause()
            a.currentTime = 0.3 * duration
          }
          state.anims = anims
          const heights = {}
          for (const name of groups) heights[name] = parseFloat(getComputedStyle(html, name).height)
          state.frozen = { groups, heights, attr: html.getAttribute('data-task-transition') }
          return
        }
        state.samples.push({
          t: performance.now(),
          attr: html.getAttribute('data-task-transition'),
          vtAnims: anims.length,
          groups,
          groupHeight: groupStyle ? parseFloat(groupStyle.height) : null,
          cardOpacity: cs ? Number(cs.opacity) : null,
          cardTransform: cs ? cs.transform : null,
          cardScale: cs ? cs.scale : null,
          cardAnimation: cs ? cs.animationName : null,
        })
        if (performance.now() < end) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    },
    { watch, freeze },
  )
}

const readSampler = (page) => page.evaluate(() => window.__e3)
const release = (page) => page.evaluate(() => (window.__e3?.anims ?? []).forEach((a) => a.play()))

/** What is open and what is left over from a transition. */
const openState = (page) =>
  page.evaluate(() => ({
    cards: [...document.querySelectorAll('.vicu-card')].map((c) => Number(c.getAttribute('data-task-id'))),
    attr: document.documentElement.getAttribute('data-task-transition'),
    named: document.querySelectorAll('[data-vt-named]').length,
    nameStyles: [...document.querySelectorAll('[data-task-id]')].filter((el) => el.style.viewTransitionName).length,
  }))

const rowBox = async (page, id) => (await page.locator(`[data-task-id="${id}"]`).first().boundingBox())

const clickRow = (page, id) => page.locator(`[data-task-id="${id}"]`).first().click({ position: { x: 180, y: 12 } })

export default async function run(h) {
  const page = h.page
  await h.resize(1280, 820)
  await h.setMotion('full')
  await h.dismiss()
  await h.goto('/today')

  const ids = await page.evaluate(() => [...document.querySelectorAll('[data-task-id]')].slice(0, 3).map((el) => Number(el.getAttribute('data-task-id'))))
  const [a, b, c] = ids
  await h.assert('Today has at least three rows', ids.length === 3)
  if (ids.length < 3) return

  // ---- A. Open a row -------------------------------------------------------------------------
  const rowA = await rowBox(page, a)
  const before = await h.capture('closed')
  await startSampler(page, { watch: a })
  await clickRow(page, a)
  await h.wait(900)
  const free = await readSampler(page)
  const morph = free.samples.filter((s) => s.attr === 'morph')
  await h.assert('A: a view transition runs (morph attribute on several frames)', { ok: morph.length >= 3, detail: `${morph.length} frames` })
  await h.assert(`A: the row's group is named task-${a}`, free.samples.some((s) => s.groups.includes(`::view-transition-group(task-${a})`)))
  const cardA = await rowBox(page, a)
  const heights = [...new Set(free.samples.map((s) => s.groupHeight).filter((x) => x != null && !Number.isNaN(x)).map((x) => Math.round(x)))]
  await h.assert('A: the group height passes through values between the row and the card', {
    ok: heights.some((x) => x > rowA.height + 4 && x < cardA.height - 4),
    detail: `row ${Math.round(rowA.height)}, card ${Math.round(cardA.height)}, sampled ${heights.slice(0, 12).join(' ')}`,
  })
  const afterA = await openState(page)
  await h.assert('A: one card is open and the transition left nothing behind', { ok: afterA.cards.length === 1 && afterA.cards[0] === a && afterA.attr === null && afterA.nameStyles === 0, detail: JSON.stringify(afterA) })
  const open = await h.capture('open')

  // Frozen mid-transition: close, then open again with the animations paused at 30 percent.
  await h.dismiss()
  await h.wait(600)
  await startSampler(page, { watch: a, freeze: true })
  await clickRow(page, a)
  await h.wait(350)
  const frozen = (await readSampler(page)).frozen
  if (!frozen) {
    await h.assert('A: a mid-transition frame was frozen', false)
  } else {
    const mid = await h.capture('mid-transition')
    const midHeight = frozen.heights[`::view-transition-group(task-${a})`]
    await h.assert('A: mid-transition the group is between the row and the card', {
      ok: midHeight > rowA.height + 2 && midHeight < cardA.height - 2,
      detail: `row ${Math.round(rowA.height)}, mid ${Math.round(midHeight)}, card ${Math.round(cardA.height)}`,
    })
    await h.assert('A: the mid-transition capture differs from the closed and the open captures', { ok: hash(mid) !== hash(before) && hash(mid) !== hash(open), detail: 'sha256 of the three PNGs' })
  }
  await release(page)
  await h.wait(900)

  // ---- B. A second row: the first card closes as the second opens ---------------------------
  await startSampler(page, { watch: b, freeze: true })
  await clickRow(page, b)
  await h.wait(350)
  const both = (await readSampler(page)).frozen
  await h.assert('B: one transition animates both tasks (two named groups)', {
    ok: !!both && both.groups.includes(`::view-transition-group(task-${a})`) && both.groups.includes(`::view-transition-group(task-${b})`),
    detail: JSON.stringify(both?.groups),
  })
  if (both) await h.capture('switch-mid')
  await release(page)
  await h.wait(900)
  const afterB = await openState(page)
  await h.assert('B: only the second card is open', { ok: afterB.cards.length === 1 && afterB.cards[0] === b && afterB.nameStyles === 0, detail: JSON.stringify(afterB) })

  // ---- C. Enter on a third row ----------------------------------------------------------------
  await page.locator(`[data-task-id="${c}"]`).first().focus()
  await h.key('Enter')
  await h.wait(1000)
  const afterC = await openState(page)
  await h.assert('C: Enter on a focused row opens it and closes the other card', { ok: afterC.cards.length === 1 && afterC.cards[0] === c, detail: JSON.stringify(afterC) })
  await h.capture('enter-open')

  // Enter on a row that is not the keyboard selection (the selection is still on the row clicked
  // last): only the focused row opens; the list's own Enter handler must not switch it to the selection.
  await h.dismiss()
  await h.wait(500)
  await clickRow(page, a)
  await h.wait(700)
  await h.dismiss()
  await h.wait(500)
  await page.locator(`[data-task-id="${c}"]`).first().focus()
  await h.key('Enter')
  await h.wait(1000)
  const afterC2 = await openState(page)
  await h.assert('C: Enter opens the focused row even when the keyboard selection is on another row', { ok: afterC2.cards.length === 1 && afterC2.cards[0] === c, detail: JSON.stringify(afterC2) })

  // ---- D. Latest wins -------------------------------------------------------------------------
  await h.dismiss()
  await h.wait(600)
  await clickRow(page, a)
  await h.wait(40)
  await clickRow(page, b)
  await h.wait(1200)
  const afterD = await openState(page)
  await h.assert('D: two quick clicks on different rows leave only the second card, with nothing left over', {
    ok: afterD.cards.length === 1 && afterD.cards[0] === b && afterD.attr === null && afterD.named === 0 && afterD.nameStyles === 0,
    detail: JSON.stringify(afterD),
  })

  // ---- E. Reduced motion ----------------------------------------------------------------------
  await h.setMotion('reduce')
  await h.assert('prefers-reduced-motion is emulated as reduce', () => page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches))
  await h.dismiss()
  await h.wait(500)
  await startSampler(page, { watch: a })
  await clickRow(page, a)
  await h.wait(700)
  const red = await readSampler(page)
  await h.assert('E: no view transition runs under reduced motion', { ok: red.samples.every((s) => s.vtAnims === 0 && s.attr !== 'morph'), detail: `${red.samples.length} frames` })
  const cardFrames = red.samples.filter((s) => s.cardOpacity != null)
  await h.assert('E: the card fades in (opacity below 1 on a frame, 1 at the end)', {
    ok: cardFrames.some((s) => s.cardOpacity < 0.99) && cardFrames[cardFrames.length - 1]?.cardOpacity === 1,
    detail: `${cardFrames.length} frames, first ${cardFrames[0]?.cardOpacity}`,
  })
  await h.assert('E: no transform or scale on the card on any frame', {
    ok: cardFrames.every((s) => (s.cardTransform === 'none') && (s.cardScale === 'none')),
    detail: JSON.stringify(cardFrames.find((s) => s.cardTransform !== 'none' || s.cardScale !== 'none') ?? null),
  })
  await h.capture('reduced-open')
  const redState = await openState(page)
  await h.assert('E: the end state is the same (one card, nothing left over)', { ok: redState.cards.length === 1 && redState.cards[0] === a && redState.nameStyles === 0, detail: JSON.stringify(redState) })
  await clickRow(page, b)
  await h.wait(600)
  const redSwitch = await openState(page)
  await h.assert('E: switching the open row works the same way', { ok: redSwitch.cards.length === 1 && redSwitch.cards[0] === b, detail: JSON.stringify(redSwitch) })

  await h.setMotion('full')
  await h.dismiss()
}
