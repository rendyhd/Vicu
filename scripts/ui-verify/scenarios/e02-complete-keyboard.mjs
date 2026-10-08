// E2 (card 4.2): complete rows by keyboard (Space on the focused checkbox). Focus moves on to the
// next row's checkbox at once, the live region says "Completed <title>", the toast reads "2 completed"
// and Undo (by keyboard) restores both rows and puts focus on the first of them.
import { HOLD_MS, announcement, checkboxOf, makeTasks, openToday, pageNow, removeTasks, rowGoneAt, rowOf, serverDone, toastRegion, toastText } from './_completion.mjs'

export const meta = {
  id: 'E2',
  wave: 4,
  title: 'Complete two rows by keyboard (Space): focus moves, live region, toast 2 completed, Undo restores both',
}

export default async function run(h) {
  const page = h.page
  await h.resize(1280, 820)
  await h.dismiss()
  const ids = await makeTasks(h, ['E2 key A', 'E2 key B', 'E2 key C'])
  try {
    const [a, b, c] = ids
    await h.assert('the throwaway tasks are listed in Today', { ok: await openToday(h, ids) })

    // The keyboard path of a row: the row is the roving Tab stop, the next Tab reaches its checkbox. A
    // real key press first, so that focus() counts as keyboard focus (:focus-visible).
    await h.key('Tab')
    await rowOf(h, a).focus()
    await h.key('Tab')
    const focused = () =>
      page.evaluate(() => {
        const el = document.activeElement
        return { row: el?.closest('[data-task-id]')?.getAttribute('data-task-id') ?? null, checkbox: el?.matches('button[role="checkbox"]') ?? false, visible: el?.matches(':focus-visible') ?? false }
      })
    const onCheckboxOf = async (id) => {
      const f = await focused()
      return { ok: f.checkbox && f.visible && f.row === String(id), detail: JSON.stringify(f) }
    }
    await h.assert('the checkbox of A has keyboard focus', await onCheckboxOf(a))

    // ---- A. Space on A: A is done, focus is on the checkbox of B ------------------------------
    await h.key('Space')
    await h.wait(300)
    await h.assert('A reads checked after Space and is done on the server', async () => (await checkboxOf(h, a).getAttribute('aria-checked')) === 'true' && (await serverDone(h, a)))
    await h.assert('focus moved to the checkbox of B', async () => onCheckboxOf(b))
    await h.assert('the live region says "Completed E2 key A"', { ok: (await announcement(h)) === 'Completed E2 key A', detail: await announcement(h) })
    await h.capture('a-completed')

    // ---- B. Space on B: focus on C ------------------------------------------------------------
    await h.key('Space')
    await h.wait(300)
    await h.assert('B reads checked and is done on the server', async () => (await checkboxOf(h, b).getAttribute('aria-checked')) === 'true' && (await serverDone(h, b)))
    await h.assert('focus moved to the checkbox of C', async () => onCheckboxOf(c))
    await h.assert('the live region says "Completed E2 key B"', { ok: (await announcement(h)) === 'Completed E2 key B', detail: await announcement(h) })

    // ---- C. Focus has left both: they go about 5 s later, in one toast -------------------------
    const left = await pageNow(h)
    await h.assert('A and B are still listed shortly after focus left them', async () => (await rowOf(h, a).count()) === 1 && (await rowOf(h, b).count()) === 1)
    const goneB = await rowGoneAt(h, b, HOLD_MS + 4000)
    const goneA = await rowGoneAt(h, a, 2000)
    await h.assert('B collapses 5 s after focus left it (4.8 s to 6.2 s)', {
      ok: goneB !== null && goneB - left >= HOLD_MS - 200 && goneB - left <= HOLD_MS + 1200,
      detail: goneB === null ? 'still there' : `${Math.round(goneB - left)} ms`,
    })
    await h.assert('A is gone too', { ok: goneA !== null })
    await h.assert('the toast reads "2 completed"', { ok: (await toastText(h)) === '2 completed', detail: await toastText(h) })
    await h.assert('the live region carries the toast', async () => (await page.locator('[aria-live="polite"] [data-toast-kind="success"]').count()) === 1)
    await h.assert('C, which was not completed, is still listed and open', async () => (await rowOf(h, c).count()) === 1 && (await checkboxOf(h, c).getAttribute('aria-checked')) === 'false')
    await h.capture('toast')

    // ---- D. Undo by keyboard: both rows are back, focus is on the first ------------------------
    await toastRegion(h).getByRole('button', { name: 'Undo' }).focus()
    await h.assert('the Undo button of the toast has keyboard focus', async () => page.evaluate(() => document.activeElement?.textContent === 'Undo' && document.activeElement.matches(':focus-visible')))
    await h.key('Enter')
    await h.wait(900)
    await h.assert('Undo removes the toast', async () => (await toastText(h)) === null)
    await h.assert('A and B are open again on the server', async () => !(await serverDone(h, a)) && !(await serverDone(h, b)))
    await h.assert('A and B are back in Today, unchecked', async () => {
      for (const id of [a, b]) {
        if ((await rowOf(h, id).count()) !== 1 || (await checkboxOf(h, id).getAttribute('aria-checked')) !== 'false') return false
      }
      return true
    })
    await h.assert('focus is on the checkbox of A', async () => (await focused()).row === String(a) && (await focused()).checkbox)
    await h.assert('the live region says "Reopened 2 tasks"', { ok: (await announcement(h)) === 'Reopened 2 tasks', detail: await announcement(h) })
    await h.capture('undone')
  } finally {
    await removeTasks(h, ids)
  }
}
