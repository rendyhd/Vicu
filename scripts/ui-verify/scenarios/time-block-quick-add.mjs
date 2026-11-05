// TBQ (contract section 5.4): `for 30m` with a time of day makes a time block, from every place a
// task is typed in the app. What matters is that the time is not lost: the parser takes "at 3pm for
// 30m" out of the title, so the task must come back from the server with start_date and end_date.
//
//   A. Composer: "TBQ call tomorrow at 3pm for 30m" highlights the length, shows a chip with the
//      range, and Enter saves "TBQ call" with a date-only due date and the block.
//   B. Dismissing the length chip keeps the words in the title and the time as the due time.
//   C. Without a time the words stay in the title and the due date reads as usual.
//   D. "for 3 days" is not a date and stays in the title; neither is "3 days" without `in`, while
//      "in 3 days" still is.
//   E. The title editor of an open task writes the block.
//   F. Quick Entry: "TBQ water tomorrow at 4pm for 45 min" saves the block too.
//
// The tasks it creates are deleted at the end.

export const meta = {
  id: 'TBQ',
  wave: 6,
  title: 'Time blocks in quick add: "at 3pm for 30m" saves start and end from the composer, the title editor and Quick Entry',
}

const items = (body) => (Array.isArray(body) ? body : (body?.items ?? []))
const NULL_DATE = '0001-01-01T00:00:00Z'
const set = (value) => !!value && value !== NULL_DATE

