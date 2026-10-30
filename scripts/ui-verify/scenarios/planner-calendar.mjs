import { at, dateOnly, localDate } from '../lib.mjs'

export const meta = { id: 'PC', wave: 4, title: 'Planner calendar maps tasks, separates overlaps and keeps its scroll position' }

export default async function run(h) {
  const page = h.page
  const created = []
  const create = async (fields) => {
    const task = await h.api('POST', `/projects/${h.ids.personal}/tasks`, fields)
    created.push(task.id)
    return task
  }
  try {
    const overlap = await create({ title: 'Calendar overlap', start_date: at(0, 9, 15, 0), description: '<!-- vicu-duration:v1:60 -->' })
    const completed = await create({ title: 'Calendar completed start only', start_date: at(0, 9, 30, 0), description: '<!-- vicu-duration:v1:30 -->', done: true })
    const history = await create({ title: 'Calendar old history', start_date: at(-30, 9, 0, 0), due_date: dateOnly(0), done: true })
    const tomorrowTask = await create({ title: 'Calendar tomorrow', start_date: at(1, 10, 0, 0) })
    const dueOnly = await create({ title: 'Calendar due only', due_date: at(0, 12, 0, 0), description: '<!-- vicu-duration:v1:60 -->' })
    await h.goto('/planner')
    const schedule = page.getByRole('region', { name: 'Day schedule', exact: true })
    const rail = schedule.locator('..')
    await schedule.waitFor()
    await page.locator(`[data-calendar-task="${completed.id}"]`).waitFor()

    await h.assert('initial opening scrolls after the rail height is measured', await schedule.evaluate((el) => {
      const now = new Date()
      const slot = Math.max(0, Math.floor((now.getHours() * 60 + now.getMinutes() - 60) / 30))
      const expected = Math.min(12 + slot * 36 - 10, el.scrollHeight - el.clientHeight)
      return { ok: Math.abs(el.scrollTop - expected) < 2, detail: JSON.stringify({ top: el.scrollTop, expected }) }
    }))
    await h.assert('start-only completed tasks are fetched and have an explicit completed label',
      (await page.locator(`[data-calendar-task="${completed.id}"]`).getAttribute('aria-label')).includes(', completed'))
    await h.assert('due-only tasks have no fabricated calendar time or No time band',
      await rail.locator(`[data-calendar-task="${dueOnly.id}"]`).count() === 0
      && await rail.getByRole('list', { name: 'Tasks without a time' }).count() === 0)
    await h.assert('due-only tasks do not enter dated columns', await page.locator(`[data-task-id="${dueOnly.id}"]`).count() === 0)
    await page.getByRole('switch', { name: 'Show unplanned tasks' }).click()
    await h.assert('due-only tasks appear in Unplanned', await page.locator(`[data-task-id="${dueOnly.id}"]`).count() === 1)
    await page.getByRole('switch', { name: 'Show unplanned tasks' }).click()
    await h.assert('undated tasks have no fabricated calendar time', await rail.locator(`[data-calendar-task="${h.ids.tasks.dinner}"]`).count() === 0)

    const blocks = await schedule.locator('[data-calendar-task]').evaluateAll((elements) => elements.map((el) => ({
      id: Number(el.getAttribute('data-calendar-task')), top: parseFloat(el.style.top), height: parseFloat(el.style.height),
      left: parseFloat(el.style.left), width: parseFloat(el.style.width),
    })))
    const flights = blocks.find((block) => block.id === h.ids.tasks.flights)
    const overlapping = blocks.find((block) => block.id === overlap.id)
    const finished = blocks.find((block) => block.id === completed.id)
    await h.assert('duration controls height, start controls position and overlaps use three separate columns', {
      ok: flights.top === 648 && flights.height === 54 && overlapping.top === 666 && overlapping.height === 72
        && new Set([flights.left, overlapping.left, finished.left]).size === 3
        && [flights, overlapping, finished].every((block) => Math.abs(block.width - 100 / 3) < 0.01),
      detail: JSON.stringify(blocks),
    })

    const query = h.requests().find((request) => {
      const url = new URL(request.url)
      return url.pathname.endsWith('/tasks') && url.searchParams.get('filter')?.includes('start_date >=')
    })
    const url = new URL(query.url)
    const response = await h.api('GET', `/tasks?${url.searchParams}`)
    await h.assert('the server query does not return old completed history', !response.items.some((task) => task.id === history.id))

    // A user scroll and a resize must not replay the initial opening scroll.
    await schedule.evaluate((el) => { el.scrollTop = 620 })
    await h.resize(1600, 900)
    await h.wait(200)
    await h.assert('resizing preserves the user scroll position', Math.abs(await schedule.evaluate((el) => el.scrollTop) - 620) < 2)
    await h.capture('today-events')
    await h.axe('[aria-label="Day schedule"]')

    const tomorrow = localDate(1)
    await page.locator(`button:has(time[datetime="${tomorrow}"])`).click()
    await h.assert('selecting another day opens at 8 AM', Math.abs(await schedule.evaluate((el) => el.scrollTop) - 578) < 2)
    await h.assert('day switching replaces the events',
      await schedule.locator(`[data-calendar-task="${overlap.id}"]`).count() === 0
      && await schedule.locator(`[data-calendar-task="${tomorrowTask.id}"]`).count() === 1)
    await h.capture('tomorrow-events')

    // Breakpoints use the space beside the sidebar, not the whole window. Exercise their exact
    // boundaries, plus the widths that must only stretch the existing columns (1090–1420).
    const sidebarWidth = await page.evaluate(() => innerWidth - document.querySelector('main').clientWidth)
    let previousCardWidth = 0
    for (const [width, expectedColumns] of [[600, 2], [870, 2], [871, 3], [1090, 3], [1250, 3], [1420, 3], [1421, 4]]) {
      await h.resize(width + sidebarWidth, 900)
      const layout = await rail.evaluate((el) => {
        const scroller = el.closest('[data-scroll-area]')
        const columns = [...scroller.querySelectorAll('section[aria-labelledby^="planner-column-"]')]
        const rect = el.getBoundingClientRect()
        const viewport = scroller.getBoundingClientRect()
        const columnWidths = columns.map((column) => column.getBoundingClientRect().width)
        return {
          width: scroller.clientWidth,
          columns: columns.length,
          cardWidth: columnWidths[0],
          equalColumns: Math.max(...columnWidths) - Math.min(...columnWidths) < 1,
          noOverlap: columns.every((column) => column.getBoundingClientRect().right <= rect.left),
          noOuterScroll: scroller.scrollHeight === scroller.clientHeight && scroller.scrollWidth === scroller.clientWidth,
          flushEdges: Math.abs(rect.right - viewport.right) < 1 && Math.abs(rect.top - viewport.top) < 1
            && Math.abs(rect.bottom - viewport.bottom) < 1,
          squareCorners: getComputedStyle(el).borderRadius === '0px',
        }
      })
      await h.assert(`${width}px: responsive columns and a flush calendar without outer scrolling`, {
        ok: layout.width === width && layout.columns === expectedColumns && layout.equalColumns
          && layout.noOverlap && layout.noOuterScroll && layout.flushEdges && layout.squareCorners,
        detail: JSON.stringify(layout),
      })
      if (width === 1250 || width === 1420) {
        await h.assert(`${width}px: the existing columns stretch`, layout.cardWidth > previousCardWidth)
      }
      previousCardWidth = layout.cardWidth
      if (width === 600) {
        await h.assert('hiding the selected heading returns the calendar to today',
          await rail.locator(`header time[datetime="${localDate(0)}"]`).count() === 1)
      }
      await h.capture(`calendar-${width}`)
    }

    // A genuinely long day can scroll, but it must not move the rail or change the responsive
    // column count when its scrollbar consumes a few pixels at the 871px boundary.
    await h.resize(871 + sidebarWidth, 900)
    await rail.evaluate((el) => {
      const scroller = el.closest('[data-scroll-area]')
      const tomorrow = scroller.querySelectorAll('section[aria-labelledby^="planner-column-"]')[2]
      tomorrow.style.minHeight = `${scroller.clientHeight + 300}px`
      scroller.scrollTop = 150
    })
    await h.wait(150)
    await h.assert('long columns scroll without moving the rail or dropping a column at the breakpoint', await rail.evaluate((el) => {
      const scroller = el.closest('[data-scroll-area]')
      const columns = [...scroller.querySelectorAll('section[aria-labelledby^="planner-column-"]')]
      const ok = columns.length === 3 && scroller.scrollTop === 150
        && Math.abs(el.getBoundingClientRect().top - scroller.getBoundingClientRect().top) < 1
      columns.forEach((column) => { column.style.minHeight = '' })
      scroller.scrollTop = 0
      return ok
    }))

    // Height changes must not add the old 16px outer scroll range or reset calendar scrolling.
    await schedule.evaluate((el) => { el.scrollTop = 620 })
    await h.resize(1280, 600)
    await h.assert('shorter windows keep the calendar bounded and preserve its scroll', await schedule.evaluate((el) => {
      const scroller = el.closest('[data-scroll-area]')
      const rail = el.parentElement.getBoundingClientRect()
      return {
        ok: Math.abs(el.scrollTop - 620) < 2 && rail.height === scroller.clientHeight
          && scroller.scrollHeight === scroller.clientHeight,
        detail: JSON.stringify({ top: el.scrollTop, railHeight: rail.height, viewport: scroller.clientHeight, outerHeight: scroller.scrollHeight }),
      }
    }))
  } finally {
    for (const id of created) await h.api('DELETE', `/tasks/${id}`)
  }
}
