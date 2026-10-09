// E1 (card 4.2): click a Today checkbox, rest the pointer, move away. The row is held while the
// pointer is on it and collapses about 5 s after the pointer leaves (docs/cross-app-semantics-v1.md
// section 7). Leaving the view ends the hold at once.
import { HOLD_MS, TOAST_MS, checkboxOf, makeTasks, openToday, pageNow, pointerAway, readAnimations, recordAnimations, removeTasks, rowGoneAt, rowOf, serverDone, startHitWatch, stopHitWatch, toastRegion, toastText } from './_completion.mjs'

export const meta = {
  id: 'E1',
  wave: 4,
  title: 'Click a Today checkbox, rest the pointer, move away: pop, drawn check, row held while hovered, toast Completed, Undo',
}

export default async function run(h) {
  const page = h.page
  await h.resize(1280, 820)
  await h.dismiss()
  const ids = await makeTasks(h, ['E1 hold A', 'E1 hold B', 'E1 hold C'])
  try {
    const [a, b, c] = ids
    await h.assert('the throwaway tasks are listed in Today', { ok: await openToday(h, ids) })

    // ---- A. A real click, the pointer rests on the row ---------------------------------------
    await h.capture('before')
    await recordAnimations(h, a)
    await checkboxOf(h, a).click()
    await h.wait(60)
    await h.capture('pop-early', { clip: rowOf(h, a) })
    const clicked = await pageNow(h)
    await h.wait(400)
    await h.assert('the checkbox reads checked and the title is struck through', async () => {
      const state = await rowOf(h, a).evaluate((row) => ({
        checked: row.querySelector('button[role="checkbox"]')?.getAttribute('aria-checked'),
        struck: getComputedStyle(row.querySelector('.vicu-strike')).backgroundImage,
        decoration: getComputedStyle(row.querySelector('.vicu-strike')).textDecorationLine,
      }))
      // Forced colours drop background images: the strike is a text-decoration there (index.css).
      const struck = h.forcedColors ? state.decoration.includes('line-through') : state.struck.includes('linear-gradient')
      return { ok: state.checked === 'true' && struck, detail: JSON.stringify(state) }
    })
    await h.assert('the completion is on the server at once', { ok: await serverDone(h, a) })
    await h.capture('held-hovered')

    // The pointer is still on the row (it was just clicked): well past 5 s the row is still there.
    await h.wait(HOLD_MS + 1500 - 400)
    await h.assert('the row is still listed more than 6 s after the click while the pointer rests on it', {
      ok: (await rowOf(h, a).count()) === 1,
      detail: `${Math.round((await pageNow(h)) - clicked)} ms after the click`,
    })

    // ---- B. The pointer leaves: the row goes about 5 s later ---------------------------------
    await h.startFrames()
    await startHitWatch(h, [b, c])
    const left = await pointerAway(h)
    await h.assert('the row stays right after the pointer leaves', async () => (await rowOf(h, a).count()) === 1)
    const gone = await rowGoneAt(h, a, HOLD_MS + 4000)
    await h.assertSmooth('E1 the hold and the row closing', await h.stopFrames())
    const hits = await stopHitWatch(h)
    await h.assert('the other rows take input all the time, also while the first one closes (the element at their centre is the row)', { ok: hits.ticks > 20 && hits.blocked.length === 0, detail: `${hits.ticks} checks, blocked ${JSON.stringify(hits.blocked)}` })
    const heldFor = gone === null ? null : gone - left
    await h.assert('the row collapses 5 s after the pointer left (4.8 s to 6.0 s)', {
      ok: heldFor !== null && heldFor >= HOLD_MS - 200 && heldFor <= HOLD_MS + 1000,
      detail: heldFor === null ? 'still there' : `${Math.round(heldFor)} ms`,
    })
    // The motion of the completion, read from the page: the same values as Android.
    const seen = await readAnimations(h)
    const named = (name) => seen.anims.find((x) => x.name === name)
    if (h.motion === 'reduce') {
      // --motion reduce: the same moments as fades (E11 pins the details).
      await h.assert('reduced: no scale or drawing animation starts, the fill and the check fade over 150 ms', {
        ok: !seen.anims.some((x) => ['vicu-check-fill', 'vicu-check-draw', 'vicu-strike-draw'].includes(x.name)) && seen.anims.filter((x) => x.name === 'vicu-bar-fade' && x.duration === 150).length >= 2,
        detail: JSON.stringify(seen.anims),
      })
      await h.assert('reduced: the row closes with a fade only, no height or transform', { ok: seen.rowAnims.length > 0 && seen.rowAnims.every((x) => x.props.join() === 'opacity'), detail: JSON.stringify(seen.rowAnims) })
    } else {
      await h.assert('the ring fill pops with the pop spring over 360 ms', { ok: named('vicu-check-fill')?.duration === 360 && named('vicu-check-fill').easing.startsWith('linear('), detail: JSON.stringify(named('vicu-check-fill')) })
      await h.assert('the check draws over 220 ms', { ok: named('vicu-check-draw')?.duration === 220, detail: JSON.stringify(named('vicu-check-draw')) })
      await h.assert('the title strike draws over 240 ms', { ok: named('vicu-strike-draw')?.duration === 240, detail: JSON.stringify(named('vicu-strike-draw')) })
      const closing = seen.rowAnims.find((x) => x.props.includes('height'))
      await h.assert('the row closes its height and fades with the move spring (320 ms), without a transform', {
        ok: !!closing && closing.duration === 320 && closing.props.includes('opacity') && !closing.props.some((p) => /transform|scale|translate|rotate/.test(p)),
        detail: JSON.stringify(seen.rowAnims),
      })
    }
    await h.assert('the other rows did not move out', async () => (await rowOf(h, b).count()) === 1 && (await rowOf(h, c).count()) === 1)

    // ---- B2. The toast: "Completed" with Undo, 6 s, held while the pointer is on it ----------
    await h.assert('the toast reads "Completed" with an Undo button', async () => {
      const toast = toastRegion(h)
      return { ok: (await toastText(h)) === 'Completed' && (await toast.getByRole('button', { name: 'Undo' }).count()) === 1, detail: await toastText(h) }
    })
    await h.assert('the live region carries the toast', async () => (await page.locator('[aria-live="polite"] [data-toast-kind="success"]').count()) === 1)
    await h.assert('the icon, the message and the buttons of the toast share one centre line', async () => {
      const centres = await page.evaluate(() => {
        const toast = document.querySelector('[aria-live="polite"] [data-toast-kind="success"]')
        const mid = (r) => r.top + r.height / 2
        // The glyph box of the text, not the span (whose padding would hide the bug).
        const range = document.createRange()
        range.selectNodeContents(toast.querySelector('span.flex-1'))
        const [undo, close] = toast.querySelectorAll('button')
        return {
          icon: mid(toast.querySelector('[data-toast-icon] svg').getBoundingClientRect()),
          text: mid(range.getBoundingClientRect()),
          undo: mid(undo.getBoundingClientRect()),
          close: mid(close.getBoundingClientRect()),
        }
      })
      const values = Object.values(centres)
      return { ok: Math.max(...values) - Math.min(...values) <= 1, detail: centres }
    })
    await h.capture('toast')
    await toastRegion(h).hover()
    await h.wait(TOAST_MS + 1500)
    await h.assert('the toast stays more than 7 s while the pointer is on it', async () => (await toastText(h)) === 'Completed')
    const toastLeft = await pointerAway(h)
    await h.wait(TOAST_MS - 700)
    await h.assert('the toast is still there just under 6 s after the pointer left it', async () => (await toastText(h)) === 'Completed')
    await h.wait(1400)
    await h.assert('the toast is gone 6 s after the pointer left it', {
      ok: (await toastText(h)) === null,
      detail: `${Math.round((await pageNow(h)) - toastLeft)} ms`,
    })
    await h.assert('the row stays collapsed when the toast expires', async () => (await rowOf(h, a).count()) === 0 && (await serverDone(h, a)))

    // ---- C. Leaving the view ends a hold at once ---------------------------------------------
    await h.startFrames()
    await checkboxOf(h, b).click()
    await pointerAway(h)
    await h.wait(700)
    await h.assertSmooth('E1 the check pop, ring fill and strike', await h.stopFrames())
    await h.assert('B is held after the click', async () => (await rowOf(h, b).count()) === 1)
    await h.goto('/upcoming')
    await h.assert('the toast survives the navigation and reads "Completed"', async () => (await toastText(h)) === 'Completed')
    await h.goto('/today')
    await h.assert('B is not listed after a visit to another view', { ok: (await rowOf(h, b).count()) === 0 })
    await h.assert('B is done on the server', { ok: await serverDone(h, b) })

    // ---- D. Undo on the toast reopens B with { done: false } ---------------------------------
    await toastRegion(h).getByRole('button', { name: 'Undo' }).click()
    await h.wait(600)
    await h.assert('Undo removes the toast', async () => (await toastText(h)) === null)
    await h.assert('B is open again on the server', async () => !(await serverDone(h, b)))
    await h.assert('B is back in Today, unchecked', async () => (await rowOf(h, b).count()) === 1 && (await checkboxOf(h, b).getAttribute('aria-checked')) === 'false')

    await h.capture('after')
  } finally {
    await removeTasks(h, ids)
  }
}
