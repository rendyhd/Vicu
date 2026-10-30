export const meta = {
  id: 'PNT',
  wave: 4,
  title: 'Planner new-task requests open and focus the Unplanned composer',
}

export default async function run(h) {
  const page = h.page
  const column = page.locator('section[aria-labelledby="planner-column-overdue"]')
  const input = column.getByPlaceholder('New task', { exact: true })
  const toggle = page.getByRole('switch', { name: 'Show unplanned tasks' })
  const created = []
  const assertComposer = async (label) => {
    await input.waitFor()
    await h.assert(label, await input.evaluate((element) => document.activeElement === element)
      && await column.getByRole('heading', { name: 'Unplanned', exact: true }).count() === 1
      && await page.getByPlaceholder('New task', { exact: true }).count() === 1)
  }

  try {
    await h.goto('/planner')
    if (await toggle.getAttribute('aria-checked') === 'true') await toggle.click()
    await column.getByRole('heading', { name: 'Overdue', exact: true }).waitFor()

    await page.keyboard.press('ControlOrMeta+n')
    await assertComposer('the shortcut switches Overdue to Unplanned and focuses its only composer')
    await h.capture('unplanned-composer')

    await page.keyboard.press('Escape')
    await input.waitFor({ state: 'detached' })
    await h.assert('Escape closes the composer but keeps Unplanned open',
      await input.count() === 0 && await toggle.getAttribute('aria-checked') === 'true')

    await page.keyboard.press('ControlOrMeta+n')
    await assertComposer('the shortcut also opens the composer when Unplanned is already shown')
    const title = `Planner shortcut task ${Date.now()}`
    await input.fill(title)
    await page.keyboard.press('Enter')
    const row = column.locator('[data-task-id]').filter({ hasText: title })
    await row.waitFor()
    await page.waitForFunction((title) => [...document.querySelectorAll('[data-task-id]')]
      .some((element) => element.textContent.includes(title) && Number(element.getAttribute('data-task-id')) > 0), title)
    const id = Number(await row.getAttribute('data-task-id'))
    created.push(id)
    const task = await h.api('GET', `/tasks/${id}`)
    const emptyDate = (value) => !value || value === '0001-01-01T00:00:00Z'
    await h.assert('the composer creates an unplanned Inbox task with no inferred dates',
      task.project_id === h.ids.inbox && emptyDate(task.start_date) && emptyDate(task.due_date))
    await h.assert('the composer stays focused after creation',
      await input.evaluate((element) => document.activeElement === element))
    await page.keyboard.press('Escape')

    // Exercise the document handler independently of the native app-menu accelerator.
    await toggle.click()
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'n', metaKey: true, bubbles: true, cancelable: true,
    })))
    await assertComposer('the renderer Cmd+N handler opens Unplanned too')
    await page.keyboard.press('Escape')

    await toggle.click()
    await h.app.evaluate(({ Menu }) => {
      const file = Menu.getApplicationMenu().items.find((item) => item.label === 'File')
      file.submenu.items.find((item) => item.label === 'New task').click()
    })
    await assertComposer('File > New task switches Overdue to Unplanned and focuses the composer')
    await input.fill('Keep this draft')
    await h.app.evaluate(({ Menu }) => {
      const file = Menu.getApplicationMenu().items.find((item) => item.label === 'File')
      file.submenu.items.find((item) => item.label === 'New task').click()
    })
    await h.assert('repeated new-task requests preserve the existing draft',
      await input.inputValue() === 'Keep this draft'
      && await page.getByPlaceholder('New task', { exact: true }).count() === 1)
    await page.keyboard.press('Escape')
  } finally {
    for (const id of created) await h.api('DELETE', `/tasks/${id}`)
  }
}
