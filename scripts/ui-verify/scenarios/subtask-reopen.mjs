// subtask-reopen (rendyhd/Vicu#76): a done subtask can be reopened, and a reopened subtask is shown
// once, under its parent, never again as a top-level task of the list. Uses its own throwaway parent
// and subtask in the Inbox and deletes them at the end.
//
//   A. In the parent's open card, the checkbox of a done subtask reopens it (it used to do nothing).
//   B. Open subtask on a done subtask, then uncheck it in its own card: one row for the subtask, under
//      the parent, while the card is open and after it closes.
export const meta = {
  id: 'SR',
  wave: 3,
  title: 'Reopening a subtask: from the card, and from its opened row, without a second row (issue 76)',
}

export default async function run(h) {
  const page = h.page
  await h.resize(1280, 820)
  await h.dismiss()

  const parent = await h.api('POST', `/projects/${h.ids.inbox}/tasks`, { title: 'SR throwaway parent' })
  const child = await h.api('POST', `/projects/${h.ids.inbox}/tasks`, { title: 'SR child' })
  await h.api('PUT', `/tasks/${parent.id}/relations`, { other_task_id: child.id, relation_kind: 'subtask' })
    .catch(() => h.api('POST', `/tasks/${parent.id}/relations`, { other_task_id: child.id, relation_kind: 'subtask' }))

  const until = async (read, ok, tries = 20) => {
    let value = await read()
    for (let i = 0; i < tries && !ok(value); i++) {
      await h.wait(250)
      value = await read()
    }
    return value
  }
  const card = () => page.locator(`[data-task-id="${parent.id}"]`)
  const childRows = () => page.locator(`[data-task-id="${child.id}"]`)
  const isCard = async (id) => (await page.locator(`[data-task-id="${id}"] button[data-prop="schedule"]`).count()) > 0
  const serverDone = async () => (await h.api('GET', `/tasks/${child.id}`)).done
  const completeOnServer = async () => {
    await h.api('PATCH', `/tasks/${child.id}`, { done: true })
    await until(serverDone, (v) => v === true)
  }
  const openParent = async () => {
    // A fresh window, so the lists and the parent's subtask list read the server again.
    await page.reload()
    await h.wait(900)
    await h.goto('/inbox')
    await h.dismiss()
    const row = card()
    await row.waitFor({ timeout: 8000 }).catch(() => {})
    // A reload can draw the list from the saved cache before the new task arrives: read it again.
    for (let i = 0; i < 3 && (await row.count()) !== 1; i++) {
      await h.key('F5')
      await row.waitFor({ timeout: 5000 }).catch(() => {})
    }
    if ((await row.count()) !== 1) {
      await h.capture('parent-row-missing', { clip: page.locator('main') })
      return false
    }
    await row.scrollIntoViewIfNeeded()
    await row.click({ position: { x: 180, y: 12 } })
    await h.wait(800)
    return isCard(parent.id)
  }

  try {
    // ---- A. Reopen from the parent's card ----------------------------------------------------
    await completeOnServer()
    if (!(await h.assert('A: the parent opens as a card', await openParent()))) return
    const box = card().getByRole('checkbox', { name: `Complete ${child.title}` })
    await h.assert('A: the done subtask shows checked in the card', { ok: (await box.getAttribute('aria-checked')) === 'true' })
    await box.click()
    const reopened = await until(serverDone, (v) => v === false)
    await h.assert('A: the checkbox of a done subtask reopens it on the server', { ok: reopened === false, detail: String(reopened) })
    await h.wait(400)
    await h.assert('A: the card shows it open', { ok: (await box.getAttribute('aria-checked')) === 'false' })
    await h.assert('A: the subtask gets no top-level row', { ok: (await childRows().count()) === 0, detail: String(await childRows().count()) })
    await h.capture('reopened-in-card', { clip: page.locator('main') })
    await h.key('Escape')
    await h.wait(600)
    await h.assert('A: after the card closes there is still no top-level row', { ok: (await childRows().count()) === 0 })

    // ---- B. Open subtask, then uncheck it in its own card (the issue's steps) ----------------
    await completeOnServer()
    if (!(await h.assert('B: the parent opens as a card', await openParent()))) return
    await card().getByRole('button', { name: `Rename ${child.title}` }).click({ button: 'right' })
    await h.wait(350)
    await page.locator('[role="menu"] [role="menuitem"]', { hasText: 'Open subtask' }).click()
    await h.wait(900)
    await h.assert('B: the subtask opens as its own card', await isCard(child.id))
    await page.locator(`[data-task-id="${child.id}"]`).getByRole('checkbox', { name: `Complete ${child.title}` }).first().click()
    const reopenedB = await until(serverDone, (v) => v === false)
    await h.assert('B: unchecking it reopens it on the server', { ok: reopenedB === false })
    await h.wait(600)
    const shown = await childRows().count()
    await h.assert('B: the reopened subtask is shown once, not twice', { ok: shown === 1, detail: String(shown) })
    const order = await page.evaluate(([p, c]) => {
      const ids = [...document.querySelectorAll('[data-task-id]')].map((el) => Number(el.getAttribute('data-task-id')))
      return ids.indexOf(c) - ids.indexOf(p)
    }, [parent.id, child.id])
    await h.assert('B: it sits right under its parent', { ok: order === 1, detail: String(order) })
    await h.capture('reopened-opened-subtask', { clip: page.locator('main') })

    await h.key('Escape')
    await h.wait(700)
    const after = await childRows().count()
    await h.assert('B: after the card closes it is still one row', { ok: after === 1, detail: String(after) })
    const checked = await childRows().getByRole('checkbox', { name: `Complete ${child.title}` }).first().getAttribute('aria-checked')
    await h.assert('B: the row shows the subtask open', { ok: checked === 'false', detail: String(checked) })
    await h.capture('after-close', { clip: page.locator('main') })
  } finally {
    for (const t of [child, parent]) await h.api('DELETE', `/tasks/${t.id}`).catch(() => {})
  }
}
