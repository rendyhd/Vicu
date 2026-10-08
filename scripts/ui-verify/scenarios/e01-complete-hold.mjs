// E1 (card 4.2): click a Today checkbox, rest the pointer, move away. The row is held while the
// pointer is on it and collapses about 5 s after the pointer leaves (docs/cross-app-semantics-v1.md
// section 7). Leaving the view ends the hold at once.
import { HOLD_MS, TOAST_MS, checkboxOf, makeTasks, openToday, pageNow, pointerAway, removeTasks, rowGoneAt, rowOf, serverDone, toastRegion, toastText } from './_completion.mjs'

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
    await checkboxOf(h, a).click()
    const clicked = await pageNow(h)
    await h.wait(400)
    await h.assert('the checkbox reads checked and the title is struck through', async () => {
      const state = await rowOf(h, a).evaluate((row) => ({
        checked: row.querySelector('button[role="checkbox"]')?.getAttribute('aria-checked'),
        struck: getComputedStyle(row.querySelector('span.truncate')).textDecorationLine,
      }))
      return { ok: state.checked === 'true' && state.struck.includes('line-through'), detail: JSON.stringify(state) }
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
    const left = await pointerAway(h)
    await h.assert('the row stays right after the pointer leaves', async () => (await rowOf(h, a).count()) === 1)
    const gone = await rowGoneAt(h, a, HOLD_MS + 4000)
    const heldFor = gone === null ? null : gone - left
    await h.assert('the row collapses 5 s after the pointer left (4.8 s to 6.0 s)', {
      ok: heldFor !== null && heldFor >= HOLD_MS - 200 && heldFor <= HOLD_MS + 1000,
      detail: heldFor === null ? 'still there' : `${Math.round(heldFor)} ms`,
    })
    await h.assert('the other rows did not move out', async () => (await rowOf(h, b).count()) === 1 && (await rowOf(h, c).count()) === 1)

    // ---- B2. The toast: "Completed" with Undo, 6 s, held while the pointer is on it ----------
    await h.assert('the toast reads "Completed" with an Undo button', async () => {
      const toast = toastRegion(h)
      return { ok: (await toastText(h)) === 'Completed' && (await toast.getByRole('button', { name: 'Undo' }).count()) === 1, detail: await toastText(h) }
    })
    await h.assert('the live region carries the toast', async () => (await page.locator('[aria-live="polite"] [data-toast-kind="success"]').count()) === 1)
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
    await checkboxOf(h, b).click()
    await pointerAway(h)
    await h.wait(300)
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
