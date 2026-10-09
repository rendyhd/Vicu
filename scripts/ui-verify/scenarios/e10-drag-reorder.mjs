// E10 (card 2.6 checks it for the row layout; card 4.8 the motion): drag a row two places down in a
// project list, then check that the lift shows, the order holds on every frame after the drop (and 50
// ms after it), the overlay travels into the slot over about 240 ms, and the server has the new order.
// Also checks that keyboard and modifier selection still work on the two-line rows, and that a new
// row opens from no height and a deleted row closes (card 4.8).
//
// Full motion (default): the overlay is lifted (scale 1.02) and travels. --motion reduce: no lift and
// no travel (the overlay is gone within two frames), rows open and close with a fade only.
export const meta = {
  id: 'E10',
  wave: 4,
  title: 'Drag a row two places down: lift, travel into the slot, no snap back, order saved',
}

const items = (res) => (Array.isArray(res) ? res : (res?.items ?? []))

/** The open tasks of a project's list view, in the order the server holds them. */
async function serverOrder(h, projectId) {
  const views = items(await h.api('GET', `/projects/${projectId}/views`))
  const list = views.find((v) => v.view_kind === 'list')
  const tasks = items(await h.api('GET', `/projects/${projectId}/views/${list.id}/tasks?filter=${encodeURIComponent('done = false')}&per_page=100`))
  return tasks.filter((t) => !t.done).sort((a, b) => (a.position ?? 0) - (b.position ?? 0)).map((t) => t.id)
}

const domOrder = (h) => h.page.evaluate(() => [...document.querySelectorAll('[data-task-id]')].map((el) => Number(el.getAttribute('data-task-id'))))

/**
 * Samples every frame: the order of the rows, and the position of the drag overlay (the lifted row)
 * while it exists. `window.__drop` is the time of the pointer release (capture phase).
 */
