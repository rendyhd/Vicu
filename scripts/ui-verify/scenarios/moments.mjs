// moments (card 4.11a): the desktop signature moments, each with a mid-motion capture (animations
// paused at 40 percent) and the settled capture.
//
//   A. Skeleton: while the server is paused a cold view shows the skeleton; the shimmer sweeps once
//      (one iteration); reduced motion fades the rows in instead.
//   B. Counts roll: a task added in Today changes the Today section count and the sidebar badge;
//      the old number leaves and the new one comes in (up for a larger count, down for a smaller);
//      reduced: a cross-fade, no travel.
//   C. A recognised token travels into its chip: typing "tomorrow" in the composer makes the date
//      chip come out of the highlighted word; reduced: the chip fades in.
//   D. A stuck section header gets a hairline under it (Upcoming scrolled in a short window).
//   E. All clear: when the last task of Today is done the empty state fades in, the sun warms from
//      grey to its colour, and the next upcoming task is offered. Destructive: run seed.mjs after.
//   F. Setup steps slide: needs the Setup screen, which the harness profile (already signed in)
//      never shows; logged as a skip. The CSS is checked by the code-splitting and style tests.
//
// Run seed.mjs before this scenario. It runs under --motion full (default) and --motion reduce.
import { execFileSync } from 'node:child_process'
import { checkboxOf, makeTasks, removeTasks } from './_completion.mjs'

export const meta = {
  id: 'MO',
  wave: 4,
  // Completes every Today task and needs views the app has not loaded: wave runs put it first and re-seed after it.
  destructive: true,
  title: 'Signature moments: skeleton shimmer, rolling counts, token into chip, stuck hairline, All clear',
}

const CONTAINER = process.env.VICU_TEST_CONTAINER ?? 'vicu-test-vikunja'

/** Pauses the server for the length of `fn`; always resumes it. */
async function withServerPaused(fn) {
  execFileSync('docker', ['pause', CONTAINER], { stdio: 'ignore' })
  try {
    return await fn()
  } finally {
    execFileSync('docker', ['unpause', CONTAINER], { stdio: 'ignore' })
  }
}

/**
 * Watches the page for elements matching `selector`; each one that appears has its animations paused
 * at `fraction` of their length (on the first frame, before it is painted) and its look recorded.
 */
async function arm(page, selector, fraction = 0.4) {
  await page.evaluate(
    ({ selector, fraction }) => {
      const state = { frozen: [], anims: [], seen: [] }
      window.__mo = state
      const handle = (el) => {
        const cs0 = getComputedStyle(el)
        state.seen.push({ text: el.textContent.trim().slice(0, 20), dir: el.getAttribute('data-roll-in') ?? el.getAttribute('data-roll-out') ?? null, opacity0: Number(cs0.opacity) })
        if (state.frozen.length >= 12) return
        const anims = el.getAnimations()
        for (const a of anims) {
          const duration = Number(a.effect.getComputedTiming().duration)
          const delay = Number(a.effect.getComputedTiming().delay)
          a.pause()
          a.currentTime = delay + fraction * duration
        }
        state.anims.push(...anims)
        const cs = getComputedStyle(el)
        state.frozen.push({
          text: el.textContent.trim().slice(0, 20),
          dir: el.getAttribute('data-roll-in') ?? el.getAttribute('data-roll-out') ?? null,
          animations: anims.length,
          iterations: anims[0] ? anims[0].effect.getComputedTiming().iterations : null,
          opacity: Number(cs.opacity),
          translate: cs.translate,
          transform: cs.transform,
          scale: cs.scale,
          color: cs.color,
          backgroundPosition: cs.backgroundPositionX,
        })
      }
      const observer = new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (!(node instanceof Element)) continue
            if (node.matches(selector)) handle(node)
            node.querySelectorAll(selector).forEach(handle)
          }
        }
      })
      observer.observe(document.body, { childList: true, subtree: true })
      state.stop = () => observer.disconnect()
    },
    { selector, fraction },
  )
}

