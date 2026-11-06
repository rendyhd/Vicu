// Dragging a task out of the Inbox onto a project in the sidebar (and reordering next to it): the
// drag shows a grabbing cursor over everything, the overlay sits beside the pointer so the row under
// the pointer stays visible, and on the drop the overlay goes into the project instead of flying back
// to the row it came from. Uses its own throwaway tasks and deletes them; asserts on what the server
// holds. --motion reduce: no travel and no scale, the overlay only fades where it was let go.
export const meta = {
  id: 'DTP',
  wave: 4,
  title: 'Drag a task to a project: grabbing cursor, overlay beside the pointer, drop lands on the project',
}

/** Samples the overlay and the row of `taskId` every frame from the pointer release on. */
async function startDropSampler(page, taskId) {
  await page.evaluate((taskId) => {
    const state = { samples: [], drop: null }
    window.__dtp = state
    window.addEventListener('pointerup', () => (state.drop = performance.now()), { capture: true, once: true })
    const end = performance.now() + 2000
    const tick = () => {
      const lift = document.querySelector('.vicu-lift')
      const r = lift?.getBoundingClientRect()
      const row = document.querySelector(`[data-task-id="${taskId}"]`)
      state.samples.push({
        t: performance.now(),
        x: r ? r.left + r.width / 2 : null,
        y: r ? r.top + r.height / 2 : null,
        width: r ? r.width : null,
        opacity: lift ? Number(getComputedStyle(lift.parentElement).opacity) : null,
        row: row ? Number(getComputedStyle(row).opacity) : null,
      })
      if (performance.now() < end) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }, taskId)
}

export default async function run(h) {
  const reduced = h.motion === 'reduce'
  const page = h.page
  await h.resize(1280, 820)

  const stamp = Date.now() % 100000
  const moved = await h.api('POST', `/projects/${h.ids.inbox}/tasks`, { title: `DTP moved ${stamp}` })
  const second = await h.api('POST', `/projects/${h.ids.inbox}/tasks`, { title: `DTP second ${stamp}` })
  const third = await h.api('POST', `/projects/${h.ids.inbox}/tasks`, { title: `DTP third ${stamp}` })
  const rowSel = (id) => `[data-task-id="${id}"]`

  try {
    await h.goto('/today')
    await h.goto('/inbox')
    await h.dismiss()
    await page.locator(rowSel(moved.id)).waitFor({ timeout: 8000 })

    const target = page.locator(`[data-project-row="sidebar:${h.ids.work}"]`)
    await h.assert('the sidebar shows the target project', (await target.count()) === 1)
    const box = await target.boundingBox()
    const targetCenter = { x: box.x + box.width / 2, y: box.y + box.height / 2 }

    // A. Hold over the project.
    await h.drag(rowSel(moved.id), targetCenter, { steps: 18, hold: true })
    await h.wait(250)
    const held = await page.evaluate((p) => {
      const lift = document.querySelector('.vicu-lift')
      const r = lift.getBoundingClientRect()
      const under = document.elementFromPoint(p.x, p.y)
      return {
        cursor: getComputedStyle(under).cursor,
        under: under.tagName,
        rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width },
      }
    }, targetCenter)
    await h.assert('the cursor is a grabbing hand at the pointer', { ok: held.cursor === 'grabbing', detail: `${held.under}: ${held.cursor}` })
    const r = held.rect
    const covered = targetCenter.x >= r.left && targetCenter.x <= r.right && targetCenter.y >= r.top && targetCenter.y <= r.bottom
    await h.assert('the overlay does not cover the pointer', { ok: !covered, detail: JSON.stringify(r) })
    await h.assert('the overlay does not cover the row under the pointer', {
      ok: r.top >= targetCenter.y && r.left >= targetCenter.x,
      detail: `pointer ${Math.round(targetCenter.x)},${Math.round(targetCenter.y)}, overlay ${Math.round(r.left)},${Math.round(r.top)}`,
    })
    await h.assert('the overlay is a chip, not the width of the row', { ok: r.width <= 322, detail: Math.round(r.width) })
    await h.capture('held-over-project')

    // B. Drop: the overlay must go to the project, never back towards the list.
    const start = await page.evaluate(() => {
      const r = document.querySelector('.vicu-lift').getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    })
    await startDropSampler(page, moved.id)
    await h.mouseUp()
    await h.wait(700)
    const run = await page.evaluate(() => window.__dtp)
    const after = run.samples.filter((s) => run.drop !== null && s.t >= run.drop)
    const overlay = after.filter((s) => s.x !== null)
    const dist = (s, p) => Math.hypot(s.x - p.x, s.y - p.y)
    const away = overlay.filter((s) => dist(s, targetCenter) > dist(start, targetCenter) + 4)
    await h.assert('the overlay never moves away from the project after the drop', {
      ok: away.length === 0,
      detail: `${overlay.length} frames, ${away.length} moving away; start ${Math.round(start.x)},${Math.round(start.y)}, target ${Math.round(targetCenter.x)},${Math.round(targetCenter.y)}`,
    })
    const span = overlay.length ? overlay[overlay.length - 1].t - run.drop : 0
    if (reduced) {
      const moves = overlay.filter((s) => Math.abs(s.x - start.x) > 1 || Math.abs(s.y - start.y) > 1)
      await h.assert('reduced: the overlay does not travel', { ok: moves.length === 0, detail: `${overlay.length} frames` })
    } else {
      const last = overlay[overlay.length - 1]
      await h.assert('the overlay ends on the project', { ok: !!last && dist(last, targetCenter) < 30, detail: last ? `${Math.round(dist(last, targetCenter))} px away after ${Math.round(span)} ms` : 'no frames' })
    }
    await h.assert('the overlay fades as it lands', { ok: overlay.some((s) => s.opacity !== null && s.opacity < 0.7), detail: overlay.slice(-1)[0]?.opacity })
    // The first frame can still show the row dimmed as it was during the drag; it must never brighten.
    const redrawn = after.filter((s) => s.row !== null && s.row > 0.5)
    await h.assert('the row is not drawn again while the overlay lands', {
      ok: redrawn.length === 0,
      detail: `${redrawn.map((s) => `${Math.round(s.t - run.drop)} ms: ${s.row}`).join('; ') || 'none'} of ${after.length} frames`,
    })
    await h.assert('the row has left the Inbox', (await page.locator(rowSel(moved.id)).count()) === 0)
    const cursorAfter = await page.evaluate(() => ({ attr: document.documentElement.hasAttribute('data-dragging'), pe: getComputedStyle(document.body).pointerEvents }))
    await h.assert('the page is back to normal after the drop', { ok: !cursorAfter.attr && cursorAfter.pe !== 'none', detail: JSON.stringify(cursorAfter) })

    let saved = null
    for (let i = 0; i < 10; i++) {
      saved = await h.api('GET', `/tasks/${moved.id}`)
      if (saved.project_id === h.ids.work) break
      await h.wait(300)
    }
    await h.assert('the server has the task in the project', { ok: saved.project_id === h.ids.work, detail: saved.project_id })

    // C. Reordering still goes by where the pointer is: over the row's own place nothing moves, over
    // the row below it takes that place.
    const order = () => page.evaluate(() => [...document.querySelectorAll('[data-task-id]')].map((el) => Number(el.getAttribute('data-task-id'))))
    await h.wait(300)
    const before = await order()
    const a = second.id
    const b = third.id
    const iA = before.indexOf(a)
    const iB = before.indexOf(b)
    const [upper, lower] = iA < iB ? [a, b] : [b, a]
    const lowerBox = await page.locator(rowSel(lower)).boundingBox()
    await h.drag(rowSel(upper), { x: lowerBox.x + lowerBox.width / 2, y: lowerBox.y + lowerBox.height / 2 }, { steps: 14 })
    await h.wait(600)
    const reordered = await order()
    await h.assert('a row dropped on the row below takes its place', {
      ok: reordered.indexOf(upper) > reordered.indexOf(lower),
      detail: `${before.join(',')} -> ${reordered.join(',')}`,
    })
  } finally {
    for (const t of [moved, second, third]) await h.api('DELETE', `/tasks/${t.id}`).catch(() => {})
  }
}
