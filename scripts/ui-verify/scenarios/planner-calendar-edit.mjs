import { at } from '../lib.mjs'

export const meta = { id: 'PCE', wave: 4, title: 'Calendar move and edge resizing preview, save, cancel and support keyboard input' }

const duration = (minutes) => `<!-- vicu-duration:v1:${minutes} -->`
const pixelsPerMinute = 36 / 30
const sameInstant = (a, b) => new Date(a).getTime() === new Date(b).getTime()

export default async function run(h) {
  const page = h.page
  const created = []
  const create = async (fields) => {
    const task = await h.api('POST', `/projects/${h.ids.personal}/tasks`, fields)
    created.push(task.id)
    return task
  }
  const read = (id) => h.api('GET', `/tasks/${id}`)
  const block = (id) => page.locator(`[data-calendar-task="${id}"]`)
  const writes = (id) => h.requests().filter((request) => request.method === 'PATCH' && new URL(request.url).pathname.endsWith(`/tasks/${id}`)).length
  const waitForSave = async (id, check) => {
    for (let attempt = 0; attempt < 30; attempt++) {
      const task = await read(id)
      if (check(task)) return task
      await h.wait(100)
    }
    throw new Error(`Calendar task ${id} did not reach its expected schedule`)
  }
  const beginDrag = async (id, mode, minutes) => {
    const control = block(id).locator(`[data-calendar-edit="${mode}"]`)
    await control.scrollIntoViewIfNeeded()
    const box = await block(id).boundingBox()
    const x = box.x + box.width / 2
    // Exercise the actual painted border, not just the handle's inner hit area.
    const y = mode === 'start' ? box.y + 0.5 : mode === 'end' ? box.y + box.height - 0.5 : box.y + box.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x, y + minutes * pixelsPerMinute, { steps: 12 })
    await h.wait(40)
  }
  const drag = async (id, mode, minutes) => {
    await beginDrag(id, mode, minutes)
    await page.mouse.up()
  }
  try {
    const original = await create({
      title: 'Calendar editable', start_date: at(0, 11, 0, 0), due_date: at(0, 18, 0, 0),
      end_date: at(0, 20, 0, 0), description: `<p>Keep these notes</p>\n${duration(60)}`,
    })
    const completed = await create({ title: 'Calendar completed', start_date: at(0, 14, 30, 0), due_date: at(1, 15, 0, 0), description: duration(30), done: true })
    const defaultDuration = await create({ title: 'Calendar default duration', start_date: at(0, 17, 0, 0) })
    await h.goto('/planner')
    const schedule = page.getByRole('region', { name: 'Day schedule', exact: true })
    await block(original.id).waitFor()
    await schedule.evaluate((element) => { element.scrollTop = 650 })

    const beforeWrites = writes(original.id)
    await beginDrag(original.id, 'move', 30)
    await h.assert('moving previews the new start and keeps the duration before any write', {
      ok: await block(original.id).evaluate((el) => el.style.top === '828px' && el.style.height === '72px')
        && writes(original.id) === beforeWrites && (await read(original.id)).start_date === original.start_date,
    })
    await h.capture('move-preview')
    await page.mouse.up()
    const moved = await waitForSave(original.id, (task) => sameInstant(task.start_date, at(0, 11, 30, 0)))
    await h.assert('releasing saves one start-only move and leaves other fields untouched',
      writes(original.id) === beforeWrites + 1 && moved.description === original.description
      && moved.due_date === original.due_date && moved.end_date === original.end_date)

    await drag(original.id, 'start', -30)
    const top = await waitForSave(original.id, (task) => task.start_date === original.start_date && task.description.includes(duration(90)))
    await h.assert('top edge keeps the end fixed and preserves notes',
      top.description.includes('<p>Keep these notes</p>') && top.due_date === original.due_date && top.end_date === original.end_date)
    await drag(original.id, 'end', 15)
    const bottom = await waitForSave(original.id, (task) => task.description.includes(duration(105)))
    await h.assert('bottom edge changes duration only', bottom.start_date === top.start_date && bottom.due_date === original.due_date && bottom.end_date === original.end_date)

    const beforeCancel = writes(original.id)
    await beginDrag(original.id, 'move', 30)
    await page.keyboard.press('Escape')
    await page.mouse.up()
    await h.wait(150)
    await h.assert('Escape discards the preview and does not save', writes(original.id) === beforeCancel && await block(original.id).evaluate((el) => el.style.top === '792px'))
    await block(original.id).locator('[data-calendar-edit="move"]').click()
    await h.wait(100)
    await h.assert('a simple click does not write', writes(original.id) === beforeCancel)

    await block(original.id).locator('[data-calendar-edit="end"]').focus()
    await page.keyboard.press('ArrowDown')
    const keyboard = await waitForSave(original.id, (task) => task.description.includes(duration(120)))
    await h.assert('keyboard resizing uses the same duration-only path and keeps focus for further edits',
      keyboard.start_date === original.start_date
      && await page.evaluate(() => document.activeElement?.getAttribute('data-calendar-edit') === 'end'))

    await drag(completed.id, 'end', 30)
    const resized = await waitForSave(completed.id, (task) => task.description.includes(duration(60)))
    await h.assert('resizing a completed task preserves its start and unrelated due date',
      resized.start_date === completed.start_date && resized.due_date === completed.due_date && resized.done)
    await h.assert('an absent duration displays a 30-minute block',
      await block(defaultDuration.id).evaluate((el) => el.style.height === '36px'))
    await drag(defaultDuration.id, 'end', 15)
    const grown = await waitForSave(defaultDuration.id, (task) => task.description.includes(duration(45)))
    await h.assert('resizing a default-duration block grows from its effective end', grown.start_date === defaultDuration.start_date)

    // Keep the pointer near the lower viewport edge without moving it; the dragged event should
    // keep tracking the newly revealed grid. Cancel afterwards so this check is non-destructive.
    await schedule.evaluate((element) => { element.scrollTop = 650 })
    await beginDrag(original.id, 'move', 15)
    const viewport = await schedule.boundingBox()
    const control = await block(original.id).boundingBox()
    await page.mouse.move(control.x + control.width / 2, viewport.y + viewport.height - 4)
    const scrollBefore = await schedule.evaluate((element) => element.scrollTop)
    await h.wait(350)
    await h.assert('dragging at the viewport edge auto-scrolls the calendar', await schedule.evaluate((element) => element.scrollTop) > scrollBefore + 20)
    await page.keyboard.press('Escape')
    await page.mouse.up()
    await h.axe('[aria-label="Day schedule"]')
    await h.capture('editable-schedule')
  } finally {
    await page.mouse.up()
    for (const id of created) await h.api('DELETE', `/tasks/${id}`)
  }
}
