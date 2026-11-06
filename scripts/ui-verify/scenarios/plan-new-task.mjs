// New task on the Plan screen, through the real File menu item: the title box at the next free time,
// and the Inbox's composer when the day has none. Its own throwaway task; leaves the planner off.
export const meta = {
  id: 'PNT',
  wave: 6,
  title: 'Plan screen: New task opens the title box, or the Inbox on a day without free time',
}

const pad = (n) => String(n).padStart(2, '0')
const clock = (iso) => {
  const d = new Date(iso)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default async function run(h) {
  const page = h.page
  const title = 'PNT new task'
  const box = page.locator('[data-plan-draw-title]')
  const newTask = async () => {
    await h.app.evaluate(({ Menu }) => {
      const file = Menu.getApplicationMenu().items.find((item) => item.label === 'File')
      file.submenu.items.find((item) => item.label === 'New task').click()
    })
    await h.wait(300)
  }
  let created = null

  try {
    await page.evaluate(() => window.api.saveConfigPatch({ planner_enabled: true, planner_view: 'day', planner_source: 'day' }))
    await page.reload()
    await h.wait(1200)
    await h.goto('/plan')
    await page.locator('[data-plan-next]').click()
    await h.wait(500)

    await newTask()
    await h.assert('the title box opens on a day with free time', (await box.count()) === 1)
    await h.capture('title-box')
    await page.keyboard.type(title, { delay: 10 })
    await newTask()
    await h.assert('asking again keeps what was typed', (await box.locator('input').inputValue()) === title)
    await page.keyboard.press('Enter')

    for (let i = 0; i < 40 && !created; i++) {
      const found = await h.api('GET', `/tasks?q=${encodeURIComponent(title)}&per_page=20`)
      created = (Array.isArray(found) ? found : found.items ?? []).find((t) => t.title === title) ?? null
      if (!created) await h.wait(200)
    }
    await h.assert('the task has a block in the work hours', () => ({
      ok: !!created && clock(created.start_date) >= '08:00' && clock(created.end_date) <= '18:00',
      detail: created ? `${clock(created.start_date)} ${clock(created.end_date)}` : 'not created',
    }))

    // A past day has no free time.
    await page.locator('[data-plan-today]').click()
    await page.locator('[data-plan-prev]').click()
    await h.wait(300)
    await newTask()
    await h.wait(1000)
    await h.assert('a past day goes to the Inbox', (await page.evaluate(() => location.hash)).includes('/inbox'))
    await h.assert('and its composer takes the request', () => page.evaluate(() => {
      const element = document.activeElement
      return { ok: element?.getAttribute('placeholder') === 'New task', detail: element?.tagName ?? 'none' }
    }))
    await page.keyboard.press('Escape')
  } finally {
    if (created) await h.api('DELETE', `/tasks/${created.id}`).catch(() => {})
    await page.evaluate(() => window.api.saveConfigPatch({ planner_enabled: false, planner_view: 'day', planner_source: 'day' }))
  }
}