async function startDropSampler(page) {
  await page.evaluate(() => {
    const state = { samples: [], drop: null }
    window.__e10 = state
    window.addEventListener('pointerup', () => (state.drop = performance.now()), { capture: true, once: true })
    const end = performance.now() + 4000
    const tick = () => {
      const lift = document.querySelector('.vicu-lift')
      const r = lift ? lift.getBoundingClientRect() : null
      state.samples.push({
        t: performance.now(),
        order: [...document.querySelectorAll('[data-task-id]')].map((el) => Number(el.getAttribute('data-task-id'))),
        overlayTop: r ? r.top : null,
        overlayScale: lift ? getComputedStyle(lift).scale : null,
      })
      if (performance.now() < end) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
}

/** Samples the height and opacity of the row whose text contains `title`, and the closing copies, every frame. */
async function startRowSampler(page, title) {
  await page.evaluate((title) => {
    const state = { heights: [], opacities: [], closing: [], closingHeights: [] }
    window.__e10row = state
    const end = performance.now() + 3000
    const tick = () => {
      const row = [...document.querySelectorAll('[data-task-id]')].find((el) => el.textContent.includes(title))
      if (row) {
        state.heights.push(row.getBoundingClientRect().height)
        state.opacities.push(Number(getComputedStyle(row).opacity))
      }
      const ghost = document.querySelector('[data-row-closing]')
      if (ghost) {
        state.closing.push(true)
        state.closingHeights.push(ghost.getBoundingClientRect().height)
      }
      if (performance.now() < end) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }, title)
}

/** Adds a task with the composer (its row opens from no height), then deletes it (its row closes). */
async function openAndClose(h, reduced) {
  const page = h.page
  const title = `E10 motion probe ${Date.now() % 100000}`
  await h.dismiss()
  await page.locator('button[aria-label="New task"]').last().click()
  await h.wait(250)
  await startRowSampler(page, title)
  await h.type(title)
  await h.key('Enter')
  await h.wait(900)
  const open = await page.evaluate(() => window.__e10row)
  const full = open.heights[open.heights.length - 1]
  const growing = open.heights.filter((x) => x > 4 && x < full - 4)
  if (reduced) {
    await h.assert('reduced: a new row does not grow (its height is never below the final height)', { ok: full > 20 && open.heights.every((x) => x >= full - 1), detail: `${open.heights.length} frames` })
    await h.assert('reduced: a new row fades in (opacity below 1 on a frame)', { ok: open.opacities.some((x) => x < 0.98), detail: open.opacities.slice(0, 6).join(',') })
  } else {
    await h.assert('a new row opens from no height (several frames between 0 and its height)', { ok: full > 20 && growing.length >= 2, detail: `final ${Math.round(full)}, ${growing.length} frames growing` })
  }
  await h.dismiss()
  const probeId = await page.evaluate((t) => [...document.querySelectorAll('[data-task-id]')].find((el) => el.textContent.includes(t))?.getAttribute('data-task-id') ?? null, title)

  await startRowSampler(page, title)
  await page.locator(`[data-task-id="${probeId}"]`).click({ button: 'right' })
  await h.wait(200)
  const del = page.getByRole('menuitem', { name: /^Delete task/ })
  await h.assert('the context menu of the probe row has Delete task', { ok: (await del.count()) === 1, detail: await page.evaluate(() => [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map((x) => x.textContent.trim().slice(0, 14)).join('|')) })
  await del.click({ timeout: 5000 })
  await h.wait(100)
  // Deleting a task without subtasks needs no confirmation; if the app asks, answer it.
  const confirm = page.getByRole('button', { name: /^Delete$/ })
  if ((await confirm.count()) > 0) await confirm.last().click({ timeout: 5000 })
  await h.wait(1000)
  const close = await page.evaluate(() => window.__e10row)
  const shrinking = close.closingHeights.filter((x) => x > 4 && x < full - 4)
  if (reduced) {
    await h.assert('reduced: a deleted row fades out without closing its height', { ok: close.closing.length >= 2 && close.closingHeights.every((x) => x >= full - 1), detail: `${close.closing.length} frames` })
  } else {
    await h.assert('a deleted row closes (several frames of its copy between its height and 0)', { ok: close.closing.length >= 3 && shrinking.length >= 2, detail: `${close.closing.length} frames, ${shrinking.length} shrinking` })
  }
  const gone = await page.evaluate(() => ({ ghosts: document.querySelectorAll('[data-row-closing]').length }))
  await h.assert('the closed row is gone afterwards', { ok: gone.ghosts === 0, detail: JSON.stringify(gone) })
  await h.capture('after-delete')
}

export default async function run(h) {
  const reduced = h.motion === 'reduce'
  await h.resize(1280, 820)

  // The first project of the seed with at least four open tasks.
  let projectId = null
  for (const key of ['inbox', 'website', 'q4', 'home', 'lisbon', 'personal', 'work']) {
    const order = await serverOrder(h, h.ids[key]).catch(() => [])
    if (order.length >= 4) {
      projectId = h.ids[key]
      break
    }
  }
  if (projectId === null) {
    h.emit({ t: 'skip', id: meta.id, wave: meta.wave, message: 'no seeded project has four open tasks' })
    return
  }

  await h.goto(`/project/${projectId}`)
  await h.dismiss()
  const before = await domOrder(h)
  await h.assert('the list shows at least four rows', before.length >= 4)
  const [first, second, third] = before
  const rowSel = (id) => `[data-task-id="${id}"]`

  // A. Drag the first row two places down (onto the third) and hold.
  // Released a little below the centre of the third row, so the overlay has some way to go to its slot.
  const thirdBox = await h.page.locator(rowSel(third)).boundingBox()
  await h.drag(rowSel(first), { x: thirdBox.x + thirdBox.width / 2, y: thirdBox.y + thirdBox.height / 2 + Math.min(24, thirdBox.height / 2 - 6) }, { steps: 20, hold: true })
  await h.wait(250)
  const lifted = await h.page.evaluate((id) => {
    const el = document.querySelector(`[data-task-id="${id}"]`)
    return el ? Number(getComputedStyle(el).opacity) : null
  }, first)
  await h.assert('the dragged row is lifted out of its slot (dimmed)', { ok: lifted !== null && lifted < 0.6, detail: lifted })
  const lift = await h.page.evaluate(() => {
    const el = document.querySelector('.vicu-lift')
    if (!el) return null
    const cs = getComputedStyle(el)
    return { scale: cs.scale, shadow: cs.boxShadow, outlineStyle: cs.outlineStyle, outlineWidth: cs.outlineWidth }
  })
  // Forced colours drop the shadow; .vicu-lift draws a 1 px outline instead (index.css).
  const edge = h.forcedColors ? !!lift && lift.shadow === 'none' && lift.outlineStyle === 'solid' && lift.outlineWidth === '1px' : !!lift && lift.shadow !== 'none'
  await h.assert(reduced ? 'reduced: the dragged overlay has no lift (no scale)' : h.forcedColors ? 'the dragged overlay is lifted (scale 1.02) with an outline instead of a shadow (forced colours)' : 'the dragged overlay is lifted (scale 1.02) with a shadow', {
    ok: !!lift && (reduced ? lift.scale === 'none' || lift.scale === '1' : Math.abs(parseFloat(lift.scale) - 1.02) < 0.001 && edge),
    detail: JSON.stringify(lift),
  })
  await h.capture('drag-held')
  await startDropSampler(h.page)
  await h.mouseUp()

  // B. No snap back 50 ms after the drop, and the order in the page is the new one.
  await h.wait(50)
  const expected = [second, third, first, ...before.slice(3)]
  const after50 = await domOrder(h)
  await h.assert('the row stays in its new slot 50 ms after the drop', {
    ok: JSON.stringify(after50.slice(0, 3)) === JSON.stringify(expected.slice(0, 3)),
    detail: after50.slice(0, 4).join(','),
  })
  await h.wait(600)
  const run10 = await h.page.evaluate(() => window.__e10)
  const slot = await h.page.evaluate((id) => document.querySelector(`[data-task-id="${id}"]`)?.getBoundingClientRect().top ?? null, first)
  const after = run10.samples.filter((x) => run10.drop !== null && x.t >= run10.drop)
  const wrongOrder = after.filter((x) => JSON.stringify(x.order.slice(0, 3)) !== JSON.stringify(expected.slice(0, 3)))
  await h.assert('no frame after the drop shows the old order (no snap back)', {
    ok: after.length >= 5 && wrongOrder.length === 0,
    detail: `${after.length} frames, ${wrongOrder.length} with the old order`,
  })
  const overlay = after.filter((x) => x.overlayTop !== null)
  if (reduced) {
    await h.assert('reduced: no travel (the overlay is gone within 2 frames of the drop)', { ok: overlay.length <= 2, detail: `${overlay.length} frames` })
  } else {
    const span = overlay.length ? overlay[overlay.length - 1].t - run10.drop : 0
    const tops = overlay.map((x) => x.overlayTop)
    const between = tops.filter((t) => Math.abs(t - tops[0]) > 0.5 && Math.abs(t - slot) > 0.5)
    await h.assert('the overlay travels into the slot (several frames between the drop point and the slot)', { ok: between.length >= 2 && Math.abs(tops[0] - slot) > 5, detail: `${overlay.length} frames, from ${Math.round(tops[0])} to slot ${Math.round(slot)}` })
    await h.assert('the travel takes about 240 ms', { ok: span > 150 && span < 420, detail: `${Math.round(span)} ms` })
    await h.assert('the overlay lands on the slot', { ok: overlay.length > 0 && Math.abs(tops[tops.length - 1] - slot) < 14, detail: `last ${Math.round(tops[tops.length - 1])}, slot ${Math.round(slot)}` })
    await h.assert('the lift settles while it travels (scale back to 1)', { ok: overlay.some((x) => x.overlayScale && x.overlayScale !== 'none' && parseFloat(x.overlayScale) < 1.019), detail: overlay.slice(-1)[0]?.overlayScale })
  }

  // C. The server has the same order once the position write lands.
  let saved = []
  for (let i = 0; i < 10; i++) {
    await h.wait(400)
    saved = await serverOrder(h, projectId)
    if (saved[2] === first) break
  }
  await h.assert('the new order is saved on the server', {
    ok: JSON.stringify(saved.slice(0, 3)) === JSON.stringify(expected.slice(0, 3)),
    detail: saved.slice(0, 4).join(','),
  })
  await h.capture('drag-dropped')

  // D. Selection still works: Ctrl+click and Shift+click select rows, Enter on a focused row opens it.
  const rows = h.rows()
  await rows.nth(0).click({ modifiers: ['Control'] })
  await rows.nth(1).click({ modifiers: ['Control'] })
  const selected = () =>
    h.page.evaluate(() => [...document.querySelectorAll('[data-task-id]')].map((el) => el.className.includes('bg-bg-selected')))
  const picked = await selected()
  await h.assert('Ctrl+click selects two rows', { ok: picked[0] && picked[1] && !picked[2], detail: picked.slice(0, 4).join(',') })
  await h.dismiss()
  await rows.nth(1).click()
  await rows.nth(3).click({ modifiers: ['Shift'] })
  // The plain click opened row 1 as a card; the Shift+click selects the range at once and closes that card in
  // the view transition's callback a moment later (task-transition.ts). Wait for the card to be gone, then
  // read: the row that was clicked first is part of the range (reading earlier races the close, which is why
  // this failed at 900x600 and passed at 1280x820).
  await h.page.waitForFunction(() => document.querySelectorAll('.vicu-card').length === 0, null, { timeout: 4000 }).catch(() => {})
  await h.wait(150)
  const range = await selected()
  await h.assert('Shift+click selects the range', { ok: range[1] && range[2] && range[3], detail: range.slice(0, 5).join(',') })
  await h.dismiss()

  await openAndClose(h, reduced)

  // Leave and come back, so no multi-selection is left over from the checks above.
  await h.goto('/today')
  await h.goto(`/project/${projectId}`)
  await h.page.locator('[data-task-id]').nth(2).focus()
  await h.key('Enter')
  await h.wait(400)
  const opened = await h.page.evaluate(() => document.querySelectorAll('.vicu-card').length)
  await h.assert('Enter on a focused row opens its card', { ok: opened > 0, detail: opened + ' ' + (await h.page.evaluate(() => { const a = document.activeElement; return a ? a.tagName + ' ' + (a.getAttribute('data-task-id') ?? '') + ' ' + document.querySelectorAll('[data-task-id]').length + ' rows' : 'none' })) })
  await h.dismiss()
}
