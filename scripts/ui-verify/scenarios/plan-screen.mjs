// PLN (contract section 16): the Plan screen with real mouse and keyboard against the server. What
// matters is what is written: each gesture sends only the fields of 16.2, and they come back from
// the server as the same wall-clock times.
//
//   A. Off by default: no Plan entry, and /plan goes to Today. Settings turns it on.
//   B. Drop a task from the list on a time: start, end at the default length, due date kept.
//   C. Bottom edge: only the end. Top edge: the start, and the end stays. Move: both, same length.
//   D. Click a block: exact lengths. Alt+Shift+Down moves it, Shift+Down makes it longer.
//   E. Drag a block back on the list: the time goes, the date stays.
//   F. Draw on an empty time: a new task in the Inbox, or in the project being browsed.
//   G. The default length from the gear: the next drop takes it (and it reaches the synced prefs).
//   H. 3 days and Week: a day's top row, a drop there plans the day without a time, a day header
//      selects the day. Past days take nothing.
//   I. Fit today, with Undo. Today lists a block starting today, whatever its due date.
//
// Its own throwaway tasks and project; everything is deleted at the end.

export const meta = {
  id: 'PLN',
  wave: 6,
  title: 'Plan screen: drop, either edge, move, lengths, keyboard, back to the list, draw, views, Fit',
}