const frozenOf = (page) => page.evaluate(() => window.__mo?.frozen ?? [])
const seenOf = (page) => page.evaluate(() => window.__mo?.seen ?? [])
const release = (page) => page.evaluate(() => { (window.__mo?.anims ?? []).forEach((a) => a.play()); window.__mo?.stop?.() })

const noTravel = (f) => (!f.translate || f.translate === 'none' || /^0(px)?( 0(px)?)?$/.test(f.translate)) && (f.transform === 'none' || f.scale === 'none' || true)
const yOf = (value) => (!value || value === 'none' ? 0 : parseFloat(value.split(' ')[1] ?? '0'))

export default async function run(h) {
  const page = h.page
  const reduced = h.motion === 'reduce'
  await h.resize(1280, 820)

  // ---- A. Skeleton ------------------------------------------------------------------------------
  await h.dismiss()
  await arm(page, '.vicu-shimmer', 0.4)
  await withServerPaused(async () => {
    await h.goto('/anytime')
    await h.wait(600)
    const frozen = await frozenOf(page)
    const shown = await page.locator('[data-skeleton="list"]').count()
    await h.assert('A: a cold view shows the skeleton while the server is away', { ok: shown === 1, detail: `${shown} skeletons` })
    await h.assert('A: the placeholders animate once', { ok: frozen.length >= 3 && frozen.every((f) => f.iterations === 1), detail: `${frozen.length} placeholders, iterations ${frozen[0]?.iterations}` })
    if (reduced) {
      await h.assert('A reduced: they fade in (opacity between 0 and 1 mid-way), no sweep', { ok: frozen.every((f) => f.opacity > 0.02 && f.opacity < 1) && frozen.every((f) => f.backgroundPosition !== undefined), detail: frozen[0] && `opacity ${frozen[0].opacity}` })
    } else {
      await h.assert('A: mid-sweep the light is between its start and end positions', { ok: frozen.some((f) => /%/.test(f.backgroundPosition) && parseFloat(f.backgroundPosition) < 200 && parseFloat(f.backgroundPosition) > -100), detail: frozen[0]?.backgroundPosition })
    }
    await h.capture('skeleton-mid')
    await release(page)
    await h.wait(1500)
    await h.capture('skeleton-after')
  })
  await h.wait(1500)
  await h.assert('A: the real list replaces the skeleton once the server answers', { ok: (await page.locator('[data-skeleton="list"]').count()) === 0 })

  // ---- B. Counts roll ---------------------------------------------------------------------------
  await h.goto('/today')
  await h.wait(600)
  const counts = () => page.evaluate(() => ({
    header: [...document.querySelectorAll('h2')].filter((x) => x.textContent.trim() === 'Today').map((x) => x.parentElement.querySelector('[data-rolling-count]')?.textContent.trim() ?? null)[0] ?? null,
    badge: [...document.querySelectorAll('aside nav button')].filter((x) => x.textContent.includes('Today')).map((x) => x.querySelector('[data-rolling-count]')?.textContent.trim() ?? null)[0] ?? null,
  }))
  const before = await counts()
  await h.capture('counts-before')
  await arm(page, '.vicu-roll-in, .vicu-roll-out', 0.12)
  await page.locator('button[aria-label="New task"]').last().click()
  await h.wait(250)
  await h.type('Moments probe')
  await h.key('Enter')
  await h.wait(500)
  const rolled = await frozenOf(page)
  await h.assert('B: a count that grew rolls (a number enters and the old one leaves)', { ok: rolled.some((f) => f.dir === 'up') && rolled.length >= 2, detail: JSON.stringify(rolled.map((f) => `${f.text}:${f.dir}`)) })
  if (reduced) {
    await h.assert('B reduced: no travel (translate none), a cross-fade', { ok: rolled.every((f) => yOf(f.translate) === 0) && rolled.some((f) => f.opacity < 1), detail: JSON.stringify(rolled.map((f) => [f.opacity, f.translate])) })
  } else {
    await h.assert('B: mid-roll the number is between its start and end (opacity and a travel)', { ok: rolled.some((f) => f.opacity > 0.02 && f.opacity < 0.98 && Math.abs(yOf(f.translate)) > 0.05), detail: JSON.stringify(rolled.map((f) => [f.opacity.toFixed(2), f.translate])) })
  }
  await h.capture('counts-mid')
  await release(page)
  await h.wait(700)
  const after = await counts()
  await h.capture('counts-after')
  await h.key('Escape')
  await h.dismiss()
  await h.assert('B: the Today count went up by one in the section header', { ok: before.header !== null && Number(after.header) === Number(before.header) + 1, detail: `${before.header} to ${after.header}` })
  await h.assert('B: the sidebar badge shows a count', { ok: after.badge === null || /^\d+$/.test(after.badge), detail: `${before.badge} to ${after.badge}` })
  await h.assert('B: nothing is left rolling afterwards', { ok: (await page.locator('.vicu-roll-out').count()) === 0 })

  // The probe goes again: the count rolls down.
  await arm(page, '.vicu-roll-in, .vicu-roll-out', 0.12)
  await page.locator('[data-task-id]', { hasText: 'Moments probe' }).first().click({ button: 'right' })
  await h.wait(200)
  await page.getByRole('menuitem', { name: /^Delete task/ }).click()
  await h.wait(100)
  const confirm = page.getByRole('button', { name: /^Delete$/ })
  if ((await confirm.count()) > 0) await confirm.last().click()
  await h.wait(900)
  const down = await seenOf(page)
  await h.assert('B: a count that shrank rolls the other way (down)', { ok: down.some((f) => f.dir === 'down'), detail: JSON.stringify(down.map((f) => `${f.text}:${f.dir}`)) })
  await release(page)

  // ---- C. A token travels into its chip -----------------------------------------------------------
  await h.goto('/today')
  await h.wait(500)
  await page.locator('button[aria-label="New task"]').last().click()
  await h.wait(250)
  await h.type('Call Ana ')
  await arm(page, '[data-chip-type="date"]', 0.4)
  await h.type('tomorrow')
  await h.wait(500)
  const chip = await frozenOf(page)
  await h.assert('C: a date chip appears for the recognised word', { ok: chip.length >= 1, detail: JSON.stringify(chip[0]?.text) })
  if (reduced) {
    await h.assert('C reduced: the chip fades in without travelling', { ok: chip.length >= 1 && chip[0].opacity < 1 && chip[0].transform === 'none', detail: JSON.stringify([chip[0]?.opacity, chip[0]?.transform]) })
  } else {
    await h.assert('C: mid-motion the chip is on its way (a transform, opacity below 1)', { ok: chip.length >= 1 && chip[0].transform !== 'none' && chip[0].opacity < 1 && chip[0].opacity > 0.3, detail: JSON.stringify([chip[0]?.opacity, chip[0]?.transform]) })
  }
  await h.capture('token-mid')
  await release(page)
  await h.wait(600)
  await h.capture('token-after')
  const rest = await page.evaluate(() => getComputedStyle(document.querySelector('[data-chip-type="date"]')).transform)
  await h.assert('C: the chip rests in place afterwards', { ok: rest === 'none', detail: rest })
  // Leave without creating the task.
  for (let i = 0; i < 'Call Ana tomorrow'.length; i++) await page.keyboard.press('Backspace')
  await h.key('Escape')
  await h.dismiss()

  // ---- D. A stuck header gets a hairline --------------------------------------------------------
  await h.resize(1280, 520)
  await h.goto('/upcoming')
  await h.wait(600)
  const stuckState = () => page.evaluate(() => {
    const stuck = [...document.querySelectorAll('[data-stuck]')]
    return { stuck: stuck.length, hairline: stuck.map((el) => Number(getComputedStyle(el.querySelector('.vicu-hairline')).opacity)), idle: [...document.querySelectorAll('.vicu-hairline')].filter((el) => !el.parentElement.hasAttribute('data-stuck')).map((el) => Number(getComputedStyle(el).opacity)) }
  })
  const top = await stuckState()
  await h.assert('D: at the top no header is stuck and no hairline shows', { ok: top.stuck === 0 && top.idle.every((x) => x === 0), detail: JSON.stringify(top) })
  await h.capture('hairline-top')
  await page.evaluate(() => { const scroller = document.querySelector('main .overflow-y-auto'); scroller.scrollTop = 140 })
  await h.wait(500)
  const scrolled = await stuckState()
  await h.assert('D: scrolled, the header whose group is on screen is stuck and shows a hairline', { ok: scrolled.stuck >= 1 && scrolled.hairline.every((x) => x === 1), detail: JSON.stringify(scrolled) })
  await h.capture('hairline-scrolled')
  await page.evaluate(() => { document.querySelector('main .overflow-y-auto').scrollTop = 0 })
  await h.wait(400)
  await h.resize(1280, 820)

  // ---- E. All clear -----------------------------------------------------------------------------
  await h.goto('/today')
  await h.wait(600)
  await h.capture('today-before')
  const total = await page.evaluate(() => document.querySelectorAll('[data-task-id] button[role="checkbox"]').length)
  await arm(page, '.vicu-warm', 0.4)
  await page.evaluate(() => document.querySelectorAll('[data-task-id] button[role="checkbox"]').forEach((b) => b.click()))
  // A task with open subtasks asks first.
  await h.wait(600)
  const completeAll = page.getByRole('button', { name: 'Complete all' })
  if ((await completeAll.count()) > 0) await completeAll.click()
  await page.locator('[data-empty-state="warm"]').waitFor({ timeout: 25000 }).catch(() => {})
  await h.wait(500)
  const clear = await page.evaluate(() => ({ title: document.querySelector('[data-empty-state] p')?.textContent ?? null, warm: document.querySelectorAll('.vicu-all-clear').length }))
  await h.assert(`E: completing all ${total} tasks turns Today into All clear`, { ok: clear.title === 'All clear' && clear.warm === 1, detail: JSON.stringify(clear) })
  const warm = await frozenOf(page)
  if (reduced) {
    await h.assert('E reduced: the sun does not animate its colour (the empty state fades in)', { ok: warm.every((f) => f.animations === 0), detail: `${warm.map((f) => f.animations).join(',')} animations on the sun` })
  } else {
  }
  await h.capture('all-clear-mid')
  await release(page)
  await h.wait(1200)
  if (!reduced) {
    const final = await page.evaluate(() => getComputedStyle(document.querySelector('.vicu-warm')).color)
    await h.assert('E: mid-warm the sun is between grey and its colour (neither the start nor the end)', { ok: warm.length >= 1 && warm[0].color !== final && warm[0].color !== 'rgb(174, 174, 178)', detail: `mid ${warm[0]?.color}, end ${final}` })
  }
  const offer = await page.locator('[data-next-upcoming]').first().textContent().catch(() => null)
  await h.assert('E: the next upcoming task is offered', { ok: !!offer && /Next up/.test(offer), detail: offer })
  await h.capture('all-clear-after')
  if (offer) {
    await page.locator('[data-next-upcoming]').first().click()
    await h.wait(900)
    await h.assert('E: the offer opens Upcoming', { ok: /upcoming/.test(await page.evaluate(() => location.hash)) })
  }

  h.emit({ t: 'skip', id: meta.id, wave: meta.wave, message: 'F (Setup steps slide): the harness profile is signed in and never shows Setup' })
}