const pad = (n) => String(n).padStart(2, '0')
const wall = (iso) => {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
const dayFrom = (days) => {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export default async function run(h) {
  const page = h.page
  await h.resize(1280, 820)
  await h.dismiss()
  const created = []
  const tomorrow = dayFrom(1)

  const waitForTask = async (title) => {
    for (let i = 0; i < 30; i++) {
      const hit = items(await h.api('GET', `/tasks?q=${encodeURIComponent(title)}&per_page=50`)).find((t) => t.title === title && !created.includes(t.id))
      if (hit) {
        created.push(hit.id)
        return hit
      }
      await h.wait(250)
    }
    return null
  }
  const input = () => page.getByPlaceholder('New task').first()
  const chipsOf = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('[data-chip-type]')].map((el) => ({
        type: el.getAttribute('data-chip-type'),
        text: el.textContent.replace(/×/g, '').trim(),
      })),
    )
  const openComposer = async () => {
    await h.goto('/inbox')
    await h.dismiss()
    await page.locator('button[aria-label="New task"]').last().click()
    await h.wait(400)
    await input().click()
  }
  const assertBlock = async (label, task, day, start, end) => {
    await h.assert(`${label}: the due date is that day, date-only`, () => ({
      ok: !!task && wall(task.due_date) === `${day} 23:59:59`,
      detail: task ? wall(task.due_date) : 'no task',
    }))
    await h.assert(`${label}: start ${start} and end ${end} are on the server`, () => ({
      ok: !!task && wall(task.start_date) === `${day} ${start}:00` && wall(task.end_date) === `${day} ${end}:00`,
      detail: task ? `${task.start_date} ${task.end_date}` : 'no task',
    }))
  }

  try {
    // ---- A. Composer ------------------------------------------------------------------------------
    await openComposer()
    await h.type('TBQ call tomorrow at 3pm for 30m', { delay: 15 })
    await h.wait(500)
    await h.capture('composer-typed')
    await h.assert('the composer shows a length chip with the range', async () => {
      const chips = await chipsOf()
      return { ok: chips.some((c) => c.type === 'length' && c.text.includes('–')), detail: JSON.stringify(chips) }
    })
    await h.assert('the length is highlighted as its own token', async () => {
      const text = await page.evaluate(() => document.querySelector('[data-token-type="length"]')?.textContent ?? '')
      return { ok: text.replace(/ /g, ' ') === 'for 30m', detail: text }
    })
    await h.key('Enter')
    await assertBlock('the composer', await waitForTask('TBQ call'), tomorrow, '15:00', '15:30')

    // ---- A2. A length inside the date phrase -------------------------------------------------------
    await openComposer()
    await h.type('TBQ split tomorrow for 1h at 9am', { delay: 15 })
    await h.wait(400)
    await h.key('Enter')
    await assertBlock('a length inside the date phrase', await waitForTask('TBQ split'), tomorrow, '09:00', '10:00')

    // ---- B. Dismissing the length chip ---------------------------------------------------------------
    await openComposer()
    await h.type('TBQ stay tomorrow at 3pm for 30m', { delay: 15 })
    await h.wait(400)
    await page.locator('[data-chip-type="length"] button').first().click()
    await h.wait(300)
    await h.assert('a dismissed length chip is gone', async () => !(await chipsOf()).some((c) => c.type === 'length'))
    await input().click()
    await h.key('End')
    await h.key('Enter')
    const b = await waitForTask('TBQ stay for 30m')
    await h.assert('dismissed: the words stay in the title and the time stays the due time', () => ({
      ok: !!b && wall(b.due_date) === `${tomorrow} 15:00:00` && !set(b.start_date) && !set(b.end_date),
      detail: b ? `${b.title} ${wall(b.due_date)} start ${b.start_date}` : 'no task "TBQ stay for 30m"',
    }))

    // ---- C. Without a time ---------------------------------------------------------------------------
    await openComposer()
    await h.type('TBQ walk tomorrow for 30m', { delay: 15 })
    await h.wait(400)
    await h.key('Enter')
    const c = await waitForTask('TBQ walk for 30m')
    await h.assert('without a time: the words stay and the due date is date-only', () => ({
      ok: !!c && wall(c.due_date) === `${tomorrow} 23:59:59` && !set(c.start_date),
      detail: c ? `${c.title} ${wall(c.due_date)}` : 'no task "TBQ walk for 30m"',
    }))

    // ---- D. Not a length ------------------------------------------------------------------------------
    await openComposer()
    await h.type('TBQ away for 3 days', { delay: 15 })
    await h.wait(400)
    await h.key('Enter')
    const d = await waitForTask('TBQ away for 3 days')
    await h.assert('"for 3 days" is no date and stays in the title', () => ({
      ok: !!d && !set(d.due_date) && !set(d.start_date),
      detail: d ? `${d.title} ${d.due_date}` : 'no task "TBQ away for 3 days"',
    }))

    // ---- D2. A bare amount -----------------------------------------------------------------------------
    await openComposer()
    await h.type('TBQ rest 3 days', { delay: 15 })
    await h.wait(400)
    await h.assert('a bare amount shows no chip', async () => {
      const chips = await chipsOf()
      return { ok: !chips.some((c) => c.type === 'date' || c.type === 'length'), detail: JSON.stringify(chips) }
    })
    await h.key('Enter')
    const bare = await waitForTask('TBQ rest 3 days')
    await h.assert('"3 days" without "in" is no date and stays in the title', () => ({
      ok: !!bare && !set(bare.due_date),
      detail: bare ? `${bare.title} ${bare.due_date}` : 'no task "TBQ rest 3 days"',
    }))

    // ---- D3. "in" still reads as a date ----------------------------------------------------------------
    await openComposer()
    await h.type('TBQ soon in 3 days', { delay: 15 })
    await h.wait(400)
    await h.key('Enter')
    const soon = await waitForTask('TBQ soon')
    await h.assert('"in 3 days" still is a date', () => ({
      ok: !!soon && wall(soon.due_date) === `${dayFrom(3)} 23:59:59`,
      detail: soon ? `${soon.title} ${wall(soon.due_date)}` : 'no task "TBQ soon"',
    }))

    // ---- E. The title editor ---------------------------------------------------------------------------
    // The app is still placing the tasks it just made, and SQLite answers a second writer with a 500.
    let seeded = null
    for (let attempt = 0; !seeded; attempt++) {
      try {
        seeded = await h.api('POST', `/projects/${h.ids.inbox}/tasks`, { title: 'TBQ edit me' })
      } catch (error) {
        if (attempt >= 4) throw error
        await h.wait(750)
      }
    }
    created.push(seeded.id)
    await h.goto('/inbox')
    await h.dismiss()
    await h.click('TBQ edit me')
    await h.wait(700)
    await page.locator('[data-task-id] textarea').first().click()
    await h.key('End')
    await h.type(' tomorrow at 4pm for 1h', { delay: 15 })
    await h.wait(400)
    await h.key('Enter')
    await h.wait(800)
    await h.dismiss()
    let e = null
    for (let i = 0; i < 20; i++) {
      e = await h.api('GET', `/tasks/${seeded.id}`)
      if (set(e.start_date)) break
      await h.wait(250)
    }
    await h.assert('the title editor removed the words', () => ({ ok: e?.title === 'TBQ edit me', detail: e?.title }))
    await assertBlock('the title editor', e, tomorrow, '16:00', '17:00')

    // ---- F. Quick Entry ---------------------------------------------------------------------------------
    const qe = await h.showQuick('entry')
    await h.wait(800)
    await qe.keyboard.type('TBQ water tomorrow at 4pm for 45 min', { delay: 20 })
    await h.wait(500)
    await h.capture('quick-entry', { page: qe, transparent: true })
    await h.assert('Quick Entry shows the length chip with the range', async () => {
      const chips = await qe.evaluate(() => [...document.querySelectorAll('.parse-chip')].map((el) => el.textContent.replace(/×/g, '').trim()))
      return { ok: chips.some((text) => text.includes('–')), detail: JSON.stringify(chips) }
    })
    await qe.keyboard.press('Enter')
    await assertBlock('Quick Entry', await waitForTask('TBQ water'), tomorrow, '16:00', '16:45')
  } finally {
    await h.dismiss().catch(() => {})
    for (const id of created) await h.api('DELETE', `/tasks/${id}`).catch(() => {})
  }
}