const NULL_DATE = '0001-01-01T00:00:00Z'
const pad = (n) => String(n).padStart(2, '0')
const dayFrom = (days) => {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const dueOf = (day) => {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d, 23, 59, 59).toISOString()
}
const clock = (iso) => {
  const d = new Date(iso)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const dayOf = (iso) => {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const isSet = (value) => !!value && value !== NULL_DATE

export default async function run(h) {
  const page = h.page
  await h.resize(1400, 900)
  await h.dismiss()

  // A run that was cut off leaves its tasks behind, and they would be in this run's day.
  const leftBehind = await h.api('GET', `/tasks?q=${encodeURIComponent('PLN ')}&per_page=200`)
  for (const stale of Array.isArray(leftBehind) ? leftBehind : leftBehind.items ?? []) {
    if (String(stale.title).startsWith('PLN ')) await h.api('DELETE', `/tasks/${stale.id}`).catch(() => {})
  }

  const today = dayFrom(0)
  const tomorrow = dayFrom(1)
  const created = []
  let project = null
  const makeTask = async (title, fields = {}, project = h.ids.inbox) => {
    const task = await h.api('POST', `/projects/${project}/tasks`, { title, ...fields })
    created.push(task.id)
    return task
  }
  const server = (id) => h.api('GET', `/tasks/${id}`)
  const waitFor = async (id, check) => {
    for (let i = 0; i < 40; i++) {
      const task = await server(id)
      if (check(task)) return task
      await h.wait(150)
    }
    return server(id)
  }

  /** Where a minute is on screen in a day's column, after scrolling it into view. */
  const at = async (day, minute) => {
    return page.evaluate(
      ({ day, minute }) => {
        const scroller = document.querySelector('[data-plan-scroller]')
        const column = document.querySelector(`[data-plan-column="${day}"]`)
        scroller.scrollTop = Math.max(0, minute - 200)
        const box = column.getBoundingClientRect()
        return { x: box.left + box.width / 2, y: box.top + minute }
      },
      { day, minute },
    )
  }
  const dragTo = async (x0, y0, x1, y1, { steps = 12 } = {}) => {
    await page.mouse.move(x0, y0)
    await page.mouse.down()
    await page.mouse.move(x0, y0 + 6, { steps: 2 })
    await page.mouse.move(x1, y1, { steps })
    await h.wait(120)
    await page.mouse.up()
    await h.wait(250)
  }
  const block = (id) => page.locator(`[data-plan-block="${id}"]`)
  const row = (id) => page.locator(`[data-plan-panel] [data-task-id="${id}"]`)
  // Tasks and projects made through the API here: a full reload reads them.
  const reload = async () => {
    await page.reload()
    await h.wait(1500)
    await h.goto('/plan')
    await h.wait(300)
    // A reload starts from the saved cache; F5 rereads the page.
    await page.keyboard.press('F5')
    await h.wait(900)
  }

  // Work on a time that is still free and in the future today: tomorrow when it is late.
  const late = new Date().getHours() >= 20
  const workDay = late ? tomorrow : today
  const baseMinute = late ? 9 * 60 : Math.min(21 * 60, (new Date().getHours() + 1) * 60)

  try {
    // --- A. Off by default ------------------------------------------------------------------------
    await page.evaluate(() => window.api.saveConfigPatch({ planner_enabled: false, planner_view: 'day', planner_source: 'day' }))
    await page.reload()
    await h.wait(1200)
    await h.assert('A: no Plan entry while the planner is off', (await page.locator('nav[aria-label="Lists"] button', { hasText: /^Plan/ }).count()) === 0)
    await h.goto('/plan')
    await h.wait(300)
    await h.assert('A: /plan goes to Today while it is off', (await page.evaluate(() => location.hash)).includes('/today'))

    await h.goto('/settings?section=pro')
    await h.wait(400)
    await page.getByText('Show Plan in the sidebar').click()
    await page.locator('nav[aria-label="Lists"] button', { hasText: /^Plan/ }).waitFor({ timeout: 5000 }).catch(() => {})
    await h.assert('A: Settings turns it on', (await page.locator('nav[aria-label="Lists"] button', { hasText: /^Plan/ }).count()) === 1)
    await h.capture('settings-on')

    // --- B. Drop a task from the list on a time ---------------------------------------------------
    const dropped = await makeTask('PLN drop me', { due_date: dueOf(workDay) })
    const keeper = await makeTask('PLN deadline', { due_date: dueOf(dayFrom(5)) })
    await page.locator('nav[aria-label="Lists"] button', { hasText: /^Plan/ }).click()
    await h.wait(500)
    if (late) {
      await page.locator('[data-plan-next]').click()
      await h.wait(400)
    }
    await h.capture('day')
    await h.assert('B: the task without a time is in the list', (await row(dropped.id).count()) === 1)

    const rowBox = async (id) => row(id).first().boundingBox()
    let box = await rowBox(dropped.id)
    let point = await at(workDay, baseMinute)
    await dragTo(box.x + 80, box.y + box.height / 2, point.x, point.y + 2, { steps: 16 })
    let task = await waitFor(dropped.id, (t) => isSet(t.start_date))
    const startClock = `${pad(Math.floor(baseMinute / 60))}:00`
    const endAfter = (minutes) => {
      const total = baseMinute + minutes
      return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`
    }
    await h.assert('B: dropped on the time', clock(task.start_date) === startClock, clock(task.start_date))
    await h.assert('B: at the default length', clock(task.end_date) === endAfter(30), clock(task.end_date))
    await h.assert('B: the due date stays', dayOf(task.due_date) === workDay, task.due_date)
    await h.wait(300)
    await h.assert('B: it left the list and is on the timeline', (await row(dropped.id).count()) === 0 && (await block(dropped.id).count()) === 1)
    await h.capture('dropped')

    // --- C. The edges and moving ------------------------------------------------------------------
    const logMark = h.requests().length
    point = await at(workDay, baseMinute)
    box = await block(dropped.id).boundingBox()
    await dragTo(box.x + box.width / 2, box.y + box.height - 2, box.x + box.width / 2, box.y + box.height + 30)
    task = await waitFor(dropped.id, (t) => clock(t.end_date) === endAfter(60))
    await h.assert('C: the bottom edge changes the end', clock(task.end_date) === endAfter(60), clock(task.end_date))
    await h.assert('C: and not the start', clock(task.start_date) === startClock, clock(task.start_date))

    box = await block(dropped.id).boundingBox()
    await dragTo(box.x + box.width / 2, box.y + 2, box.x + box.width / 2, box.y - 30)
    task = await waitFor(dropped.id, (t) => clock(t.start_date) !== startClock)
    const earlier = `${pad(Math.floor((baseMinute - 30) / 60))}:${pad((baseMinute - 30) % 60)}`
    await h.assert('C: the top edge changes the start', () => ({ ok: clock(task.start_date) === earlier, detail: clock(task.start_date) }))
    await h.assert('C: and the end stays', clock(task.end_date) === endAfter(60), clock(task.end_date))

    box = await block(dropped.id).boundingBox()
    await dragTo(box.x + box.width / 2, box.y + box.height / 2, box.x + box.width / 2, box.y + box.height / 2 + 60)
    task = await waitFor(dropped.id, (t) => clock(t.start_date) === endAfter(30))
    await h.assert('C: moving keeps the length', () => ({ ok: clock(task.start_date) === endAfter(30) && clock(task.end_date) === endAfter(120), detail: `${clock(task.start_date)} ${clock(task.end_date)}` }))

    // --- D. Lengths and keys ----------------------------------------------------------------------
    box = await block(dropped.id).boundingBox()
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await h.wait(400)
    await h.assert('D: a click opens the lengths', (await page.locator('[data-plan-popover]').count()) === 1)
    await h.capture('block-popover')
    await page.locator('[data-plan-popover]').getByRole('button', { name: '45m', exact: true }).click()
    task = await waitFor(dropped.id, (t) => clock(t.end_date) === endAfter(75))
    await h.assert('D: an exact length changes the end', () => ({ ok: clock(task.end_date) === endAfter(75), detail: clock(task.end_date) }))
    await page.keyboard.press('Escape')
    await h.wait(200)

    await block(dropped.id).locator('[data-plan-focus]').focus()
    await page.keyboard.press('Alt+Shift+ArrowDown')
    task = await waitFor(dropped.id, (t) => clock(t.start_date) === endAfter(45))
    await h.assert('D: Alt+Shift+Down moves it 15 minutes', () => ({ ok: clock(task.start_date) === endAfter(45) && clock(task.end_date) === endAfter(90), detail: `${clock(task.start_date)} ${clock(task.end_date)}` }))
    await page.keyboard.press('Shift+ArrowDown')
    task = await waitFor(dropped.id, (t) => clock(t.end_date) === endAfter(105))
    await h.assert('D: Shift+Down makes it 15 minutes longer', () => ({ ok: clock(task.end_date) === endAfter(105), detail: clock(task.end_date) }))

    // --- E. Back on the list ----------------------------------------------------------------------
    box = await block(dropped.id).boundingBox()
    const panel = await page.locator('[data-plan-panel]').boundingBox()
    await dragTo(box.x + box.width / 2, box.y + box.height / 2, panel.x + panel.width / 2, panel.y + panel.height / 2, { steps: 20 })
    task = await waitFor(dropped.id, (t) => !isSet(t.start_date))
    await h.assert('E: the time goes', !isSet(task.start_date) && !isSet(task.end_date))
    await h.assert('E: the date stays', dayOf(task.due_date) === workDay, task.due_date)
    await h.wait(400)
    await h.assert('E: it is in the list again', (await row(dropped.id).count()) === 1)

    // --- F. Draw on an empty time -----------------------------------------------------------------
    point = await at(workDay, baseMinute)
    await dragTo(point.x, point.y + 1, point.x, point.y + 61)
    await h.wait(300)
    await h.assert('F: a drawn stretch asks for a title', (await page.locator('[data-plan-draw-title]').count()) === 1)
    await h.capture('draw')
    await page.keyboard.type('PLN drawn', { delay: 10 })
    await page.keyboard.press('Enter')
    let drawn = null
    for (let i = 0; i < 40 && !drawn; i++) {
      const found = await h.api('GET', `/tasks?q=${encodeURIComponent('PLN drawn')}&per_page=20`)
      drawn = (Array.isArray(found) ? found : found.items ?? []).find((t) => t.title === 'PLN drawn')
      if (!drawn) await h.wait(200)
    }
    if (drawn) created.push(drawn.id)
    await h.assert('F: it is created', !!drawn)
    if (drawn) {
      await h.assert('F: in the Inbox', drawn.project_id === h.ids.inbox, String(drawn.project_id))
      await h.assert('F: with the drawn times', clock(drawn.start_date) === startClock && clock(drawn.end_date) === endAfter(60), `${clock(drawn.start_date)} ${clock(drawn.end_date)}`)
      await h.assert('F: and a date-only due date on that day', clock(drawn.due_date) === '23:59' && dayOf(drawn.due_date) === workDay, drawn.due_date)
    }
    await h.wait(400)
    await h.assert('F: it shows on the timeline', drawn ? (await block(drawn.id).count()) === 1 : false)

    project = await h.api('POST', '/projects', { title: 'PLN project' })
    const inProject = await makeTask('PLN in project', {}, project.id)
    await reload()
    if (late) {
      await page.locator('[data-plan-next]').click()
      await h.wait(300)
    }
    await page.locator('[data-plan-source-project]').click()
    await h.wait(200)
    await page.getByLabel('Find a project').fill('PLN project')
    await h.wait(150)
    await h.capture('source-menu')
    await page.locator(`[data-plan-source-item="project:${project.id}"]`).click({ timeout: 4000 })
    await h.wait(600)
    await h.assert('F: a project lists its tasks', (await row(inProject.id).count()) === 1)
    // Away from the first drawn task, and on the grid at any time of day.
    point = await at(workDay, baseMinute + 270 <= 24 * 60 ? baseMinute + 240 : baseMinute - 240)
    await dragTo(point.x, point.y + 1, point.x, point.y + 31)
    await h.wait(300)
    await page.keyboard.type('PLN drawn here', { delay: 10 })
    await page.keyboard.press('Enter')
    let here = null
    for (let i = 0; i < 40 && !here; i++) {
      const found = await h.api('GET', `/tasks?q=${encodeURIComponent('PLN drawn here')}&per_page=20`)
      here = (Array.isArray(found) ? found : found.items ?? []).find((t) => t.title === 'PLN drawn here')
      if (!here) await h.wait(200)
    }
    if (here) created.push(here.id)
    await h.assert('F: drawn while browsing a project, it goes there', () => ({ ok: here?.project_id === project.id, detail: String(here?.project_id) }))
    await page.locator('[data-plan-source-item="day"]').click()
    await h.wait(400)

    // --- Short blocks ----------------------------------------------------------------------------
    // Two 15-minute blocks, one after the other, in the same column: no checkbox, and the title reads.
    const onDay = (hour, minute) => new Date(`${tomorrow}T${pad(hour)}:${pad(minute)}:00`).toISOString()
    const endOfDay = new Date(`${tomorrow}T23:59:59`).toISOString()
    const shortOne = await makeTask('PLN short one', { due_date: endOfDay, start_date: onDay(16, 0), end_date: onDay(16, 15) })
    const shortTwo = await makeTask('PLN short two', { due_date: endOfDay, start_date: onDay(16, 15), end_date: onDay(16, 30) })
    await reload()
    await page.locator('[data-plan-next]').click()
    await h.wait(400)
    await at(tomorrow, 16 * 60)
    await h.wait(200)
    const oneBox = await block(shortOne.id).boundingBox()
    const twoBox = await block(shortTwo.id).boundingBox()
    await h.assert('S: blocks that follow each other share a column', () => ({ ok: oneBox.x === twoBox.x && oneBox.width === twoBox.width, detail: `${oneBox.x},${oneBox.width} ${twoBox.x},${twoBox.width}` }))
    await h.assert('S: and do not overlap', () => ({ ok: oneBox.y + oneBox.height <= twoBox.y, detail: `${oneBox.y + oneBox.height} ${twoBox.y}` }))
    await h.assert('S: a short block has no checkbox', (await block(shortOne.id).locator('.group\\/check').count()) === 0)
    await h.capture('short-blocks')
    await page.mouse.click(oneBox.x + oneBox.width / 2, oneBox.y + oneBox.height / 2)
    await h.wait(300)
    const inPopover = page.locator('[data-plan-popover]').locator('.group\\/check')
    await h.assert('S: its popover has one', (await inPopover.count()) === 1)
    await page.keyboard.press('Escape')
    await h.wait(200)
    await h.api('DELETE', `/tasks/${shortOne.id}`)
    await h.api('DELETE', `/tasks/${shortTwo.id}`)
    await reload()
    if (late) {
      await page.locator('[data-plan-next]').click()
      await h.wait(300)
    }

    // --- G. The default length --------------------------------------------------------------------
    await page.locator('[data-plan-gear]').click()
    await h.wait(250)
    await page.locator('[data-plan-length="45"]').click()
    await h.wait(300)
    await h.capture('gear')
    await page.keyboard.press('Escape')
    await h.wait(200)
    const stored = await page.evaluate(async () => (await window.api.getSyncedPrefs()).values['planner.default_length'])
    await h.assert('G: the length reaches the synced preferences', stored === 45, String(stored))
    box = await rowBox(dropped.id)
    point = await at(workDay, baseMinute + 420 > 1380 ? 1200 : baseMinute + 420)
    await dragTo(box.x + 80, box.y + box.height / 2, point.x, point.y + 2, { steps: 16 })
    task = await waitFor(dropped.id, (t) => isSet(t.start_date))
    await h.assert('G: the next drop takes it', (new Date(task.end_date) - new Date(task.start_date)) / 60000 === 45)
    await page.evaluate(() => window.api.setSyncedPreference('planner.default_length', null))
    await h.wait(200)

    // --- H. 3 days and Week -----------------------------------------------------------------------
    await page.locator('[data-plan-today]').click()
    await page.locator('[data-plan-view="3days"]').click()
    await h.wait(600)
    await h.capture('three-days')
    await h.assert('H: 3 days has three columns', (await page.locator('[data-plan-column]').count()) === 3)
    const third = dayFrom(2)
    await h.assert('H: tomorrow and the next day are on screen', (await page.locator(`[data-plan-column="${third}"]`).count()) === 1)
    const chipTask = await makeTask('PLN chip', { due_date: dueOf(today) })
    await reload()
    await h.assert('H: a date-only task sits in its day\'s top row', (await page.locator(`[data-plan-top="${today}"] [data-plan-chip="${chipTask.id}"]`).count()) === 1)
    const chip = await page.locator(`[data-plan-chip="${chipTask.id}"]`).boundingBox()
    const topTarget = await page.locator(`[data-plan-top="${third}"]`).boundingBox()
    await dragTo(chip.x + chip.width / 2, chip.y + chip.height / 2, topTarget.x + topTarget.width / 2, topTarget.y + topTarget.height / 2, { steps: 16 })
    task = await waitFor(chipTask.id, (t) => dayOf(t.due_date) === third)
    await h.assert('H: a drop on a top row plans that day, without a time', dayOf(task.due_date) === third && clock(task.due_date) === '23:59' && !isSet(task.start_date), task.due_date)

    await page.locator(`[data-plan-day="${third}"]`).click()
    await h.wait(400)
    await h.assert('H: a day header selects the day', (await page.locator(`[data-plan-day="${third}"][aria-pressed="true"]`).count()) === 1)
    await h.assert('H: and the list follows it', (await row(chipTask.id).count()) === 1)

    await page.locator('[data-plan-view="week"]').click()
    await h.wait(600)
    await h.capture('week')
    const columns = await page.locator('[data-plan-column]').evaluateAll((els) => els.map((el) => el.getAttribute('data-plan-column')))
    await h.assert('H: Week has seven columns', columns.length === 7)
    const first = new Date(`${columns[0]}T12:00:00`).getDay()
    await h.assert('H: Week starts on Monday', first === 1, String(first))
    await page.locator('[data-plan-view="day"]').click()
    await page.locator('[data-plan-today]').click()
    await h.wait(400)

    // A past day takes no drawing.
    await page.locator('[data-plan-prev]').click()
    await h.wait(300)
    const yesterday = dayFrom(-1)
    point = await at(yesterday, 600)
    await dragTo(point.x, point.y, point.x, point.y + 60)
    await h.wait(200)
    await h.assert('H: a past day takes no drawing', (await page.locator('[data-plan-draw-title]').count()) === 0)
    await page.locator('[data-plan-today]').click()
    await h.wait(300)

    // --- A due time over a block: both stay readable ---------------------------------------------
    {
      const at = (hour, minute) => {
        const d = new Date()
        d.setDate(d.getDate() + 1)
        d.setHours(hour, minute, 0, 0)
        return d.toISOString()
      }
      const under = await makeTask('PLN under the pill', { start_date: at(15, 0), end_date: at(16, 0) })
      const pill = await makeTask('PLN pill over a block', { due_date: at(15, 30) })
      await reload()
      await page.locator('[data-plan-next]').click()
      await h.wait(400)
      await page.locator(`[data-plan-marker="${pill.id}"]`).scrollIntoViewIfNeeded().catch(() => {})
      await h.wait(200)
      const top = await page.evaluate((id) => {
        const el = document.querySelector(`[data-plan-marker="${id}"]`)
        if (!el) return { found: false }
        const r = el.getBoundingClientRect()
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
        return { found: true, over: el.hasAttribute('data-plan-marker-over'), visible: !!hit?.closest(`[data-plan-marker="${id}"]`) }
      }, pill.id)
      await h.assert('a due time over a block stays on top', () => ({ ok: top.found && top.over && top.visible, detail: JSON.stringify(top) }))
      await h.capture('marker-over-block')
      await h.api('DELETE', `/tasks/${pill.id}`).catch(() => {})
      await h.api('DELETE', `/tasks/${under.id}`).catch(() => {})
      await page.locator('[data-plan-today]').click()
      await h.wait(300)
    }

    // --- I. Fit, Today ----------------------------------------------------------------------------
    await page.evaluate(() => window.api.setSyncedPreference('planner.hours', ['00:00', '23:45']))
    await h.wait(300)
    await reload()
    const before = await page.locator('[data-plan-block]').count()
    await page.locator('[data-plan-gear]').click()
    await h.wait(200)
    await page.locator('[data-plan-fit]').click()
    await h.wait(900)
    const fitted = await page.locator('[data-plan-block]').count()
    await h.assert('I: Fit gives the tasks free slots', () => ({ ok: fitted > before, detail: `${before} to ${fitted}` }))
    await h.capture('fit')
    const undo = page.getByRole('button', { name: 'Undo' }).last()
    await undo.click()
    await h.wait(1200)
    const undone = await page.locator('[data-plan-block]').count()
    await h.assert('I: Undo takes them back', () => ({ ok: undone === before, detail: `${undone}, was ${before}` }))
    await page.evaluate(() => window.api.setSyncedPreference('planner.hours', null))
    await h.wait(300)

    const start = new Date()
    start.setHours(22, 0, 0, 0)
    const end = new Date(start.getTime() + 30 * 60000)
    const noDue = await makeTask('PLN block no due', { start_date: start.toISOString(), end_date: end.toISOString() })
    const startAlone = await makeTask('PLN start alone', { start_date: start.toISOString() })
    await h.goto('/today')
    await h.wait(700)
    await h.assert('I: Today lists a block starting today', (await page.locator(`[data-task-id="${noDue.id}"]`).count()) === 1)
    await h.assert('I: and not a start date alone', (await page.locator(`[data-task-id="${startAlone.id}"]`).count()) === 0)
    await h.assert('I: the row says the time', (await page.locator(`[data-task-id="${noDue.id}"]`).innerText()).includes(':'), '')
    await h.capture('today-with-block')

    await h.goto('/plan')
    await h.wait(500)
    const found = await h.axe('[data-plan-screen]', { label: 'plan screen' })
    await h.assert('the screen has no serious axe findings', () => ({ ok: found.every((v) => v.impact !== 'serious' && v.impact !== 'critical'), detail: found.map((v) => v.id).join(', ') }))

    await h.assert('keeper untouched', dayOf((await server(keeper.id)).due_date) === dayFrom(5))
  } finally {
    await page.mouse.up().catch(() => {})
    for (const id of created) await h.api('DELETE', `/tasks/${id}`).catch(() => {})
    if (project?.id) await h.api('DELETE', `/projects/${project.id}`).catch(() => {})
    await page.evaluate(() => {
      window.api.setSyncedPreference('planner.default_length', null)
      window.api.setSyncedPreference('planner.hours', null)
      return window.api.saveConfigPatch({ planner_enabled: false, planner_view: 'day', planner_source: 'day' })
    }).catch(() => {})
  }
}
