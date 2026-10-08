// E11 (card 4.2, completion half): with prefers-reduced-motion the completion hold keeps the same
// timing, the checkbox and the strike only fade (no scale, no drawing, no overshoot) and the row closes
// with a fade and no height animation.
import { HOLD_MS, checkboxOf, makeTasks, openToday, pointerAway, removeTasks, rowGoneAt, rowOf, readAnimations, recordAnimations } from './_completion.mjs'

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

    await recordAnimations(h, a)
    await checkboxOf(h, a).click()
    await h.wait(300)
    const left = await pointerAway(h)
    await h.assert('the row is held right after the pointer left', async () => (await rowOf(h, a).count()) === 1)
    const gone = await rowGoneAt(h, a, HOLD_MS + 4000)
    await h.assert('reduced motion: the row collapses 5 s after the pointer left (4.8 s to 6.0 s)', {
      ok: gone !== null && gone - left >= HOLD_MS - 200 && gone - left <= HOLD_MS + 1000,
      detail: gone === null ? 'still there' : `${Math.round(gone - left)} ms`,
    })

    const seen = await readAnimations(h)
    await h.assert('reduced motion: no scale or drawing animation starts, the fill and the check fade over 150 ms', {
      ok:
        !seen.anims.some((x) => ['vicu-check-fill', 'vicu-check-draw', 'vicu-strike-draw'].includes(x.name)) &&
        seen.anims.filter((x) => x.name === 'vicu-bar-fade' && x.duration === 150).length >= 2,
      detail: JSON.stringify(seen.anims),
    })
    await h.assert('reduced motion: the row closes with a fade only, no height or transform', {
      ok: seen.rowAnims.length > 0 && seen.rowAnims.every((x) => x.props.join() === 'opacity'),
      detail: JSON.stringify(seen.rowAnims),
    })
  } finally {
    await h.setMotion('full')
    await removeTasks(h, ids)
  }
}
