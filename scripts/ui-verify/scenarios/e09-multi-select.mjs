// E9 (card 3.10, the selection bar): with two or more rows selected a bar rises under the list.
//
//   A. One selected row shows no bar; Ctrl-click on a second and third makes "3 selected" with
//      Schedule, Complete, Move, Tag and Delete; selected rows use bg.selected.
//   B. Schedule opens the When popover; "Tomorrow" sets all three tasks due tomorrow (date-only,
//      local 23:59:59), read back from the server.
//   C. Move and Tag open their pickers (listbox, dialog) and close with Escape, focus back on the button.
//   D. Axe finds nothing serious in the bar.
//   E. Escape clears the selection and the bar goes.
//   F. Select again and Complete: all three are done on the server.
//
// It works on three throwaway tasks in the Inbox, deleted at the end.
export const meta = {
  id: 'E9',
  wave: 3,
  title: 'Ctrl-click three rows, Schedule, Tomorrow: bar 3 selected, all three due tomorrow',
}

const pad = (n) => String(n).padStart(2, '0')
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/**
 * Waits (up to 6 s) for the three tasks to satisfy `ok` on the server. The app sends a bulk change
 * one request at a time, because the throwaway server keeps its data in SQLite and answers parallel
 * writes with 500 "database is locked"; so nothing may be left in the offline queue ("N waiting").
 */
async function settle(h, page, ids, ok) {
  let satisfied = []
  for (let n = 0; n < 24; n++) {
    satisfied = []
    for (const id of ids) satisfied.push(ok(await h.api('GET', `/tasks/${id}`)))
    if (satisfied.every(Boolean)) break
    await h.wait(250)
  }
  const missing = satisfied.filter((x) => !x).length
  const text = await page.locator('aside').innerText().catch(() => '')
  const waiting = Number(/(\d+) waiting/.exec(text)?.[1] ?? 0)
  return { missing, waiting }
}

