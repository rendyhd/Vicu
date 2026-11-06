// PMD (contract section 14.10, assistant contract section 10): Plan my day in the real app against
// the server, with a fake OpenAI-compatible model on a local port.
//
//   A. Without the assistant: a leftover sent to Today writes the date at once; ticking and a length
//      change the meter; Arrange draws dashed blocks and saves nothing; dragging a draft changes the
//      draft only; Accept writes one patch per task; a kept task gets the day without a time.
//   B. Ready: the reminder is written relative to the start; Undo all puts everything back.
//   C. With the assistant: one request when the session opens, what it sends, suggestions dashed
//      with a reason, Apply the suggestions, a suggested length, its start in the draft, and a
//      failing model is said once while the session goes on.
//
// Its own throwaway tasks with the prefix PMD; everything is deleted at the end.

import { createServer } from 'node:http'

export const meta = {
  id: 'PMD',
  wave: 6,
  title: 'Plan my day: leftovers, choose, arrange, accept, undo all, the assistant',
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
const dayOf = (iso) => {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const clock = (iso) => {
  const d = new Date(iso)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const isSet = (value) => !!value && value !== NULL_DATE

export default async function run(h) {
  const page = h.page
  await h.resize(1400, 900)
  await h.dismiss()

  // A run that was cut off leaves its tasks behind, and they would be in this run's day.
  const leftBehind = await h.api('GET', `/tasks?q=${encodeURIComponent('PMD ')}&per_page=200`)
  for (const stale of Array.isArray(leftBehind) ? leftBehind : leftBehind.items ?? []) {
    if (String(stale.title).startsWith('PMD ')) await h.api('DELETE', `/tasks/${stale.id}`).catch(() => {})
  }

  const created = []
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
  const openPlan = async () => {
    await page.reload()
    await h.wait(1500)
    await h.goto('/plan')
    await h.wait(300)
    await page.keyboard.press('F5')
    await h.wait(900)
  }
  // Keeps tomorrow's list on its way for a while, as a slow connection would.
  const holdTomorrowsList = (ms) => h.app.evaluate(({ session }, { ms, marker }) => {
    session.defaultSession.webRequest.onBeforeRequest(ms
      ? (details, done) => {
          if (decodeURIComponent(details.url).includes(marker)) setTimeout(() => done({}), ms)
          else done({})
        }
      : null)
  }, { ms, marker: `start_date+>=+'${new Date(`${dayFrom(1)}T00:00:00`).toISOString()}'` })
  const nextStep = async () => {
    await page.locator('[data-plan-next-step]').click()
    await h.wait(350)
  }

  // Tomorrow is planned here, so there is always a whole free day whatever the hour of the run.
  const tomorrow = dayFrom(1)
  let model = null

  try {
    await page.evaluate(() => window.api.saveConfigPatch({ planner_enabled: true, planner_view: 'day', planner_source: 'day' }))
    const late = await makeTask('PMD late', { due_date: dueOf(dayFrom(-2)) })
    const lateTwo = await makeTask('PMD late two', { due_date: dueOf(dayFrom(-1)) })
    const first = await makeTask('PMD tomorrow first', { due_date: dueOf(tomorrow), priority: 3 })
    const second = await makeTask('PMD tomorrow second', { due_date: dueOf(tomorrow) })
    const kept = await makeTask('PMD kept', { due_date: dueOf(tomorrow) })
    const inboxTask = await makeTask('PMD inbox')
    await openPlan()

    // --- A. Without the assistant -----------------------------------------------------------------
    await page.locator('[data-plan-my-day]').click()
    await h.wait(500)
    await h.assert('A: the session takes the list\'s place', (await page.locator('[data-plan-session]').count()) === 1 && (await page.locator('[data-plan-panel]').count()) === 0)
    await h.assert('A: leftovers are listed', (await page.locator(`[data-plan-leftover="${late.id}"]`).count()) === 1)
    await h.capture('leftovers')

    await page.locator(`[data-plan-leftover="${late.id}"] [data-plan-leftover-action="tomorrow"]`).click()
    let task = await waitFor(late.id, (t) => dayOf(t.due_date) === tomorrow)
    await h.assert('A: a leftover action is written at once', dayOf(task.due_date) === tomorrow)
    await h.wait(300)
    await h.assert('A: the row says what happened', (await page.locator(`[data-plan-leftover="${late.id}"]`).innerText()).includes('Moved to tomorrow'))

    await page.locator('[data-plan-target="tomorrow"]').click()
    await h.wait(700)
    await nextStep()
    await h.assert('A: what is on the day is ticked', await page.locator(`[data-plan-candidate="${first.id}"] input`).isChecked())
    await h.assert('A: the Inbox is not', !(await page.locator(`[data-plan-candidate="${inboxTask.id}"] input`).isChecked()))
    const meterText = () => page.locator('[data-plan-meter]').innerText()
    const before = await meterText()
    await page.locator(`[data-plan-candidate="${inboxTask.id}"]`).click({ position: { x: 30, y: 10 } })
    await h.wait(200)
    await h.assert('A: ticking one changes the meter', (await meterText()) !== before)
    await page.locator(`[data-plan-length-chip="${second.id}"]`).click()
    await h.wait(200)
    await h.capture('choose')

    await nextStep()
    await h.assert('A: Arrange draws dashed blocks', (await page.locator('[data-plan-block].border-dashed').count()) >= 4)
    await h.capture('arrange')
    task = await server(first.id)
    await h.assert('A: nothing is saved yet', !isSet(task.start_date))

    // Keep one without a time, and drag a draft.
    await page.locator(`[data-plan-keep="${kept.id}"]`).click()
    await h.wait(250)
    await h.assert('A: a kept task leaves the draft', (await page.locator(`[data-plan-block="${kept.id}"]`).count()) === 0)
    const draftBox = await page.locator(`[data-plan-block="${first.id}"]`).boundingBox()
    await page.mouse.move(draftBox.x + draftBox.width / 2, draftBox.y + draftBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(draftBox.x + draftBox.width / 2, draftBox.y + draftBox.height / 2 + 6, { steps: 2 })
    await page.mouse.move(draftBox.x + draftBox.width / 2, draftBox.y + draftBox.height / 2 + 300, { steps: 10 })
    await h.wait(120)
    await page.mouse.up()
    await h.wait(300)
    task = await server(first.id)
    await h.assert('A: dragging a draft saves nothing', !isSet(task.start_date))
    const draftAfter = await page.locator(`[data-plan-block="${first.id}"]`).boundingBox()
    await h.assert('A: but moves it', draftAfter.y > draftBox.y + 200, `${draftBox.y} ${draftAfter.y}`)

    const mark = h.requests().length
    await nextStep()
    await h.wait(900)
    await h.capture('ready')
    task = await waitFor(first.id, (t) => isSet(t.start_date))
    await h.assert('A: Accept writes the block', dayOf(task.start_date) === tomorrow && isSet(task.end_date))
    const movedStart = clock(task.start_date)
    const second2 = await waitFor(second.id, (t) => isSet(t.start_date))
    await h.assert('A: a changed length is written', (new Date(second2.end_date) - new Date(second2.start_date)) / 60000 === 45)
    const inboxAfter = await waitFor(inboxTask.id, (t) => isSet(t.start_date))
    await h.assert('A: a task ticked from the Inbox gets the day and a block', dayOf(inboxAfter.due_date) === tomorrow)
    const keptAfter = await server(kept.id)
    await h.assert('A: a kept task stays on the day without a time', dayOf(keptAfter.due_date) === tomorrow && !isSet(keptAfter.start_date))
    const patches = h.requests().slice(mark).filter((r) => r.method === 'PATCH')
    await h.assert('A: one patch per task', patches.length === new Set(patches.map((r) => r.url)).size, patches.length)
    await h.assert('A: moved by hand, it stays where it was put', movedStart >= '12:00', movedStart)

    // --- B. Ready ---------------------------------------------------------------------------------
    await page.locator('[data-plan-remind]').check()
    task = await waitFor(first.id, (t) => (t.reminders ?? []).some((r) => r.relative_to === 'start_date'))
    const reminder = (task.reminders ?? []).find((r) => r.relative_to === 'start_date')
    await h.assert('B: the reminder follows the start', reminder?.relative_period === 0)

    await page.locator('[data-plan-undo-all]').click()
    await h.wait(300)
    task = await waitFor(first.id, (t) => !isSet(t.start_date))
    await h.assert('B: Undo all takes the block away', !isSet(task.start_date) && !isSet(task.end_date))
    await h.assert('B: and the reminder', !(task.reminders ?? []).some((r) => r.relative_to === 'start_date'))
    const lateAfter = await waitFor(late.id, (t) => dayOf(t.due_date) === dayFrom(-2))
    await h.assert('B: and the leftover', dayOf(lateAfter.due_date) === dayFrom(-2), lateAfter.due_date)
    const inboxBack = await waitFor(inboxTask.id, (t) => !isSet(t.due_date))
    await h.assert('B: and the Inbox task\'s date', !isSet(inboxBack.due_date) && !isSet(inboxBack.start_date))
    await page.locator('[data-plan-exit]').click()
    await h.wait(300)

    // --- C. The assistant -------------------------------------------------------------------------
    const bodies = []
    let failNext = false
    const sse = (chunks) => chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n'
    const text = (value) => sse([{ choices: [{ delta: { content: JSON.stringify(value) } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }])
    model = createServer((req, res) => {
      let body = ''
      req.on('data', (chunk) => { body += chunk })
      req.on('end', () => {
        if (req.method === 'GET' && req.url.endsWith('/models')) {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ data: [{ id: 'fake' }] }))
          return
        }
        const request = JSON.parse(body || '{}')
        if (Array.isArray(request.tools) && request.tools.length > 0) {
          res.writeHead(200, { 'content-type': 'text/event-stream' })
          res.end(sse([
            { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'add_numbers', arguments: '{"a":2,"b":3}' } }] } }] },
            { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
          ]))
          return
        }
        const user = String(request.messages?.find((m) => m.role === 'user')?.content ?? '')
        if (!user.includes('<plan>')) {
          res.writeHead(200, { 'content-type': 'text/event-stream' })
          res.end(text({ answer: 5 }))
          return
        }
        bodies.push(user)
        if (failNext) {
          res.writeHead(400, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: { message: 'down' } }))
          return
        }
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.end(text({
          leftovers: [
            { task_id: late.id, action: 'tomorrow', reason: 'Fits tomorrow' },
            { task_id: lateTwo.id, action: 'no_date', reason: 'No real deadline' },
          ],
          picks: [
            { task_id: first.id, minutes: 60, start: '10:00', reason: 'Urgent, long stretch' },
            { task_id: second.id, minutes: 15, start: '08:00', reason: 'Quick one first' },
            { task_id: inboxTask.id, minutes: 30, start: null, reason: 'Fits a gap' },
          ],
          can_wait: [],
        }))
      })
    })
    await new Promise((resolve) => model.listen(0, '127.0.0.1', resolve))
    const address = `http://127.0.0.1:${model.address().port}/v1`
    const tested = await page.evaluate(async (addr) => {
      await window.api.ai.saveSettings({ provider: 'ollama', address: addr, models: { dictation: 'fake', ask: 'fake' }, features: { ask: true } })
      return window.api.ai.testConnection('fake')
    }, address)
    await h.assert('C: the fake model passes Test connection', () => ({ ok: tested.success && tested.data.features.ask, detail: JSON.stringify(tested).slice(0, 160) }))
    await openPlan()
    await page.locator('[data-plan-my-day]').click()
    await h.wait(900)
    await page.locator('[data-plan-target="tomorrow"]').click().catch(() => {})
    await h.wait(1200)
    const hasSwitch = await page.locator('[data-plan-assistant]').count()
    if (hasSwitch === 0) {
      h.skip('C: the assistant', 'Ask is not ready with these settings in this run')
    } else {
      await h.assert('C: it asks once per day shown', bodies.length >= 1 && bodies.length <= 2, bodies.length)
      const sent = bodies[bodies.length - 1] ?? ''
      await h.assert('C: the request has the plan, leftovers and candidates', ['<plan>', '<leftovers>', '<candidates>'].every((tag) => String(sent).includes(tag)))
      await h.assert('C: no routine names leave the app', !/"name":"[^"]*routine/i.test(String(sent)))
      await h.capture('assistant-leftovers')
      await h.assert('C: Apply the suggestions shows', (await page.locator('[data-plan-apply-all]').count()) === 1)
      await nextStep()
      await h.capture('assistant-choose')
      await h.assert('C: a suggested task is not ticked until you tick it', !(await page.locator(`[data-plan-candidate="${inboxTask.id}"] input`).isChecked()))
      await h.assert('C: its reason shows', (await page.locator(`[data-plan-candidate="${inboxTask.id}"]`).innerText()).includes('Fits a gap'))
      await h.assert('C: a suggested length shows, dashed', (await page.locator(`[data-plan-length-chip="${first.id}"].border-dashed`).innerText()).includes('1h'))
      await nextStep()
      await h.capture('assistant-arrange')
      const firstRow = await page.locator(`[data-plan-arrange-row="${first.id}"]`).innerText()
      await h.assert('C: its start is used', () => ({
        ok: firstRow.includes('10:00'),
        detail: `${firstRow.replace(/\n/g, ' ')} | requests ${bodies.length} | ${(/<plan>\n(.*)\n<\/plan>/.exec(sent) ?? [])[1]}`,
      }))
      await h.assert('C: with its reason', firstRow.includes('Urgent, long stretch'), firstRow)
      await page.locator('[data-plan-arrange="first"]').click()
      await h.wait(250)
      const plain = await page.locator(`[data-plan-arrange-row="${first.id}"]`).innerText()
      await h.assert('C: First free slots lays it out without a new request', plain.includes('08:00') && !plain.includes('10:00'), plain)
      const sentBefore = bodies.length
      await page.locator(`[data-plan-back]`).click()
      await h.wait(200)
      await page.locator('[data-plan-ask-again]').click()
      await h.wait(800)
      await h.assert('C: Ask again sends another', bodies.length === sentBefore + 1, bodies.length)

      failNext = true
      await page.locator('[data-plan-ask-again]').click()
      await h.wait(1500)
      await h.assert('C: a failure is said', (await page.locator('[data-plan-meter]').innerText()).includes('No suggestions'))
      await h.capture('assistant-failed')
      await nextStep()
      await h.assert('C: and the session goes on', (await page.locator('[data-plan-arrange-row]').count()) > 0)

      // --- D. The request reads the day as it is ----------------------------------------------------
      // A copy of the day saved earlier must not decide the free time. Here another device has taken
      // a block away, the app starts from its saved copy, and the fresh list is still on its way.
      await page.locator('[data-plan-exit]').click()
      await h.wait(200)
      failNext = false
      const elsewhere = await makeTask('PMD on another device', {
        due_date: dueOf(tomorrow),
        start_date: new Date(`${tomorrow}T10:00:00`).toISOString(),
        end_date: new Date(`${tomorrow}T11:00:00`).toISOString(),
      })
      await openPlan()
      await page.locator('[data-plan-my-day]').click()
      await h.wait(400)
      await page.locator('[data-plan-target="tomorrow"]').click()
      await page.locator(`[data-plan-block="${elsewhere.id}"]`).waitFor({ timeout: 5000 })
      await h.wait(2500) // Long enough for the query cache to be saved with the block in it.
      await h.api('DELETE', `/tasks/${elsewhere.id}`)
      await holdTomorrowsList(1500)
      const asked = bodies.length
      await openPlan()
      await page.locator('[data-plan-my-day]').click()
      await h.wait(300)
      await page.locator('[data-plan-target="tomorrow"]').click()
      let forTomorrow = null
      for (let i = 0; i < 40 && !forTomorrow; i++) {
        forTomorrow = bodies.slice(asked).find((body) => body.includes(`"day":"${tomorrow}"`)) ?? null
        if (!forTomorrow) await h.wait(150)
      }
      const planBlock = (/<plan>\n(.*)\n<\/plan>/.exec(forTomorrow ?? '') ?? [])[1] ?? 'no request'
      await h.assert('D: the free time comes from the fresh list', () => ({ ok: planBlock.includes('"free":[{"start":"08:00","end":"18:00"}]'), detail: planBlock }))
      await h.wait(500)
      await nextStep()
      await nextStep()
      const freshRow = await page.locator(`[data-plan-arrange-row="${first.id}"]`).innerText()
      await h.assert('D: so the suggested start stands', () => ({ ok: freshRow.includes('10:00'), detail: freshRow.replace(/\n/g, ' ') }))
      await holdTomorrowsList(0)
    }
    await page.locator('[data-plan-exit]').click()
    await h.wait(200)
  } finally {
    await holdTomorrowsList(0).catch(() => {})
    await page.mouse.up().catch(() => {})
    for (const id of created) await h.api('DELETE', `/tasks/${id}`).catch(() => {})
    await page.evaluate(() => {
      window.api.ai.saveSettings({ provider: '', features: { ask: false } })
      return window.api.saveConfigPatch({ planner_enabled: false, planner_view: 'day', planner_source: 'day', planner_nudge: null })
    }).catch(() => {})
    if (model) await new Promise((resolve) => model.close(resolve))
  }
}
