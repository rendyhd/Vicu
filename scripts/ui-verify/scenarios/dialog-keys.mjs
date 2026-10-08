// dialog-keys (card 3.2a, D-20): modal dialogs on the native <dialog>.
//
//   A. Delete on a Ctrl-clicked row opens the confirmation as a modal alertdialog with a name and a
//      message, focus on Cancel, the page behind inert, Tab staying inside, Escape closing it with
//      focus back on the row, and a press on the backdrop closing it. Nothing is deleted.
//   B. "New list" opens the custom-list dialog named by its title, with focus in the name field;
//      Escape closes it and focus returns to the button that opened it.
//
// Written against behaviour: the dialog is found by role and by `:modal`.
export const meta = {
  id: 'DK',
  wave: 3,
  title: 'Dialogs: confirm and custom-list dialog are modal, named, trap Tab, close on Escape and the backdrop, return focus',
}

const modalState = (page) =>
  page.evaluate(() => {
    const dialogs = [...document.querySelectorAll('dialog')].filter((d) => d.matches(':modal'))
    const d = dialogs[0]
    const active = document.activeElement
    return {
      count: dialogs.length,
      role: d?.getAttribute('role') ?? (d ? 'dialog' : null),
      label: d?.getAttribute('aria-label') ?? document.getElementById(d?.getAttribute('aria-labelledby') ?? '')?.textContent ?? null,
      described: !!document.getElementById(d?.getAttribute('aria-describedby') ?? '')?.textContent,
      focusInside: !!d && !!active && d.contains(active),
      focusName: (active?.getAttribute('aria-label') || active?.textContent || active?.tagName || '').trim().slice(0, 30),
      activeTag: active?.tagName ?? null,
    }
  })

export default async function run(h) {
  const page = h.page
  await h.resize(1280, 820)
  await h.goto('/today')

  // ---- A. Confirm dialog -------------------------------------------------------------------
  // The harness profile turns the delete confirmation off; this scenario needs it on (and must
  // never delete a seeded task), so it sets it for the run and checks it before pressing Delete.
  await page.evaluate(() => window.api.saveConfigPatch({ confirm_before_delete: true }))
  await page.reload()
  await h.settle(page, 600)
  await h.goto('/today')
  const confirmOn = await page.evaluate(async () => (await window.api.getConfig())?.confirm_before_delete === true)
  await h.assert('the delete confirmation is on for this run', confirmOn)
  if (!confirmOn) return

  const row = h.rows().first()
  const taskId = await row.getAttribute('data-task-id')
  await row.click({ modifiers: ['Control'], position: { x: 180, y: 12 } })
  await h.wait(200)
  await h.key('Delete')
  await h.wait(300)

  let s = await modalState(page)
  await h.assert('Delete opens one modal dialog', { ok: s.count === 1, detail: JSON.stringify(s) })
  if (s.count !== 1) return
  await h.assert('the confirmation is an alertdialog with a name and a described message', { ok: s.role === 'alertdialog' && !!s.label && s.described, detail: JSON.stringify(s) })
  await h.assert('focus starts on Cancel', { ok: s.focusInside && s.focusName === 'Cancel', detail: s.focusName })
  await h.capture('confirm')

  const behindInert = await page.evaluate(() => {
    const r = document.querySelector('[data-task-id]')?.getBoundingClientRect()
    if (!r) return false
    // A pointer over the row lands on the dialog's backdrop, not on the row.
    const hit = document.elementFromPoint(r.x + 40, r.y + r.height / 2)
    return !!hit && !hit.closest('[data-task-id]')
  })
  await h.assert('the page behind the dialog cannot be reached by the pointer', behindInert)

  let stayed = true
  for (let i = 0; i < 6; i++) {
    await h.key('Tab')
    if (!(await modalState(page)).focusInside) stayed = false
  }
  await h.assert('six Tab presses keep focus inside the dialog', stayed)
  await h.key('Shift+Tab')
  await h.assert('Shift+Tab keeps focus inside the dialog', async () => (await modalState(page)).focusInside)

  await h.key('Escape')
  await h.wait(250)
  s = await modalState(page)
  await h.assert('Escape closes the dialog', { ok: s.count === 0, detail: JSON.stringify(s) })
  const back = await page.evaluate((id) => {
    const el = document.activeElement
    return !!el && !!el.closest(`[data-task-id="${id}"]`)
  }, taskId)
  await h.assert('focus returns to the row that was focused', back)
  await h.assert('nothing was deleted', async () => !!(await h.api('GET', `/tasks/${taskId}`))?.id)

  await h.key('Delete')
  await h.wait(300)
  await h.assert('Delete opens it again', async () => (await modalState(page)).count === 1)
  await page.mouse.click(8, 8)
  await h.wait(250)
  await h.assert('a press on the backdrop closes it', async () => (await modalState(page)).count === 0)
  await h.assert('the task still exists', async () => !!(await h.api('GET', `/tasks/${taskId}`))?.id)

  // ---- B. Custom-list dialog ---------------------------------------------------------------
  await h.dismiss()
  await h.goto('/today')
  const newList = page.getByRole('button', { name: 'New list' })
  await newList.focus()
  await h.key('Enter')
  await h.wait(350)
  s = await modalState(page)
  await h.assert('New list opens a modal dialog named by its title', { ok: s.count === 1 && /new list/i.test(s.label ?? ''), detail: JSON.stringify(s) })
  await h.assert('focus starts in the name field', async () => {
    const f = await page.evaluate(() => ({ tag: document.activeElement?.tagName, ph: document.activeElement?.getAttribute('placeholder') }))
    return f.tag === 'INPUT' && f.ph === 'My List'
  })
  await h.capture('custom-list')
  await h.assert('axe finds no serious violation in the dialog', async () => {
    const found = await h.axe('dialog[open]', { label: 'custom-list dialog' })
    return { ok: found.filter((v) => v.impact === 'serious' || v.impact === 'critical').length === 0, detail: found.map((v) => v.id).join(', ') }
  })
  await h.key('Escape')
  await h.wait(250)
  await h.assert('Escape closes it', async () => (await modalState(page)).count === 0)
  await h.assert('focus returns to the New list button', async () => page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'New list'))
  await page.evaluate(() => window.api.saveConfigPatch({ confirm_before_delete: false }))
}