export default async function run(h) {
  const page = h.page
  await h.resize(1280, 820)
  await h.dismiss()

  const now = new Date()
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  const titles = ['E9 throwaway one', 'E9 throwaway two', 'E9 throwaway three']
  const ids = []
  for (const title of titles) ids.push((await h.api('POST', `/projects/${h.ids.inbox}/tasks`, { title })).id)

  try {
    await h.goto('/inbox')
    await h.dismiss()
    await h.wait(900)
    const row = (i) => page.locator(`[data-task-id="${ids[i]}"]`)
    const bar = page.getByRole('toolbar', { name: 'Selected tasks' })
    const rowBg = (i) => row(i).evaluate((el) => getComputedStyle(el).backgroundColor)
    const tokenBg = () =>
      page.evaluate(() => {
        const probe = document.createElement('div')
        probe.style.backgroundColor = 'var(--bg-selected)'
        document.body.appendChild(probe)
        const c = getComputedStyle(probe).backgroundColor
        probe.remove()
        return c
      })
    const ready = (await row(0).count()) === 1 && (await row(1).count()) === 1 && (await row(2).count()) === 1
    await h.assert('the three throwaway tasks are listed in the Inbox', ready)
    if (!ready) return

    // ---- A. Selecting ---------------------------------------------------------------------
    const pos = { x: 180, y: 12 }
    await row(0).click({ position: pos, modifiers: ['Control'] })
    await h.wait(250)
    await h.assert('one selected row shows no bar', async () => (await bar.count()) === 0)
    await row(1).click({ position: pos, modifiers: ['Control'] })
    await row(2).click({ position: pos, modifiers: ['Control'] })
    await h.wait(600)
    await h.assert('three selected rows show the bar', async () => (await bar.count()) === 1)
    await h.assert('the bar says "3 selected"', async () => ({ ok: (await bar.innerText()).includes('3 selected'), detail: await bar.innerText() }))
    const names = await bar.getByRole('button').evaluateAll((els) => els.map((e) => (e.getAttribute('aria-label') || e.textContent || '').trim()))
    await h.assert('the bar has Schedule, Complete, Move, Tag and Delete', {
      ok: ['Schedule', 'Complete', 'Move', 'Tag', 'Delete'].every((n) => names.includes(n)),
      detail: names.join(', '),
    })
    await h.assert('every bar button is at least 28 px high', async () => {
      const small = await bar.getByRole('button').evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().height < 27.5).map((e) => e.textContent))
      return { ok: small.length === 0, detail: small.join(', ') }
    })
    await page.mouse.move(5, 5)
    await h.wait(300)
    await h.assert('selected rows use bg.selected', async () => {
      const [a, b] = [await rowBg(0), await tokenBg()]
      return { ok: a === b, detail: `${a} vs ${b}` }
    })
    await h.capture('bar')

    // ---- D. axe ---------------------------------------------------------------------------
    const found = await h.axe('[role="toolbar"][aria-label="Selected tasks"]', { label: 'selection bar' })
    await h.assert('axe: no serious or critical violation in the bar', { ok: found.filter((v) => v.impact === 'serious' || v.impact === 'critical').length === 0, detail: found.map((v) => v.id).join(', ') })

    // ---- B. Schedule, then Tomorrow ---------------------------------------------------------
    await bar.getByRole('button', { name: 'Schedule' }).click()
    await h.wait(450)
    const pop = page.locator('[popover][aria-label="Schedule"]:popover-open')
    await h.assert('Schedule opens the When popover', async () => (await pop.count()) === 1)
    await h.capture('schedule')
    await pop.getByRole('button', { name: /^Tomorrow/ }).click()
    await h.wait(900)
    await h.assert('the popover closes after a quick choice and the bar stays', async () => (await pop.count()) === 0 && (await bar.count()) === 1)
    const isTomorrow = (t) => {
      const d = t.due_date ? new Date(t.due_date) : null
      return !!d && ymd(d) === ymd(tomorrow) && d.getHours() === 23 && d.getMinutes() === 59
    }
    const due = await settle(h, page, ids, isTomorrow)
    await h.assert('all three tasks are due tomorrow, date-only on the server, none waiting in the offline queue', {
      ok: due.missing === 0 && due.waiting === 0,
      detail: `${3 - due.missing} on the server, ${due.waiting} waiting`,
    })

    // ---- C. Move and Tag --------------------------------------------------------------------
    for (const [name, role] of [
      ['Move', 'listbox'],
      ['Tag', 'dialog'],
    ]) {
      const button = bar.getByRole('button', { name })
      await button.click()
      await h.wait(450)
      const open = await page.evaluate(() => {
        const el = [...document.querySelectorAll('[popover]')].filter((p) => p.matches(':popover-open')).pop()
        return { role: el?.getAttribute('role') ?? null, focus: !!el && el.contains(document.activeElement) }
      })
      await h.assert(`${name} opens a ${role} with focus inside`, { ok: open.role === role && open.focus, detail: JSON.stringify(open) })
      await h.key('Escape')
      await h.wait(350)
      await h.assert(`${name}: Escape closes the picker, focus returns to the button, the selection stays`, async () => {
        const focused = await button.evaluate((b) => b === document.activeElement)
        const barCount = await bar.count()
        return { ok: focused && barCount === 1, detail: `focused ${focused}, bar ${barCount}` }
      })
    }

    // ---- E. Escape clears -------------------------------------------------------------------
    await h.key('Escape')
    await h.wait(500)
    await h.assert('Escape clears the selection and the bar goes', async () => (await bar.count()) === 0)

    // ---- F. Complete ------------------------------------------------------------------------
    for (let i = 0; i < 3; i++) await row(i).click({ position: pos, modifiers: ['Control'] })
    await h.wait(500)
    await h.assert('the bar says "3 selected" again', async () => ({ ok: (await bar.count()) === 1 && (await bar.innerText()).includes('3 selected'), detail: (await bar.count()) ? await bar.innerText() : 'no bar' }))
    await bar.getByRole('button', { name: 'Complete' }).click()
    await h.wait(1200)
    await h.capture('after-complete')
    const done = await settle(h, page, ids, (t) => t.done === true)
    await h.assert('all three tasks are done on the server, none waiting in the offline queue', {
      ok: done.missing === 0 && done.waiting === 0,
      detail: `${3 - done.missing} on the server, ${done.waiting} waiting`,
    })
    await h.assert('every row shows as done', async () => {
      const states = await page.evaluate((list) => list.map((id) => !!document.querySelector(`[data-task-id="${id}"] [role="checkbox"][aria-checked="true"], [data-task-id="${id}"] .line-through`)), ids)
      return { ok: states.every(Boolean), detail: states.join(',') }
    })
    await h.assert('completing clears the selection and the bar', async () => (await bar.count()) === 0)
  } finally {
    await h.dismiss()
    for (const id of ids) {
      try {
        await h.api('DELETE', `/tasks/${id}`)
      } catch {
        // already gone
      }
    }
  }
}
