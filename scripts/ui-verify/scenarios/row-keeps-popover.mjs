// row-keeps-popover: an open card and its When popover survive what the date does to the row.
//
//   A. An undated row below dated ones gets a custom time: the default order moves it up and stops
//      it being reorderable. The same card stays open, the popover too, with focus in the field.
//   B. An undated row gets a day from the calendar: the same.
//   C. A dated row gets a date after the rows below it, so it moves down. Moving a popover's element
//      in the document hides it without an event: it is back, with focus, and one press on the chip
//      closes it (the app and the browser agree it was open).
//   D. Escape still closes it, and it stays closed when the list changes afterwards.
//   E. A dated row (which the order keeps in place) still drags onto a sidebar project.
//
// It adds tasks to the Inbox and deletes them again.
export const meta = {
  id: 'row-keeps-popover',
  wave: null,
  title: 'Task rows: the open card and When popover survive a date moving the row up or down',
}

const POP = '[popover][aria-label="Schedule"]'

export default async function run(h) {
  const page = h.page
  await h.resize(1280, 820)
  await h.dismiss()

  const made = []
  const task = async (title, extra = {}) => {
    const t = await h.api('POST', `/projects/${h.ids.inbox}/tasks`, { title, ...extra })
    made.push(t.id)
    return t.id
  }
  const dayFrom = (offset) => {
    const d = new Date()
    d.setDate(d.getDate() + offset)
    return d
  }
  const iso = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59).toISOString()
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

  const state = (id) => page.evaluate(({ id, POP }) => {
    const rows = [...document.querySelectorAll('[data-task-id]')].map((r) => r.getAttribute('data-task-id'))
    const row = document.querySelector(`[data-task-id="${id}"]`)
    const active = document.activeElement
    return {
      index: rows.indexOf(String(id)),
      open: document.querySelectorAll(`${POP}:popover-open`).length,
      mounted: document.querySelectorAll(POP).length,
      expanded: row?.querySelector('button[data-prop="schedule"]')?.getAttribute('aria-expanded') ?? null,
      sameCard: row?.dataset.keepsPopover === '1',
      focusInPopover: !!active?.closest?.(POP),
      focus: active?.getAttribute?.('aria-label') ?? active?.tagName ?? null,
    }
  }, { id, POP })

  const openWhen = async (id) => {
    const row = page.locator(`[data-task-id="${id}"]`)
    await row.scrollIntoViewIfNeeded()
    await row.click({ position: { x: 180, y: 12 } })
    await h.wait(700)
    await row.locator('button[data-prop="schedule"]').first().click()
    await h.wait(450)
    await page.evaluate((id) => { document.querySelector(`[data-task-id="${id}"]`).dataset.keepsPopover = '1' }, id)
  }
  const closeCard = async () => {
    await h.key('Escape')
    await h.wait(300)
    await h.key('Escape')
    await h.wait(500)
  }
  const pickDay = async (date) => {
    await page.locator(`${POP}:popover-open [role="gridcell"] button[data-date="${ymd(date)}"]`).click()
    await h.wait(1500)
  }
  const stillOpen = (s) => s.open === 1 && s.expanded === 'true' && s.sameCard && s.focusInPopover

  try {
    const soon = await task('Keeps popover: dated soon', { due_date: iso(dayFrom(1)) })
    await task('Keeps popover: dated later', { due_date: iso(dayFrom(2)) })
    const typed = await task('Keeps popover: custom time')
    const picked = await task('Keeps popover: picked day')
    await h.goto('/today')
    await h.wait(500)
    await h.goto('/inbox')
    await h.wait(1200)

    // ---- A. Up, by a custom time ---------------------------------------------------------------
    await openWhen(typed)
    const typedBefore = await state(typed)
    await page.locator(`${POP}:popover-open`).getByLabel('Custom time').click()
    await h.type('5pm', { delay: 20 })
    await h.key('Enter')
    await h.wait(1500)
    const typedAfter = await state(typed)
    await h.assert('A: a custom time moves the undated row up', { ok: typedAfter.index < typedBefore.index, detail: `${typedBefore.index} -> ${typedAfter.index}` })
    await h.assert('A: the same card and popover stay open, with focus in the field', { ok: stillOpen(typedAfter) && typedAfter.focus === 'Custom time', detail: JSON.stringify(typedAfter) })
    await closeCard()

    // ---- B. A day from the calendar ------------------------------------------------------------
    await openWhen(picked)
    await pickDay(dayFrom(3))
    const pickedAfter = await state(picked)
    await h.assert('B: a day from the calendar keeps the same card and popover open', { ok: stillOpen(pickedAfter), detail: JSON.stringify(pickedAfter) })
    await closeCard()

    // ---- C. Down -------------------------------------------------------------------------------
    await openWhen(soon)
    const soonBefore = await state(soon)
    await pickDay(dayFrom(6))
    const soonAfter = await state(soon)
    await h.assert('C: a later date moves the row down', { ok: soonAfter.index > soonBefore.index, detail: `${soonBefore.index} -> ${soonAfter.index}` })
    await h.assert('C: the popover is back after the move, with focus inside', { ok: stillOpen(soonAfter), detail: JSON.stringify(soonAfter) })
    await h.capture('moved-down')
    await page.locator(`[data-task-id="${soon}"] button[data-prop="schedule"]`).first().click()
    await h.wait(450)
    const pressed = await state(soon)
    await h.assert('C: one press on the chip closes it', { ok: pressed.open === 0 && pressed.mounted === 0 && pressed.expanded === 'false', detail: JSON.stringify(pressed) })

    // ---- D. Closed stays closed ----------------------------------------------------------------
    await page.locator(`[data-task-id="${soon}"] button[data-prop="schedule"]`).first().click()
    await h.wait(450)
    await h.key('Escape')
    await h.wait(400)
    const escaped = await state(soon)
    await h.assert('D: Escape closes it and focus returns to the chip', { ok: escaped.open === 0 && escaped.mounted === 0 && /^Schedule/.test(escaped.focus ?? ''), detail: JSON.stringify(escaped) })
    await page.evaluate(() => {
      const probe = document.createElement('div')
      document.body.append(probe)
      probe.remove()
    })
    await h.wait(300)
    const after = await state(soon)
    await h.assert('D: a later change in the document does not bring it back', { ok: after.open === 0, detail: JSON.stringify(after) })

    // ---- E. A dated row still drags out --------------------------------------------------------
    // An open card does not drag: a press on the empty part of the list closes it.
    await page.mouse.click(760, 740)
    await h.wait(600)
    const target = page.locator(`aside [data-sidebar-project="${h.ids.work}"]`)
    await target.scrollIntoViewIfNeeded()
    const box = await target.boundingBox()
    await h.drag(`[data-task-id="${soon}"]`, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, { hold: true })
    await h.wait(300)
    await h.capture('dragging')
    await page.mouse.up()
    await h.wait(1200)
    const moved = await h.api('GET', `/tasks/${soon}`)
    await h.assert('E: a dated row drags onto a sidebar project', { ok: moved.project_id === h.ids.work, detail: `project ${moved.project_id}, wanted ${h.ids.work}` })
  } finally {
    for (const id of made) await h.api('DELETE', `/tasks/${id}`).catch(() => {})
  }
}
