import { at, localDate } from '../lib.mjs'

export const meta = { id: 'PN', wave: 4, title: 'Planner date navigation browses past and future days and returns to today' }

export default async function run(h) {
  const page = h.page
  const created = []
  const create = async (offset) => {
    const task = await h.api('POST', `/projects/${h.ids.personal}/tasks`, {
      title: `Planner navigation ${offset}`,
      start_date: at(offset, 9, 0, 0),
      done: true,
    })
    created.push(task.id)
    return task
  }
  const firstHeading = () => page.locator('h2 time').first().getAttribute('datetime')
  const calendarHeading = () => page.locator('section:has(> [aria-label="Day schedule"]) header time').getAttribute('datetime')
  try {
    const past = await create(-1)
    const future = await create(3)
    await h.goto('/planner')
    const navigation = page.getByRole('group', { name: 'Planner date navigation' })
    const previous = navigation.getByRole('button', { name: 'Previous day', exact: true })
    const next = navigation.getByRole('button', { name: 'Next day', exact: true })
    const today = navigation.getByRole('button', { name: 'Today', exact: true })
    await page.getByRole('region', { name: 'Day schedule', exact: true }).waitFor()
    await h.assert('Planner initially starts at today', await firstHeading() === localDate(0))

    await previous.click()
    await page.locator(`[data-calendar-task="${past.id}"]`).waitFor()
    await h.assert('back moves columns and calendar to yesterday, including completed tasks',
      await firstHeading() === localDate(-1)
      && await calendarHeading() === localDate(-1)
      && await page.locator(`[data-task-id="${past.id}"]`).count() === 1)
    await h.capture('past')

    await next.click()
    await h.assert('forward moves one local day', await firstHeading() === localDate(0))
    for (let day = 0; day < 3; day++) await next.click()
    await page.locator(`[data-calendar-task="${future.id}"]`).waitFor()
    await h.assert('forward browses beyond the original window and loads completed tasks',
      await firstHeading() === localDate(3)
      && await calendarHeading() === localDate(3)
      && await page.locator(`[data-task-id="${future.id}"]`).count() === 1)
    await h.capture('future')

    // At a wide size, select a later heading; resizing must return to the browsed range,
    // not to the actual current date.
    await h.resize(1800, 900)
    await page.locator(`button:has(time[datetime="${localDate(4)}"])`).click()
    await h.assert('day headings still select dates within a browsed range', await calendarHeading() === localDate(4))
    await h.resize(900, 820)
    await h.assert('a hidden selection falls back to the first browsed day', await calendarHeading() === localDate(3))

    await today.focus()
    await page.keyboard.press('Enter')
    await h.assert('Today returns both columns and calendar to the current day',
      await firstHeading() === localDate(0) && await calendarHeading() === localDate(0))
    await h.assert('completed tasks outside the restored window are no longer shown',
      await page.locator(`[data-task-id="${past.id}"], [data-task-id="${future.id}"]`).count() === 0)
    await h.capture('today')
    await h.axe()
  } finally {
    for (const id of created) await h.api('DELETE', `/tasks/${id}`)
  }
}
