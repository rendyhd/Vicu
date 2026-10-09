// Card 2.9a: the Logbook is grouped by completion day, rows are a filled check, a muted title and the
// completion time; older pages still load as the list scrolls. Also checks the list scrollbar sits at
// the window edge (the scroll container spans the content region, the reading column is inside it).
export const meta = {
  id: 'LB',
  wave: 2,
  title: 'Logbook day groups, completion time on the right, paging by scrolling; scrollbar at the window edge',
}

import { createApi, readApiToken } from '../lib.mjs'

const EXTRA = 60 // the seed has a handful of finished tasks; one page is 50 rows

export default async function run(h) {
  const page = h.page
  await h.resize(1280, 820)

  // The server stamps a completion with the time of the run, so every extra row lands in "Today".
  const api = createApi(readApiToken())
  const made = []
  for (let i = 1; i <= EXTRA; i++) {
    const t = await api.post(`/projects/${h.ids.work}/tasks`, { title: `Logbook paging row ${String(i).padStart(2, '0')}` })
    await api.patch(`/tasks/${t.id}`, { done: true })
    made.push(t.id)
  }

  try {
    await h.goto('/logbook')
    await h.wait(900)
    const rowCount = () => page.locator('[role="checkbox"][aria-checked="true"]').count()
    const first = await rowCount()
    await h.assert('first page: one page of rows, not the whole history', { ok: first > 0 && first <= 50, detail: first })

    const heading = page.getByRole('heading', { name: 'Today', level: 2 })
    await h.assert('a Today group heading', { ok: (await heading.count()) === 1, detail: await heading.count() })
    await h.assert('one heading for the one day', { ok: (await page.locator('h2').count()) === 1 })

    const row = page.locator('[role="checkbox"][aria-checked="true"]').first().locator('xpath=..')
    const rowText = await row.innerText()
    await h.assert('a row ends with the completion time', { ok: /\d{1,2}:\d{2}(\s?[AP]M)?\s*$/i.test(rowText.trim()), detail: JSON.stringify(rowText) })
    const titleStyle = await row.locator('span').first().evaluate((el) => {
      const s = getComputedStyle(el)
      return { decoration: s.textDecorationLine, color: s.color }
    })
    await h.assert('title is muted without a strikethrough', { ok: titleStyle.decoration === 'none', detail: JSON.stringify(titleStyle) })
    await h.capture('top')

    // Scroll to the end: the next page loads.
    const scroller = page.locator('.overflow-y-auto').filter({ has: page.locator('h2') }).first()
    for (let i = 0; i < 6; i++) {
      await scroller.evaluate((el) => { el.scrollTop = el.scrollHeight })
      await h.wait(700)
    }
    const after = await rowCount()
    await h.assert('scrolling to the end loads older pages', { ok: after > first, detail: `${first} -> ${after}` })
    await h.assert('no row is repeated', { ok: new Set(await page.locator('[role="checkbox"][aria-checked="true"]').evaluateAll((els) => els.map((e) => e.parentElement.innerText))).size === after })
    await h.capture('end')

    // The scrollbar sits at the window edge, the column inside it.
    const geometry = await scroller.evaluate((el) => {
      const r = el.getBoundingClientRect()
      const column = el.firstElementChild.getBoundingClientRect()
      return { scrollerRight: Math.round(r.right), windowWidth: window.innerWidth, columnWidth: Math.round(column.width), scrollbar: el.offsetWidth - el.clientWidth }
    })
    await h.assert('logbook: the scroll container reaches the window edge', { ok: geometry.scrollerRight === geometry.windowWidth, detail: JSON.stringify(geometry) })
    await h.assert('logbook: the column is the reading width', { ok: geometry.columnWidth <= 760, detail: geometry.columnWidth })
  } finally {
    for (const id of made) await api.del(`/tasks/${id}`).catch(() => {})
  }

  // Today: a list with a scrollbar, at the window edge as well.
  await h.goto('/today')
  await h.wait(600)
  const today = await page.evaluate(() => {
    const el = [...document.querySelectorAll('.overflow-y-auto')].find((e) => e.querySelector('[data-task-id]'))
    if (!el) return null
    const r = el.getBoundingClientRect()
    const header = document.querySelector('h1').getBoundingClientRect()
    const row = el.querySelector('[data-task-id]').getBoundingClientRect()
    return { right: Math.round(r.right), windowWidth: window.innerWidth, overflows: el.scrollHeight > el.clientHeight, titleX: Math.round(header.left), rowX: Math.round(row.left) }
  })
  await h.assert('today: the scroll container reaches the window edge', { ok: !!today && today.right === today.windowWidth, detail: JSON.stringify(today) })
  await h.capture('today')
  await h.resize(1280, 400)
  await h.wait(400)
  await h.capture('today-scrolls')
  await h.resize(1280, 820)
}
