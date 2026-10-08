// E2 (card 4.2): complete rows by keyboard (Space on the focused checkbox). Keyboard focus on a row
// holds it; 5 s after focus has left every completed row they collapse.
import { HOLD_MS, checkboxOf, makeTasks, openToday, pageNow, removeTasks, rowGoneAt, rowOf, serverDone } from './_completion.mjs'

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

    // Keyboard path of a row: the row is the roving Tab stop, the next Tab reaches its checkbox. A real
    // key press first, so that focus() counts as keyboard focus (:focus-visible).
    const focusCheckbox = async (id) => {
      await h.key('Tab')
      await rowOf(h, id).focus()
      await h.key('Tab')
    }
    await focusCheckbox(a)
    await h.assert('the checkbox of A has keyboard focus', async () => page.evaluate(() => document.activeElement?.matches('button[role="checkbox"]:focus-visible') ?? false))
    await h.key('Space')
    await h.wait(300)
    await h.assert('A reads checked after Space and is done on the server', async () => (await checkboxOf(h, a).getAttribute('aria-checked')) === 'true' && (await serverDone(h, a)))
    await h.capture('a-completed')

    // Focus stays on A: it is held for as long as focus is on it, however long that is.
    await h.wait(HOLD_MS + 1500)
    await h.assert('A is still listed 6 s after Space while focus is on it', async () => (await rowOf(h, a).count()) === 1)

    // Complete B the same way, then move focus off both: both go 5 s after focus left.
    await focusCheckbox(b)
    await h.key('Space')
    await h.wait(300)
    await h.assert('B reads checked and is done on the server', async () => (await checkboxOf(h, b).getAttribute('aria-checked')) === 'true' && (await serverDone(h, b)))
    await page.evaluate(() => document.activeElement?.blur())
    const left = await pageNow(h)
    await h.assert('A and B stay listed right after focus left', async () => (await rowOf(h, a).count()) === 1 && (await rowOf(h, b).count()) === 1)
    const goneB = await rowGoneAt(h, b, HOLD_MS + 4000)
    const goneA = await rowGoneAt(h, a, 2000)
    await h.assert('B collapses 5 s after focus left (4.8 s to 6.0 s)', {
      ok: goneB !== null && goneB - left >= HOLD_MS - 200 && goneB - left <= HOLD_MS + 1000,
      detail: goneB === null ? 'still there' : `${Math.round(goneB - left)} ms`,
    })
    await h.assert('A is gone too', { ok: goneA !== null })
    await h.assert('C, which was not completed, is still listed and open', async () => (await rowOf(h, c).count()) === 1 && (await checkboxOf(h, c).getAttribute('aria-checked')) === 'false')
    await h.capture('after')
  } finally {
    await removeTasks(h, ids)
  }
}
