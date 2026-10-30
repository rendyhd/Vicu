import { at, localDate } from '../lib.mjs'

export const meta = { id: 'PCD', wave: 4, title: 'Planner cards become duration-sized calendar previews and schedule on drop' }

export default async function run(h) {
  const page = h.page
  const created = []
  const create = async (fields) => {
    const task = await h.api('POST', `/projects/${h.ids.personal}/tasks`, fields)
    created.push(task.id)
    return task
  }
  const preview = (id) => page.locator(`[data-calendar-drop-preview="${id}"]`)
  const block = (id) => page.locator(`[data-calendar-task="${id}"]`)
  const writes = (id) => h.requests().filter((request) => request.method === 'PATCH' && new URL(request.url).pathname.endsWith(`/tasks/${id}`)).length
  const schedule = page.getByRole('region', { name: 'Day schedule', exact: true })
  const begin = async (id) => {
    const row = page.locator(`[data-task-id="${id}"]`).first()
    await row.scrollIntoViewIfNeeded()
    const box = await row.boundingBox()
    const origin = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    await page.mouse.move(origin.x, origin.y)
    await page.mouse.down()
    await page.mouse.move(origin.x + 12, origin.y, { steps: 3 })
    return origin
  }
  const hoverTime = async (minute) => {
    const grid = await page.getByRole('list', { name: 'Scheduled tasks', exact: true }).boundingBox()
    await page.mouse.move(grid.x + grid.width / 2, grid.y + minute * 1.2, { steps: 12 })
    await h.wait(30)
  }
  const waitForStart = async (id, expected) => {
    for (let attempt = 0; attempt < 30; attempt++) {
      const task = await h.api('GET', `/tasks/${id}`)
      if (new Date(task.start_date).getTime() === new Date(expected).getTime()) return task
      await h.wait(100)
    }
    throw new Error(`Card ${id} did not acquire its dropped start time`)
  }

  try {
    await h.resize(1440, 900)
    const planned = await create({
      title: 'Calendar drop with duration', start_date: at(0, 9, 0, 0), due_date: at(2, 18, 0, 0), end_date: at(3, 19, 0, 0),
      description: '<p>Preserve my notes</p>\n<!-- vicu-duration:v1:90 -->',
    })
    const unplanned = await create({ title: 'Calendar drop without duration', description: '<p>Keep default implicit</p>', due_date: at(1, 18, 0, 0) })
    await h.goto('/planner')
    await page.locator(`#planner-column-${localDate(1)}`).click()
    await schedule.evaluate((element) => { element.scrollTop = 600 })
    const before = writes(planned.id)
    const origin = await begin(planned.id)
    await hoverTime(10 * 60 + 17)
    await h.assert('hover immediately shows a 90-minute block at the snapped time without saving',
      await preview(planned.id).evaluate((el) => el.style.height === '108px' && el.style.top === '738px')
      && writes(planned.id) === before)
    await h.capture('duration-preview')
    await page.mouse.move(origin.x, origin.y, { steps: 12 })
    await h.assert('leaving the calendar removes its preview', await preview(planned.id).count() === 0)
    await hoverTime(10 * 60 + 17)
    await page.keyboard.press('Escape')
    await page.mouse.up()
    await h.assert('Escape cancels a card drop without writing', await preview(planned.id).count() === 0 && writes(planned.id) === before)

    await begin(planned.id)
    await hoverTime(10 * 60 + 17)
    await page.mouse.up()
    const saved = await waitForStart(planned.id, at(1, 10, 15, 0))
    await block(planned.id).waitFor()
    await h.assert('drop schedules on the picked day with one write, preserving duration and other dates',
      writes(planned.id) === before + 1 && saved.description === planned.description
      && saved.due_date === planned.due_date && saved.end_date === planned.end_date
      && await block(planned.id).evaluate((el) => el.style.height === '108px'))

    await page.getByRole('switch', { name: 'Show unplanned tasks' }).click()
    await begin(unplanned.id)
    await hoverTime(11 * 60)
    await h.assert('an unplanned card without duration previews the 30-minute default',
      await preview(unplanned.id).evaluate((el) => el.style.height === '36px'))
    // Scrolling with a stationary pointer changes the preview and the eventual drop equally.
    const topBefore = await preview(unplanned.id).evaluate((el) => Number.parseFloat(el.style.top))
    await schedule.evaluate((element) => { element.scrollTop += 36 })
    await h.assert('hover preview tracks calendar scrolling',
      await preview(unplanned.id).evaluate((el) => Number.parseFloat(el.style.top)) === topBefore + 36)
    await page.mouse.up()
    const defaultSaved = await waitForStart(unplanned.id, at(1, 11, 30, 0))
    await h.assert('dropping an unplanned card does not persist the default duration or change its due date',
      defaultSaved.description === unplanned.description && defaultSaved.due_date === unplanned.due_date)
    await h.axe('[aria-label="Day schedule"]')
    await h.capture('dropped-cards')
  } finally {
    await page.keyboard.press('Escape')
    await page.mouse.up()
    for (const id of created) await h.api('DELETE', `/tasks/${id}`)
  }
}
