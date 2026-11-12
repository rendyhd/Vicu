// PROB (cross-app semantics 21.5, 21.6, 21.12): promises and people in the running app.
//
//   A. A label marked as a person; capture "PROB Jan: send the deck today" makes a promise of
//      theirs: the row shows the person's mark, "From", and the person label.
//   B. Today lists it under Promises due; key 1 gives Delivered: the task is done and the ledger
//      has the verdict; Undo reopens it.
//   C. Waiting on and the person page list an open promise of theirs; the agenda has it.
//   D. Import: a pasted vicu-import/1 answer shows its rows; Add creates the promise and the action.
//   E. Recap: Copy marks the promises as sent ("In recap").
//
// Its own throwaway label, project and tasks; deleted at the end, Pro off again.

export const meta = {
  id: 'PROB',
  wave: 7,
  title: 'Pro layer B: people, capture, verdicts, Today, Waiting on, person page, import, recap',
}

const pad = (n) => String(n).padStart(2, '0')
const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export default async function run(h) {
  const page = h.page
  await h.resize(1400, 900)
  await h.dismiss()

  const cleanTasks = async () => {
    const found = await h.api('GET', `/tasks?q=${encodeURIComponent('PROB')}&per_page=200`).catch(() => [])
    for (const stale of Array.isArray(found) ? found : found.items ?? []) {
      if (String(stale.title).includes('PROB')) await h.api('DELETE', `/tasks/${stale.id}`).catch(() => {})
    }
  }
  await cleanTasks()
  const labels = await h.api('GET', '/labels?per_page=200')
  for (const stale of Array.isArray(labels) ? labels : labels.items ?? []) {
    if (stale.title === 'Jan Probe') await h.api('DELETE', `/labels/${stale.id}`).catch(() => {})
  }

  let label = null
  const prefKeys = []
  const ledger = () => page.evaluate(() => window.api.getProLedger())
  const findTask = async (title) => {
    const found = await h.api('GET', `/tasks?q=${encodeURIComponent(title)}&per_page=50`)
    return (Array.isArray(found) ? found : found.items ?? []).find((task) => task.title === title) ?? null
  }
  const waitTask = async (title) => {
    for (let i = 0; i < 40; i++) {
      const task = await findTask(title)
      if (task) return task
      await h.wait(200)
    }
    return null
  }

  try {
    label = await h.api('PUT', '/labels', { title: 'Jan Probe' }).catch(() => h.api('POST', '/labels', { title: 'Jan Probe' }))
    prefKeys.push(`label_kind.${label.id}`)
    await page.evaluate(() => window.api.saveConfigPatch({ pro_enabled: true, pro_onboarding_seen: true, pro_list_views: {} }))
    await page.evaluate((id) => window.api.setSyncedPreferences({ [`label_kind.${id}`]: 'person' }), label.id)
    await page.reload()
    await h.wait(1500)
    await page.keyboard.press('F5')
    await h.wait(1200)

    // --- A. Capture -------------------------------------------------------------------------------
    await h.goto('/today')
    await h.wait(700)
    await page.keyboard.press('Control+n')
    await h.wait(300)
    await page.keyboard.type('Jan Probe: PROB send the deck today', { delay: 15 })
    await h.wait(400)
    await h.capture('composer-person')
    await page.keyboard.press('Enter')
    const promised = await waitTask('PROB send the deck')
    await h.assert('A: the capture made the task without the name', !!promised)
    let record = null
    for (let i = 0; i < 30 && promised; i++) {
      record = (await ledger()).ledger.promises[String(promised.id)]?.value
      if (record) break
      await h.wait(200)
    }
    await h.assert('A: the ledger holds a promise of theirs', record?.dir === 'theirs' && record?.person === label.id, JSON.stringify(record))
    let withLabel = null
    for (let i = 0; i < 30 && promised; i++) {
      withLabel = await h.api('GET', `/tasks/${promised.id}`)
      if ((withLabel.labels ?? []).some((entry) => entry.id === label.id)) break
      await h.wait(200)
    }
    await h.assert('A: the task got the person label', (withLabel?.labels ?? []).some((entry) => entry.id === label.id))
    await page.keyboard.press('F5')
    await h.wait(1200)

    // --- B. Today and a verdict -------------------------------------------------------------------
    const due = page.locator(`[data-pro-promises-due] [data-task-id="${promised?.id}"]`)
    await h.assert('B: Today lists it under Promises due', (await due.count()) === 1)
    await h.assert('B: the row shows the person mark', (await due.locator('[data-pro-person-mark]').count()) === 1)
    await h.capture('today-promises')
    await due.focus()
    await page.keyboard.press('1')
    let done = null
    for (let i = 0; i < 30; i++) {
      done = await h.api('GET', `/tasks/${promised.id}`)
      if (done.done) break
      await h.wait(200)
    }
    await h.assert('B: key 1 (Delivered) completes it', done?.done === true)
    const verdicts = (await ledger()).ledger.promises[String(promised.id)]?.value?.verdicts ?? []
    await h.assert('B: the verdict is in the ledger', verdicts.some((verdict) => verdict.kind === 'delivered'))
    await page.getByRole('button', { name: 'Undo' }).first().click().catch(() => {})
    let reopened = null
    for (let i = 0; i < 30; i++) {
      reopened = await h.api('GET', `/tasks/${promised.id}`)
      if (!reopened.done) break
      await h.wait(200)
    }
    await h.assert('B: Undo reopens it', reopened?.done === false)

    // --- C. Waiting on and the person page --------------------------------------------------------------
    await h.goto('/waiting-on')
    await h.wait(900)
    await h.assert('C: Waiting on lists the promise', (await page.locator(`[data-pro-waiting-group="${label.id}"] [data-task-id="${promised.id}"]`).count()) === 1)
    await h.capture('waiting-on')
    await h.goto(`/person/${label.id}`)
    await h.wait(900)
    await h.assert('C: the person page lists it', (await page.locator(`[data-task-id="${promised.id}"]`).count()) >= 1)
    const agenda = (await page.locator('[data-pro-agenda]').textContent()) ?? ''
    await h.assert('C: the agenda has the promise', agenda.includes('PROB send the deck'), agenda)
    await h.capture('person')

    // --- D. Import ------------------------------------------------------------------------------------
    const answer = JSON.stringify({
      format: 'vicu-import/1',
      source: { kind: 'meeting', title: 'PROB sync', date: today() },
      items: [
        { type: 'promise', owner: 'Jan Probe', what: 'PROB budget draft', in_their_words: 'I will have it Friday' },
        { type: 'action', owner: 'me', what: 'PROB book the room' },
      ],
    })
    await page.evaluate((text) => navigator.clipboard.writeText(text), answer)
    await h.goto('/inbox')
    await h.wait(700)
    await page.keyboard.press('Control+v')
    await page.locator('[data-pro-import-rows]').waitFor({ timeout: 5000 }).catch(() => {})
    await h.assert('D: a pasted import opens its review', (await page.locator('[data-pro-import-row]').count()) === 2)
    await h.capture('import-review')
    await page.locator('[data-pro-import-add]').click()
    const imported = await waitTask('PROB budget draft')
    const action = await waitTask('PROB book the room')
    await h.assert('D: Add creates the promise and the action', !!imported && !!action)
    let importedRecord = null
    for (let i = 0; i < 30 && imported; i++) {
      importedRecord = (await ledger()).ledger.promises[String(imported.id)]?.value
      if (importedRecord) break
      await h.wait(200)
    }
    await h.assert('D: the imported promise keeps their words', importedRecord?.words === 'I will have it Friday', JSON.stringify(importedRecord))

    // --- E. Recap ----------------------------------------------------------------------------------------
    await h.goto(`/person/${label.id}`)
    await h.wait(900)
    await page.locator(`[data-pro-person="${label.id}"]`).getByRole('button', { name: 'Recap' }).click()
    await page.locator('[data-pro-recap-preview]').waitFor({ timeout: 5000 }).catch(() => {})
    const preview = (await page.locator('[data-pro-recap-preview]').textContent()) ?? ''
    await h.assert('E: the recap lists the promise', preview.includes('PROB budget draft'), preview)
    await h.capture('recap')
    await page.locator('[data-pro-recap-copy]').click()
    let sent = null
    for (let i = 0; i < 30 && imported; i++) {
      sent = (await ledger()).ledger.promises[String(imported.id)]?.value?.sent
      if (sent?.length) break
      await h.wait(200)
    }
    await h.assert('E: Copy marks it as sent', (sent?.length ?? 0) > 0)
  } finally {
    await cleanTasks()
    if (label) await h.api('DELETE', `/labels/${label.id}`).catch(() => {})
    if (prefKeys.length) await page.evaluate((keys) => window.api.setSyncedPreferences(Object.fromEntries(keys.map((k) => [k, null]))), prefKeys).catch(() => {})
    await page.evaluate(() => window.api.saveConfigPatch({ pro_enabled: false, pro_list_views: {} })).catch(() => {})
  }
}
