// E11 (card 4.2, completion half): with prefers-reduced-motion the completion hold keeps the same
// timing. (The motion half, no transforms or overshoot, is added with the checkbox and row motion.)
import { HOLD_MS, checkboxOf, makeTasks, openToday, pointerAway, removeTasks, rowGoneAt, rowOf } from './_completion.mjs'

export const meta = {
  id: 'E11',
  wave: 4,
  title: 'E1 and E7 with --motion reduce: no transforms or overshoot, same hold timing',
}

export default async function run(h) {
  await h.resize(1280, 820)
  await h.dismiss()
  const ids = await makeTasks(h, ['E11 reduce A'])
  try {
    const [a] = ids
    await h.setMotion('reduce')
    await h.assert('the page reports prefers-reduced-motion: reduce', async () => h.page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches))
    await h.assert('the task is listed in Today', { ok: await openToday(h, ids) })

    await checkboxOf(h, a).click()
    await h.wait(300)
    const left = await pointerAway(h)
    await h.assert('the row is held right after the pointer left', async () => (await rowOf(h, a).count()) === 1)
    const gone = await rowGoneAt(h, a, HOLD_MS + 4000)
    await h.assert('reduced motion: the row collapses 5 s after the pointer left (4.8 s to 6.0 s)', {
      ok: gone !== null && gone - left >= HOLD_MS - 200 && gone - left <= HOLD_MS + 1000,
      detail: gone === null ? 'still there' : `${Math.round(gone - left)} ms`,
    })
  } finally {
    await h.setMotion('full')
    await removeTasks(h, ids)
  }
}
