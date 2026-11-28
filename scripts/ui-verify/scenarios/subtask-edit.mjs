// subtask-edit (issue 51): the subtasks in an open card can be renamed, opened and deleted, not only
// completed. Uses its own throwaway parent and subtasks in the Inbox and deletes them at the end.
//
//   A. Clicking a subtask's title renames it in place: Enter saves (to the server), focus returns to
//      the title; Escape cancels and leaves the card open.
//   B. Right-click on a subtask gives Rename, Open subtask and Delete subtask.
//   C. Delete subtask asks first, then the subtask is gone from the card and from the server.
//   D. Open subtask closes the parent's card and opens the subtask as its own card under the parent's
//      row; after Escape the subtask's row stays under the parent until another task opens.
export const meta = {
  id: 'SE',
  wave: 3,
  title: 'Subtasks in an open card: rename in place, open as their own task, delete (issue 51)',
}

export default async function run(h) {
  const page = h.page
  await h.resize(1280, 820)
  await h.dismiss()

  const parent = await h.api('POST', `/projects/${h.ids.inbox}/tasks`, { title: 'SE throwaway parent' })
  const made = []
  for (const title of ['SE child one', 'SE child two']) {
    const child = await h.api('POST', `/projects/${h.ids.inbox}/tasks`, { title })
    await h.api('PUT', `/tasks/${parent.id}/relations`, { other_task_id: child.id, relation_kind: 'subtask' })
      .catch(() => h.api('POST', `/tasks/${parent.id}/relations`, { other_task_id: child.id, relation_kind: 'subtask' }))
    made.push(child)
  }
  const [one, two] = made
  const until = async (read, ok, tries = 20) => {
    let value = await read()
    for (let i = 0; i < tries && !ok(value); i++) {
      await h.wait(250)
      value = await read()
    }
    return value
  }
  const card = () => page.locator(`[data-task-id="${parent.id}"]`)
  const isCard = async (id) => (await page.locator(`[data-task-id="${id}"] button[data-prop="schedule"]`).count()) > 0
  const openParent = async () => {
    await h.goto('/inbox')
    await h.dismiss()
    const row = card()
    await row.scrollIntoViewIfNeeded()
    await row.click({ position: { x: 180, y: 12 } })
    await h.wait(800)
    return isCard(parent.id)
  }

  // The harness profile turns the delete confirmation off; C checks that a subtask's Delete asks, so
  // turn it on for the run (the dialog reads it at start-up, so reload) and put it back at the end.
  await page.evaluate(() => window.api.saveConfigPatch({ confirm_before_delete: true }))
  await page.reload()
  await h.wait(800)

  try {
    if (!(await h.assert('the parent opens as a card', await openParent()))) return

    // ---- A. Rename in place ------------------------------------------------------------------
    const title = card().getByRole('button', { name: `Rename ${one.title}` })
    await h.assert('A: each subtask title is a rename button', (await title.count()) === 1)
    await title.click()
    await h.wait(200)
    const input = card().getByRole('textbox', { name: `Rename ${one.title}` })
    await h.assert('A: clicking the title shows a focused text field', {
      ok: await input.evaluate((el) => el === document.activeElement).catch(() => false),
    })
    await page.keyboard.press('ControlOrMeta+a')
    await h.type('SE child renamed')
    await h.capture('rename-editing', { clip: card() })
    await h.key('Enter')
    const renamed = await until(async () => (await h.api('GET', `/tasks/${one.id}`)).title, (v) => v === 'SE child renamed')
    await h.assert('A: Enter saves the new title to the server', { ok: renamed === 'SE child renamed', detail: renamed })
    await h.wait(300)
    await h.assert('A: the card shows the new title and focus is back on it', {
      ok: await card().getByRole('button', { name: 'Rename SE child renamed' }).evaluate((el) => el === document.activeElement).catch(() => false),
    })

    await card().getByRole('button', { name: `Rename ${two.title}` }).click()
    await h.wait(200)
    await h.type('nope')
    await h.key('Escape')
    await h.wait(300)
    const unchanged = (await h.api('GET', `/tasks/${two.id}`)).title
    await h.assert('A: Escape cancels the rename', { ok: unchanged === two.title, detail: unchanged })
    await h.assert('A: Escape in the rename field leaves the card open', await isCard(parent.id))

    // ---- B. Right-click menu -----------------------------------------------------------------
    await card().getByRole('button', { name: `Rename ${two.title}` }).click({ button: 'right' })
    await h.wait(350)
    const items = await page.locator('[role="menu"] [role="menuitem"]').allTextContents()
    await h.assert('B: right-click offers Rename, Open subtask, Move up, Remove from parent and Delete subtask', {
      ok: JSON.stringify(items.map((s) => s.trim())) === JSON.stringify(['Rename', 'Open subtask', 'Move up', 'Remove from parent', 'Delete subtask']),
      detail: items.join(' | '),
    })
    await h.capture('subtask-menu')
    await h.key('Escape')
    await h.wait(250)

    // ---- C. Delete ---------------------------------------------------------------------------
    await card().getByRole('button', { name: `Rename ${two.title}` }).hover()
    await h.wait(200)
    await h.capture('row-actions', { clip: card() })
    await card().getByRole('button', { name: `Delete ${two.title}` }).click()
    await h.wait(500)
    const dialog = page.locator('[role="alertdialog"]')
    const asked = (await dialog.count()) > 0 && (await dialog.isVisible())
    await h.assert('C: Delete subtask asks first', asked)
    if (asked) await dialog.getByRole('button', { name: 'Delete', exact: true }).click()
    const gone = await until(
      async () => h.api('GET', `/tasks/${two.id}`).then(() => false, () => true),
      (v) => v === true,
    )
    await h.assert('C: the subtask is deleted on the server', gone)
    await h.wait(300)
    await h.assert('C: the subtask is gone from the card', (await card().getByRole('button', { name: `Rename ${two.title}` }).count()) === 0)

    // ---- D. Open as its own task -------------------------------------------------------------
    await card().getByRole('button', { name: 'Rename SE child renamed' }).hover()
    await card().getByRole('button', { name: 'Open SE child renamed' }).click()
    await h.wait(900)
    await h.assert('D: the subtask opens as its own card', await isCard(one.id))
    await h.assert('D: the parent card closes to its row', !(await isCard(parent.id)) && (await card().count()) === 1)
    const order = await page.evaluate(([p, c]) => {
      const ids = [...document.querySelectorAll('[data-task-id]')].map((el) => Number(el.getAttribute('data-task-id')))
      return ids.indexOf(c) - ids.indexOf(p)
    }, [parent.id, one.id])
    await h.assert('D: the subtask sits right under its parent', { ok: order === 1, detail: String(order) })
    await h.capture('subtask-open', { clip: page.locator('main') })

    await h.key('Escape')
    await h.wait(700)
    await h.assert('D: after Escape the subtask row stays under the parent', {
      ok: !(await isCard(one.id)) && (await page.locator(`[data-task-id="${one.id}"]`).count()) === 1,
    })
    await card().click({ position: { x: 180, y: 12 } })
    await h.wait(800)
    await h.assert('D: opening the parent again shows the card and puts the subtask row away', {
      ok: (await isCard(parent.id)) && (await page.locator(`[data-task-id="${one.id}"]`).count()) === 0,
    })
    await h.key('Escape')
  } finally {
    await page.evaluate(() => window.api.saveConfigPatch({ confirm_before_delete: false })).catch(() => {})
    for (const t of [...made, parent]) await h.api('DELETE', `/tasks/${t.id}`).catch(() => {})
  }
}
