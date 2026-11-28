// subtask-attach (issue 78, cross-app semantics 24): an existing task made a subtask of another,
// and taken out again. Uses its own throwaway tasks (three in the Inbox, one in Home) and deletes
// them at the end.
//
//   A. The task menu's "Make subtask of..." offers the Inbox's tasks with nothing typed; picking one
//      puts the task under it on the server, and the row leaves the list. The toast's Undo takes it out.
//   B. A search finds a task of another project; the task moves to the parent's project with it.
//   C. A task cannot go under its own subtask: nothing changes and a toast says why.
//   D. The open card's "Add existing task" puts a task under it; the subtask's menu has "Remove from
//      parent", which takes it out again.
//   E. Dragging a row onto the middle of another row outlines that row, the chip says whose subtask it
//      becomes, and the drop makes it one. Dropping on the top edge of a row still reorders.
export const meta = {
  id: 'SA',
  wave: 3,
  title: 'Making an existing task a subtask: menu, picker, card, drag (issue 78)',
}

export default async function run(h) {
  const page = h.page
  await h.resize(1280, 820)
  await h.dismiss()

  const made = []
  const make = async (project, title) => {
    const task = await h.api('POST', `/projects/${project}/tasks`, { title })
    made.push(task)
    return task
  }
  const parent = await make(h.ids.inbox, 'SA parent')
  const child = await make(h.ids.inbox, 'SA child')
  const other = await make(h.ids.inbox, 'SA other')
  const away = await make(h.ids.home, 'SA away task')

  const until = async (read, ok, tries = 24) => {
    let value = await read()
    for (let i = 0; i < tries && !ok(value); i++) {
      await h.wait(250)
      value = await read()
    }
    return value
  }
  const parentsOf = async (id) => ((await h.api('GET', `/tasks/${id}`)).related_tasks?.parenttask ?? []).map((t) => t.id)
  const projectOf = async (id) => (await h.api('GET', `/tasks/${id}`)).project_id
  const row = (id) => page.locator(`[data-task-id="${id}"]`).first()
  const toastText = async () => (await page.locator('[data-toast-kind]').allTextContents()).join(' | ')
  const clickUndo = async () => {
    const undo = page.getByRole('button', { name: 'Undo', exact: true }).last()
    await undo.click()
  }
  const inbox = async () => {
    await h.goto('/inbox')
    await h.dismiss()
    await h.wait(400)
  }
  const openMenu = async (id) => {
    await row(id).scrollIntoViewIfNeeded()
    await row(id).click({ button: 'right', position: { x: 200, y: 12 } })
    await h.wait(300)
  }
  const pickParent = async (id, search) => {
    await openMenu(id)
    await page.getByRole('menuitem', { name: 'Make subtask of...' }).click()
    await h.wait(300)
    if (search) {
      await h.type(search)
      await h.wait(300)
    }
  }
  const options = () => page.locator('[role="dialog"][popover] [role="option"]')
  const detachAll = async (id) => {
    for (const p of await parentsOf(id)) await h.api('DELETE', `/tasks/${p}/relations/subtask/${id}`).catch(() => {})
  }

  try {
    // ---- A. Menu and picker ------------------------------------------------------------------
    await inbox()
    await pickParent(child.id)
    const offered = await options().allTextContents()
    await h.assert('A: nothing typed offers tasks of the same project', {
      ok: offered.some((s) => s.includes('SA parent')) && offered.some((s) => s.includes('SA other')) && !offered.some((s) => s.includes('SA child')),
      detail: offered.slice(0, 8).join(' | '),
    })
    await h.assert('A: nothing typed offers no task of another project', !offered.some((s) => s.includes('SA away task')))
    await h.capture('picker')
    await options().filter({ hasText: 'SA parent' }).first().click()
    const under = await until(() => parentsOf(child.id), (v) => v.includes(parent.id))
    await h.assert('A: the server has the task under the picked parent', { ok: under.length === 1 && under[0] === parent.id, detail: JSON.stringify(under) })
    await h.wait(500)
    await h.assert('A: the toast says where it went', { ok: (await toastText()).includes('Moved under “SA parent”'), detail: await toastText() })
    await h.assert('A: the row leaves the list (it is listed under its parent now)', (await page.locator(`[data-task-id="${child.id}"]`).count()) === 0)
    await clickUndo()
    const undone = await until(() => parentsOf(child.id), (v) => v.length === 0)
    await h.assert('A: Undo takes it out again', { ok: undone.length === 0, detail: JSON.stringify(undone) })

    // ---- B. Another project ------------------------------------------------------------------
    await inbox()
    await h.goto(`/project/${h.ids.home}`)
    await h.dismiss()
    await h.wait(400)
    await pickParent(away.id, 'SA par')
    const found = await options().allTextContents()
    await h.assert('B: a search finds a task of another project and names its project', {
      ok: found.some((s) => s.includes('SA parent') && s.includes('in Inbox')),
      detail: found.join(' | '),
    })
    await page.keyboard.press('Enter')
    const moved = await until(() => projectOf(away.id), (v) => v === h.ids.inbox)
    await h.assert('B: the task moves to the parent\'s project', { ok: moved === h.ids.inbox, detail: String(moved) })
    await h.assert('B: and is under the parent', (await parentsOf(away.id)).includes(parent.id))
    await h.wait(400)
    await h.assert('B: the toast names the project', { ok: (await toastText()).includes('in Inbox'), detail: await toastText() })
    await clickUndo()
    const back = await until(() => projectOf(away.id), (v) => v === h.ids.home)
    await h.assert('B: Undo moves it back to its project and out of the parent', {
      ok: back === h.ids.home && (await parentsOf(away.id)).length === 0,
      detail: String(back),
    })

    // ---- C. A loop is refused ----------------------------------------------------------------
    await h.api('PUT', `/tasks/${parent.id}/relations`, { other_task_id: child.id, relation_kind: 'subtask' })
      .catch(() => h.api('POST', `/tasks/${parent.id}/relations`, { other_task_id: child.id, relation_kind: 'subtask' }))
    await h.goto(`/project/${h.ids.home}`)
    await inbox()
    // The parent under its own subtask: the child is not offered (it is below the parent).
    await pickParent(parent.id, 'SA child')
    await h.assert('C: the picker does not offer a task below the one being moved', (await options().count()) === 0)
    await h.dismiss()
    await detachAll(child.id)

    // ---- D. The card -------------------------------------------------------------------------
    await h.goto(`/project/${h.ids.home}`)
    await inbox()
    await row(parent.id).click({ position: { x: 200, y: 12 } })
    await h.wait(700)
    await row(parent.id).locator('button[data-prop="checklist"]').click()
    await h.wait(300)
    const addExisting = row(parent.id).getByRole('button', { name: 'Add an existing task as a subtask of SA parent' })
    await h.assert('D: the card has Add existing task next to the subtask field', (await addExisting.count()) === 1)
    await addExisting.click()
    await h.wait(300)
    await h.type('SA oth')
    await h.wait(300)
    await h.capture('add-existing')
    await options().filter({ hasText: 'SA other' }).first().click()
    const added = await until(() => parentsOf(other.id), (v) => v.includes(parent.id))
    await h.assert('D: Add existing task puts the task under the card\'s task', added.includes(parent.id))
    await h.wait(600)
    const subtaskTitle = row(parent.id).getByRole('button', { name: 'Rename SA other' })
    await h.assert('D: the card lists it as a subtask', (await subtaskTitle.count()) === 1)
    await subtaskTitle.click({ button: 'right' })
    await h.wait(300)
    await page.getByRole('menuitem', { name: 'Remove from parent' }).click()
    const removed = await until(() => parentsOf(other.id), (v) => v.length === 0)
    await h.assert('D: Remove from parent takes it out on the server', removed.length === 0)
    await h.wait(400)
    await h.assert('D: the toast says so', { ok: (await toastText()).includes('“SA other” is a task of its own again'), detail: await toastText() })

    // ---- E. Drag onto a row ------------------------------------------------------------------
    await inbox()
    const target = await row(parent.id).boundingBox()
    await h.drag(`[data-task-id="${child.id}"]`, `[data-task-id="${parent.id}"]`, { hold: true })
    await h.wait(300)
    const hint = await page.locator('[data-drop-hint="nest"]').textContent().catch(() => null)
    await h.assert('E: over the middle of a row the chip says whose subtask it becomes', { ok: hint?.includes('Subtask of “SA parent”') === true, detail: hint ?? 'no hint' })
    await h.capture('drag-nest')
    await h.mouseUp()
    const dropped = await until(() => parentsOf(child.id), (v) => v.includes(parent.id))
    await h.assert('E: the drop makes it a subtask', dropped.includes(parent.id))
    await detachAll(child.id)
    await h.goto(`/project/${h.ids.home}`)
    await inbox()
    const box = await row(other.id).boundingBox()
    if (target && box) {
      await h.drag(`[data-task-id="${child.id}"]`, { x: box.x + box.width / 2, y: box.y + 3 }, { hold: true })
      await h.wait(300)
      await h.assert('E: on the top edge of a row there is no subtask hint', (await page.locator('[data-drop-hint="nest"]').count()) === 0)
      await h.mouseUp()
      await h.wait(800)
      await h.assert('E: and the drop does not make a subtask', (await parentsOf(child.id)).length === 0)
    }
  } finally {
    for (const task of made) await h.api('DELETE', `/tasks/${task.id}`).catch(() => {})
  }
}
