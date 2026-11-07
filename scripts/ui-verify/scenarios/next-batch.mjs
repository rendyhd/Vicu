// next-batch: the batch of issues labeled `next` on the desktop.
//
//   A. A long note folds at half the visible height with Show all; a short one does not (#90).
//   B. Move line up and down in the text menu and with Alt+arrows, on list lines only (#91).
//   C. Search chips: a filter narrows the results, works without text, X clears it (#96).
//   D. Save as template, the Template button, the arrow's Edit and Remove, making a task (#84).
//   E. Dragging a subtask and Move up in its menu; the order survives a reload (#91).
//
// Works on throwaway Inbox tasks titled `NXB ...` and deletes them at the end.
export const meta = {
  id: 'NXB',
  wave: 3,
  title: 'The next batch: long notes, Move buttons, search filters, templates, subtask order',
}

const LONG = Array.from({ length: 80 }, (_, i) => `<p>Line ${i + 1} of a long note about the trip.</p>`).join('')
const LIST = '<ul><li><p>First item</p></li><li><p>Second item</p></li><li><p>Third item</p></li></ul>'

export default async function run(h) {
  const page = h.page
  await h.resize(1280, 820)
  await h.dismiss()
  const inbox = h.ids.inbox
  const made = []
  const task = async (title, fields = {}) => {
    const created = await h.api('POST', `/projects/${inbox}/tasks`, { title: `NXB ${title}`, ...fields })
    made.push(created.id)
    return created
  }
  const row = (id) => page.locator(`[data-task-id="${id}"]`)
  const open = async (id) => {
    await h.goto('/inbox')
    await h.dismiss()
    await h.wait(600)
    if ((await row(id).count()) === 0) {
      throw new Error(`no row for task ${id}`)
    }
    await row(id).scrollIntoViewIfNeeded()
    await row(id).click({ position: { x: 180, y: 12 } })
    await h.wait(800)
  }

  try {
    // Everything first: a task made through the API later is not in a list already read.
    const long = await task('Long note', { description: LONG })
    const short = await task('Short note', { description: '<p>Just a line.</p>' })
    const list = await task('List note', { description: LIST })
    await task('Search high', { priority: 3 })
    await task('Search low', { priority: 1 })
    const source = await task('Template source', { description: '<p>Bring it</p>', priority: 3 })
    for (const name of ['One', 'Two']) {
      const child = await task(`Template sub ${name}`)
      await h.api('POST', `/tasks/${source.id}/relations`, { other_task_id: child.id, relation_kind: 'subtask' })
    }
    const parent = await task('Order parent')
    for (const name of ['Alpha', 'Beta', 'Gamma']) {
      const child = await task(`Order ${name}`)
      await h.api('POST', `/tasks/${parent.id}/relations`, { other_task_id: child.id, relation_kind: 'subtask' })
    }
    await page.reload()
    await h.wait(2500)

    // ---- A. Long notes -----------------------------------------------------------------------
    await open(long.id)
    const fold = page.getByRole('button', { name: 'Show all' })
    await h.assert('A: a long note offers Show all', (await fold.count()) === 1)
    await h.capture('notes-folded')
    await fold.click()
    await h.wait(400)
    await h.assert('A: Show all opens it', (await fold.count()) === 0)
    await h.capture('notes-open')
    await open(short.id)
    await h.assert('A: a short note does not fold', (await page.getByRole('button', { name: 'Show all' }).count()) === 0)

    // ---- B. Move buttons ---------------------------------------------------------------------
    await open(list.id)
    const items = () => page.evaluate((id) => [...document.querySelectorAll(`[data-task-id="${id}"] li`)].map((li) => li.textContent.trim()), list.id)
    const second = row(list.id).locator('li', { hasText: 'Second item' }).locator('p')
    await second.click()
    await h.wait(300)
    await page.keyboard.press('Shift+Home')
    await h.wait(500)
    await h.capture('move-bubble-menu')
    const up = page.getByRole('button', { name: /Move line up/ })
    await h.assert('B: the text menu has Move line up on a list line', (await up.count()) >= 1)
    if (await up.count()) await up.first().click()
    await h.wait(400)
    await h.assert('B: Move line up moved it', { ok: (await items())[0] === 'Second item', detail: JSON.stringify(await items()) })
    await page.keyboard.press('Alt+ArrowDown')
    await h.wait(400)
    await h.assert('B: Alt+Down moved it back', { ok: (await items())[1] === 'Second item', detail: JSON.stringify(await items()) })

    // ---- C. Search chips ---------------------------------------------------------------------
    await h.goto('/search?q=NXB%20Search')
    await h.wait(1500)
    const main = page.locator('main')
    await h.assert('C: both tasks without a filter', (await main.getByText('NXB Search low').count()) === 1 && (await main.getByText('NXB Search high').count()) === 1)
    await page.getByRole('group', { name: 'Search filters' }).getByRole('button', { name: 'Priority' }).click()
    await h.wait(400)
    await page.getByRole('checkbox', { name: 'High', exact: true }).check()
    await h.wait(1500)
    await h.capture('search-priority')
    await page.keyboard.press('Escape')
    await h.wait(400)
    await h.assert('C: High keeps the high task', (await main.getByText('NXB Search high').count()) === 1)
    await h.assert('C: High drops the low task', (await main.getByText('NXB Search low').count()) === 0)
    await page.getByRole('button', { name: 'Clear Priority filter' }).click()
    await h.wait(1200)
    await h.assert('C: X clears it', (await main.getByText('NXB Search low').count()) === 1)
    await h.capture('search-cleared')

    // ---- D. Templates ------------------------------------------------------------------------
    await open(source.id)
    await row(source.id).getByRole('button', { name: 'More' }).click()
    await h.wait(400)
    await h.capture('template-menu')
    const labels = await page.getByRole('menuitem').allTextContents()
    await h.assert('D: Save as template is above Delete', { ok: labels.indexOf('Save as template') >= 0 && labels.indexOf('Save as template') === labels.findIndex((l) => l.startsWith('Delete')) - 1, detail: JSON.stringify(labels) })
    await page.getByRole('menuitem', { name: 'Save as template' }).click()
    await page.getByText('Saved as a template').waitFor({ timeout: 8000 })
    await h.capture('template-saved')
    await h.assert('D: the answer offers Edit', (await page.getByRole('button', { name: 'Edit', exact: true }).count()) >= 1)

    await h.dismiss()
    await h.goto('/inbox')
    await h.wait(500)
    await page.getByRole('button', { name: /New task|Add task/ }).first().click().catch(() => page.keyboard.press('Control+n'))
    await h.wait(600)
    const button = page.getByRole('button', { name: 'Template' })
    await h.assert('D: the new task row has a Template button', (await button.count()) === 1)
    await button.click()
    await h.wait(500)
    await h.capture('template-picker')
    const picker = page.locator('[popover][aria-label="Templates"]')
    await h.assert('D: the list says 2 subtasks', (await picker.getByText('2 subtasks').count()) === 1)

    await picker.getByText('NXB Template source').hover()
    await picker.getByRole('button', { name: /Edit or remove/ }).click()
    await h.wait(400)
    await h.capture('template-arrow-menu')
    await page.getByRole('menuitem', { name: 'Edit' }).click()
    await h.wait(800)
    await h.capture('template-edit')
    const dialog = page.locator('dialog[open]')
    await h.assert('D: Edit lists the subtasks', (await dialog.getByText('NXB Template sub One').count()) === 1)
    await dialog.getByPlaceholder('New task').fill('NXB Edited tomorrow')
    await h.wait(300)
    await dialog.getByRole('button', { name: 'Save template' }).click()
    await h.wait(800)
    await h.assert('D: the edit closes', (await page.locator('dialog[open]').count()) === 0)

    await h.goto('/inbox')
    await h.wait(400)
    await page.getByRole('button', { name: /New task|Add task/ }).first().click().catch(() => page.keyboard.press('Control+n'))
    await h.wait(500)
    await page.getByRole('button', { name: 'Template' }).click()
    await h.wait(400)
    await h.assert('D: the title is taken as typed', (await page.locator('[popover][aria-label="Templates"]').getByText('NXB Edited tomorrow').count()) === 1)
    await page.locator('[popover][aria-label="Templates"]').getByText('NXB Edited tomorrow').click()
    await h.wait(3000)
    await h.capture('template-made')
    const found = (await h.api('GET', `/tasks?q=${encodeURIComponent('NXB Edited tomorrow')}&per_page=20`))
    const hits = (Array.isArray(found) ? found : found?.items ?? []).filter((t) => t.title === 'NXB Edited tomorrow')
    await h.assert('D: one task made', { ok: hits.length === 1, detail: String(hits.length) })
    if (hits[0]) {
      made.push(hits[0].id)
      const full = await h.api('GET', `/tasks/${hits[0].id}?expand=subtasks`)
      for (const child of full.related_tasks?.subtask ?? []) made.push(child.id)
      await h.assert('D: priority and notes came along', full.priority === 3 && full.description.includes('Bring it'))
      await h.assert('D: subtasks came along', { ok: (full.related_tasks?.subtask ?? []).length === 2, detail: String((full.related_tasks?.subtask ?? []).length) })
      const selected = await page.evaluate(() => {
        const el = document.activeElement
        return el?.tagName === 'TEXTAREA' ? el.value.slice(el.selectionStart, el.selectionEnd) : null
      })
      await h.assert('D: the card opens with its title selected', { ok: selected === 'NXB Edited tomorrow', detail: String(selected) })
    }

    // Remove with the arrow, and Undo; then remove for good.
    await h.dismiss()
    await h.goto('/inbox')
    await h.wait(400)
    await page.getByRole('button', { name: /New task|Add task/ }).first().click().catch(() => page.keyboard.press('Control+n'))
    await h.wait(500)
    await page.getByRole('button', { name: 'Template' }).click()
    await h.wait(400)
    const again = page.locator('[popover][aria-label="Templates"]')
    await again.getByText('NXB Edited tomorrow').hover()
    await again.getByRole('button', { name: /Edit or remove/ }).click()
    await h.wait(300)
    await page.getByRole('menuitem', { name: 'Remove' }).click()
    await h.wait(800)
    await h.capture('template-removed')
    await h.assert('D: Remove offers Undo', (await page.getByRole('button', { name: 'Undo', exact: true }).count()) >= 1)
    await h.dismiss()

    // ---- E. Subtask order --------------------------------------------------------------------
    await open(parent.id)
    await h.wait(800)
    const order = () => page.evaluate((id) => [...document.querySelectorAll(`[data-task-id="${id}"] [data-subtask-title]`)].map((el) => el.textContent.trim()), parent.id)
    await h.assert('E: the server order first', { ok: (await order())[0] === 'NXB Order Alpha', detail: JSON.stringify(await order()) })
    const rows = row(parent.id).locator('.group\\/subrow')
    await rows.nth(2).hover()
    await h.wait(200)
    await h.capture('suborder-grip')
    const grip = rows.nth(2).locator('button.cursor-grab')
    const from = await grip.boundingBox()
    const to = await rows.nth(0).boundingBox()
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(from.x + from.width / 2, from.y - 8, { steps: 4 })
    await page.mouse.move(from.x + from.width / 2, to.y - 2, { steps: 10 })
    await h.wait(200)
    await h.capture('suborder-dragging')
    await page.mouse.up()
    await h.wait(800)
    await h.assert('E: dragging moved Gamma to the top', { ok: (await order())[0] === 'NXB Order Gamma', detail: JSON.stringify(await order()) })
    await rows.nth(1).click({ button: 'right', position: { x: 60, y: 8 } })
    await h.wait(300)
    await h.capture('suborder-menu')
    await page.getByRole('menuitem', { name: 'Move up' }).click()
    await h.wait(600)
    await h.assert('E: Move up from the menu', { ok: (await order())[0] !== 'NXB Order Gamma', detail: JSON.stringify(await order()) })
    const expected = JSON.stringify(await order())
    await h.dismiss()
    await open(parent.id)
    await h.wait(800)
    await h.assert('E: the order stays after reopening', { ok: JSON.stringify(await order()) === expected, detail: JSON.stringify(await order()) })
    await h.axe(`[data-task-id="${parent.id}"]`)
  } finally {
    for (const id of made) await h.api('DELETE', `/tasks/${id}`).catch(() => {})
  }
}
