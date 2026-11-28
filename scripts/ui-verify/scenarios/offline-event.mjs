// OFF (rendyhd/Vicu#77): after the window has had an `offline` event, a new task still goes to the
// host at once. The query library used to hold every mutation back after that event ("waiting for
// the network"), so a task made after Wi-Fi dropped spun in the composer until the connection came
// back and never reached the offline queue. Started without a connection there is no such event,
// which is why it only happened when the connection was lost later.
//
// The test server stays reachable: only the window's event is fired, so a task that arrives on the
// server proves the create was not held back. Main's own queueing of a create it cannot send is
// not changed by the fix and is covered by the offline tests.
//
//   A. With the window offline, Enter in the composer sends the task: it is on the server, and the
//      composer is ready for the next one.
//   B. A change to an existing task (completing it) is sent too.
//   C. Back online, the lists still load.
//
// The task it creates is deleted at the end.

import { checkboxOf } from './_completion.mjs'

export const meta = {
  id: 'OFF',
  wave: 6,
  title: 'After the window goes offline a new task and a completion are still sent, not held until the connection returns',
}

const items = (body) => (Array.isArray(body) ? body : (body?.items ?? []))
const TITLE = 'OFF task made after the window went offline'

export default async function run(h) {
  const page = h.page
  await h.resize(1280, 820)
  await h.dismiss()
  const created = []
  const setOnline = (online) =>
    page.evaluate((on) => window.dispatchEvent(new Event(on ? 'online' : 'offline')), online)

  const findTask = async (tries = 12) => {
    for (let i = 0; i < tries; i++) {
      const hit = items(await h.api('GET', `/tasks?q=${encodeURIComponent(TITLE)}&per_page=50`)).find((t) => t.title === TITLE)
      if (hit) return hit
      await h.wait(250)
    }
    return null
  }

  try {
    await h.goto('/inbox')
    await h.dismiss()
    await page.locator('button[aria-label="New task"]').last().click()
    await h.wait(400)
    const input = page.getByPlaceholder('New task').first()
    await input.click()

    // ---- A. A new task -----------------------------------------------------------------------------
    await setOnline(false)
    await h.type(TITLE, { delay: 10 })
    await h.key('Enter')
    // Three seconds is far longer than a create takes against the local server; held back, it
    // would never arrive while the window stays offline.
    const task = await findTask()
    if (task) created.push(task.id)
    await h.capture('created-while-offline')
    await h.assert('a task made with the window offline is on the server', () => ({ ok: !!task, detail: task ? `#${task.id}` : 'not on the server after 3 s' }))
    await h.assert('the composer is ready for the next task', async () => {
      const value = await input.inputValue().catch(() => null)
      const editable = value !== null ? await input.isEditable().catch(() => false) : false
      const text = value ?? (await input.textContent().catch(() => '')) ?? ''
      return { ok: !text.includes(TITLE) && (value === null || editable), detail: JSON.stringify({ text, editable }) }
    })
    await h.key('Escape')

    // ---- B. Completing it --------------------------------------------------------------------------
    if (task) {
      await checkboxOf(h, task.id).click()
      let done = false
      for (let i = 0; i < 12 && !done; i++) {
        done = (await h.api('GET', `/tasks/${task.id}`))?.done === true
        if (!done) await h.wait(250)
      }
      await h.assert('a completion with the window offline is sent', () => ({ ok: done, detail: done ? 'done on the server' : 'still open after 3 s' }))
    }

    // ---- C. Back online ----------------------------------------------------------------------------
    await setOnline(true)
    await h.goto('/today')
    await h.wait(600)
    await h.assert('back online, Today loads', async () => ({
      ok: (await page.locator('main').count()) > 0 && !(await page.getByText('Something went wrong').count()),
    }))
  } finally {
    await setOnline(true).catch(() => {})
    await h.dismiss().catch(() => {})
    for (const id of created) await h.api('DELETE', `/tasks/${id}`).catch(() => {})
  }
}
