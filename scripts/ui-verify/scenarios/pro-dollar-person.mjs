// Pro: `$` names a person in quick add (cross-app semantics 5.5 and 21.5).
//   A. The composer suggests people after `$`; Tab writes `$"Full Name" `, and the task becomes that
//      person's promise of theirs with the person label.
//   B. A `$` name nobody has yet makes the person on save: a label with that name, marked as a person,
//      on the task, with the promise; Waiting on lists it under that person.
//   C. Quick Entry does the same: suggestions after `$`, and a new person made on save.
// Throwaway data (titles with PRODP, labels "Jan Dollarprobe", "Lalithprobe", "Quinnprobe"); Pro is
// turned off and every label and preference removed at the end.

export const meta = {
  id: 'PRODP',
  wave: 9,
  title: 'Pro: $person in quick add, suggestions and new people',
}

const LABELS = ['Jan Dollarprobe', 'Lalithprobe', 'Quinnprobe']

export default async function run(h) {
  const page = h.page
  await h.resize(1400, 900)
  await h.dismiss()

  const list = (value) => (Array.isArray(value) ? value : value?.items ?? [])
  const cleanTasks = async () => {
    for (const stale of list(await h.api('GET', `/tasks?q=PRODP&per_page=200`).catch(() => []))) {
      if (String(stale.title).includes('PRODP')) await h.api('DELETE', `/tasks/${stale.id}`).catch(() => {})
    }
  }
  const labelsNamed = async () => list(await h.api('GET', '/labels?per_page=200')).filter((label) => LABELS.includes(label.title))
  const cleanLabels = async () => {
    const found = await labelsNamed()
    for (const label of found) await h.api('DELETE', `/labels/${label.id}`).catch(() => {})
    if (found.length) await page.evaluate((keys) => window.api.setSyncedPreferences(Object.fromEntries(keys.map((k) => [k, null]))), found.map((label) => `label_kind.${label.id}`)).catch(() => {})
  }
  await cleanTasks()
  await cleanLabels()

  const ledger = () => page.evaluate(() => window.api.getProLedger())
  const waitFor = async (fn, tries = 40) => {
    for (let i = 0; i < tries; i++) {
      const value = await fn()
      if (value) return value
      await h.wait(200)
    }
    return null
  }
  const findTask = async (title) => list(await h.api('GET', `/tasks?q=${encodeURIComponent(title)}&per_page=50`)).find((task) => task.title === title) ?? null
  const promiseOf = (taskId) => waitFor(async () => (await ledger()).ledger.promises[String(taskId)]?.value ?? null)
  const labelOn = (taskId, labelId) => waitFor(async () => ((await h.api('GET', `/tasks/${taskId}`)).labels ?? []).some((entry) => entry.id === labelId))
  const isPerson = (labelId) => waitFor(async () => (await page.evaluate(() => window.api.getSyncedPrefs())).values[`label_kind.${labelId}`] === 'person')

  try {
    const jan = await h.api('POST', '/labels', { title: 'Jan Dollarprobe' })
    await page.evaluate(() => window.api.saveConfigPatch({ pro_enabled: true, pro_onboarding_seen: true, pro_list_views: {} }))
    await page.evaluate((id) => window.api.setSyncedPreferences({ [`label_kind.${id}`]: 'person' }), jan.id)
    await page.reload()
    await h.wait(1500)
    await page.keyboard.press('F5')
    await h.wait(1200)

    // --- A. Suggestions in the composer -----------------------------------------------------------
    await h.goto('/inbox')
    await h.wait(700)
    await page.keyboard.press('Control+n')
    await h.wait(300)
    await page.keyboard.type('$Dollarpr', { delay: 20 })
    await h.wait(400)
    const options = await page.getByRole('listbox', { name: 'People suggestions' }).getByRole('option').allTextContents().catch(() => [])
    await h.assert('A: typing $ suggests the person', options.includes('Jan Dollarprobe'), JSON.stringify(options))
    await h.capture('composer-suggestions')
    await page.keyboard.press('Tab')
    await h.wait(200)
    const field = await page.evaluate(() => document.activeElement?.value ?? '')
    await h.assert('A: Tab writes the quoted name', field === '$"Jan Dollarprobe" ', JSON.stringify(field))
    await page.keyboard.type('PRODP check the numbers', { delay: 10 })
    await h.wait(300)
    await page.keyboard.press('Enter')
    const a = await waitFor(() => findTask('PRODP check the numbers'))
    await h.assert('A: saved without the name', !!a)
    const aPromise = a ? await promiseOf(a.id) : null
    await h.assert('A: a promise of theirs from Jan', aPromise?.dir === 'theirs' && aPromise?.person === jan.id, JSON.stringify(aPromise))
    await h.assert('A: the task has the person label', !!(a && (await labelOn(a.id, jan.id))))

    // --- B. A new person from the composer ---------------------------------------------------------
    await page.keyboard.press('Escape')
    await page.keyboard.press('Control+n')
    await h.wait(300)
    await page.keyboard.type('$Lalithprobe: PRODP follow up on printing', { delay: 10 })
    await h.wait(400)
    const chips = await page.locator('[data-token-scope]').first().innerText().catch(() => '')
    await h.assert('B: the chip says a new person', chips.includes('From Lalithprobe (new person)'), JSON.stringify(chips))
    await h.capture('composer-new-person')
    await page.keyboard.press('Enter')
    const b = await waitFor(() => findTask('PRODP follow up on printing'))
    await h.assert('B: saved without the name', !!b)
    const lalith = await waitFor(async () => (await labelsNamed()).find((label) => label.title === 'Lalithprobe') ?? null)
    await h.assert('B: a label Lalithprobe was made', !!lalith)
    await h.assert('B: it is marked as a person', !!(lalith && (await isPerson(lalith.id))))
    const bPromise = b ? await promiseOf(b.id) : null
    await h.assert('B: a promise of theirs from Lalithprobe', bPromise?.dir === 'theirs' && bPromise?.person === lalith?.id, JSON.stringify(bPromise))
    await h.assert('B: the task has the new label', !!(b && lalith && (await labelOn(b.id, lalith.id))))
    await page.keyboard.press('Escape')
    await page.keyboard.press('F5')
    await h.wait(1200)
    await h.goto('/waiting-on')
    await h.wait(1000)
    await h.assert('B: Waiting on lists it under Lalithprobe', (await page.locator(`[data-pro-waiting-group="${lalith?.id}"] [data-task-id="${b?.id}"]`).count()) === 1)
    await h.capture('waiting-on')

    // --- C. Quick Entry ---------------------------------------------------------------------------
    const qe = await h.showQuick('entry')
    await h.wait(1200)
    await qe.keyboard.type('$Lalith', { delay: 25 })
    await h.wait(500)
    const qeOptions = await qe.evaluate(() => [...document.querySelectorAll('.autocomplete-item-person')].map((el) => el.textContent))
    await h.assert('C: Quick Entry suggests people after $', qeOptions.includes('Lalithprobe'), JSON.stringify(qeOptions))
    await h.capture('quick-entry-suggestions', { page: qe, transparent: true })
    await qe.keyboard.press('Escape')
    await qe.keyboard.press('Control+a')
    await qe.keyboard.press('Backspace')
    await qe.keyboard.type('for $Quinnprobe PRODP send the slides', { delay: 15 })
    await h.wait(500)
    const qeChips = await qe.evaluate(() => [...document.querySelectorAll('.parse-chip')].map((el) => [el.getAttribute('data-chip-type'), el.textContent.replace(/×/g, '').trim()]))
    await h.assert('C: Quick Entry shows the new person chip', qeChips.some(([type, text]) => type === 'person' && text === 'For Quinnprobe (new person)'), JSON.stringify(qeChips))
    await h.capture('quick-entry-new-person', { page: qe, transparent: true })
    await qe.keyboard.press('Enter')
    const c = await waitFor(() => findTask('PRODP send the slides'))
    await h.assert('C: Quick Entry saved without the name', !!c)
    const quinn = await waitFor(async () => (await labelsNamed()).find((label) => label.title === 'Quinnprobe') ?? null)
    await h.assert('C: Quick Entry made the person', !!(quinn && (await isPerson(quinn.id))))
    const cPromise = c ? await promiseOf(c.id) : null
    await h.assert('C: your promise to Quinnprobe', cPromise?.dir === 'mine' && cPromise?.person === quinn?.id, JSON.stringify(cPromise))
    await h.assert('C: the task has the person label', !!(c && quinn && (await labelOn(c.id, quinn.id))))
    await h.hideQuick('entry').catch(() => {})
  } finally {
    await h.hideQuick('entry').catch(() => {})
    await cleanTasks()
    await cleanLabels()
    await page.evaluate(() => window.api.saveConfigPatch({ pro_enabled: false, pro_list_views: {} })).catch(() => {})
  }
}
