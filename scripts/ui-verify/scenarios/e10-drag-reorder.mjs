// E10 (card 2.6 checks it for the row layout): drag a row two places down in a project list, then
// check that the lift shows, the order holds 50 ms after the drop, and the server has the new order.
// Also checks that keyboard and modifier selection still work on the two-line rows.
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

export default async function run(h) {
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
  await h.drag(rowSel(first), rowSel(third), { steps: 20, hold: true })
  await h.wait(250)
  const lifted = await h.page.evaluate((id) => {
    const el = document.querySelector(`[data-task-id="${id}"]`)
    return el ? Number(getComputedStyle(el).opacity) : null
  }, first)
  await h.assert('the dragged row is lifted out of its slot (dimmed)', { ok: lifted !== null && lifted < 0.6, detail: lifted })
  await h.capture('drag-held')
  await h.mouseUp()

  // B. No snap back 50 ms after the drop, and the order in the page is the new one.
  await h.wait(50)
  const expected = [second, third, first, ...before.slice(3)]
  const after50 = await domOrder(h)
  await h.assert('the row stays in its new slot 50 ms after the drop', {
    ok: JSON.stringify(after50.slice(0, 3)) === JSON.stringify(expected.slice(0, 3)),
    detail: after50.slice(0, 4).join(','),
  })

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
    h.page.evaluate(() => [...document.querySelectorAll('[data-task-id]')].map((el) => el.className.includes('bg-accent-blue/15')))
  const picked = await selected()
  await h.assert('Ctrl+click selects two rows', { ok: picked[0] && picked[1] && !picked[2], detail: picked.slice(0, 4).join(',') })
  await h.dismiss()
  await rows.nth(1).click()
  await rows.nth(3).click({ modifiers: ['Shift'] })
  const range = await selected()
  await h.assert('Shift+click selects the range', { ok: range[1] && range[2] && range[3], detail: range.slice(0, 5).join(',') })
  await h.dismiss()

  await h.page.locator('[data-task-id]').nth(2).focus()
  await h.key('Enter')
  await h.wait(400)
  const opened = await h.page.evaluate(() => document.querySelectorAll('[data-task-id] textarea, [data-task-id] [contenteditable]').length)
  await h.assert('Enter on a focused row opens its card', { ok: opened > 0, detail: opened })
  await h.dismiss()
}
