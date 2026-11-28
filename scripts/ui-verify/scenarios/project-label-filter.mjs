// PLF (cross-app semantics 17.2, docs/guide/projects.md "Labels"): the label filter of a project
// page in the running app. Throwaway project "PLF Trip" with the section "PLF Bookings", labels
// "plf-booking", "plf-errand" and "plf-packing", and tasks titled "PLF ...".
//
//   1. The filter button sits next to the project's … button; the bar is closed.
//   2. The button opens the bar: the page's labels by title with their counts, focus on the first.
//   3. One label: only its tasks, the section without one is gone, "4 more tasks in this project".
//   4. A second label adds its tasks (any of them) and brings the section back.
//   5. Escape closes the bar, the focus goes back to the button, which keeps the count.
//   6. Show all unpicks everything.
//   7. Leaving the project forgets the filter.
//   8. A project without labels has no button.  9. axe on the bar.
// Removes everything it made.
export const meta = {
  id: 'PLF',
  wave: 9,
  title: 'Project page: filter by label with the button next to the … button',
}

const list = (value) => (Array.isArray(value) ? value : (value?.items ?? []))
const PROJECTS = ['PLF Trip', 'PLF Bookings', 'PLF Plain']
const LABELS = { 'plf-booking': '378add', 'plf-errand': '1d9e75', 'plf-packing': '7f77dd' }

export default async function run(h) {
  const page = h.page
  await h.resize(1280, 820)
  await h.dismiss()

  const retry = async (fn, tries = 8) => {
    for (let i = 0; ; i++) {
      try {
        return await fn()
      } catch (error) {
        if (i >= tries - 1) throw error
        await h.wait(400)
      }
    }
  }
  const waitFor = async (fn, tries = 40, gap = 200) => {
    for (let i = 0; i < tries; i++) {
      const value = await fn()
      if (value) return value
      await h.wait(gap)
    }
    return null
  }
  const noSerious = (violations) => violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')

  const cleanStale = async () => {
    for (const task of list(await h.api('GET', '/tasks?q=PLF&per_page=200').catch(() => []))) {
      if (String(task.title).startsWith('PLF ')) await h.api('DELETE', `/tasks/${task.id}`).catch(() => {})
    }
    // Children first, so the parent's delete does not find them gone.
    for (const project of list(await h.api('GET', '/projects?per_page=200').catch(() => [])).sort((a, b) => (b.parent_project_id ?? 0) - (a.parent_project_id ?? 0))) {
      if (PROJECTS.includes(project.title)) await h.api('DELETE', `/projects/${project.id}`).catch(() => {})
    }
    for (const label of list(await h.api('GET', '/labels?per_page=200').catch(() => []))) {
      if (label.title in LABELS) await h.api('DELETE', `/labels/${label.id}`).catch(() => {})
    }
  }
  await cleanStale()

  const button = page.locator('[data-project-label-filter]')
  const bar = page.locator('[data-project-label-bar]')
  const more = page.locator('[data-project-label-more]')
  const pill = (title) => bar.getByRole('button', { name: new RegExp(`^${title} \\d`) })
  const TITLES = ['PLF Book flights', 'PLF Buy adapter', 'PLF Day plan', 'PLF Pack camera', 'PLF Reserve hotel', 'PLF Plain task']
  /** The known titles the list's rows show, sorted. */
  const rowTitles = async () => {
    const texts = await page.locator('main [data-task-id]').allInnerTexts()
    return TITLES.filter((title) => texts.some((text) => text.includes(title))).sort()
  }
  const mainText = () => page.locator('main').innerText()
  const same = (a, b) => JSON.stringify(a) === JSON.stringify([...b].sort())

  try {
    // --- Setup ----------------------------------------------------------------------------------------
    const trip = await retry(() => h.api('POST', '/projects', { title: 'PLF Trip' }))
    const bookings = await retry(() => h.api('POST', '/projects', { title: 'PLF Bookings', parent_project_id: trip.id }))
    const plain = await retry(() => h.api('POST', '/projects', { title: 'PLF Plain' }))
    const labels = {}
    for (const [title, hex_color] of Object.entries(LABELS)) labels[title] = await retry(() => h.api('POST', '/labels', { title, hex_color }))
    const mkTask = async (title, projectId, labelTitles = []) => {
      const task = await retry(() => h.api('POST', `/projects/${projectId}/tasks`, { title }))
      for (const l of labelTitles) await retry(() => h.api('POST', `/tasks/${task.id}/labels`, { label_id: labels[l].id }))
      return task
    }
    await mkTask('PLF Book flights', trip.id, ['plf-booking'])
    await mkTask('PLF Buy adapter', trip.id, ['plf-errand'])
    await mkTask('PLF Day plan', trip.id)
    await mkTask('PLF Pack camera', trip.id, ['plf-packing'])
    await mkTask('PLF Reserve hotel', bookings.id, ['plf-booking'])
    await mkTask('PLF Plain task', plain.id)
    const everything = ['PLF Book flights', 'PLF Buy adapter', 'PLF Day plan', 'PLF Pack camera', 'PLF Reserve hotel']

    await h.goto('/today')
    await h.wait(600)
    await page.keyboard.press('F5')
    await h.wait(1200)
    await h.goto(`/project/${trip.id}`)
    await waitFor(async () => same(await rowTitles(), everything), 40, 250)

    // --- 1. The button ---------------------------------------------------------------------------------
    await h.assert('1: the filter button sits just before the project\'s … button and the bar is closed', async () => {
      const next = await button.evaluate((el) => el.nextElementSibling?.getAttribute('aria-label') ?? null)
      return {
        ok: (await button.count()) === 1 && (await bar.count()) === 0 && next === 'PLF Trip actions'
          && (await button.getAttribute('aria-expanded')) === 'false',
        detail: String(next),
      }
    })
    await h.capture('closed', { clip: page.locator('main') })

    // --- 2. The bar ------------------------------------------------------------------------------------
    await button.click()
    await waitFor(async () => (await bar.count()) === 1)
    await h.assert('2: the bar lists the page\'s labels by title with their counts', async () => {
      const names = await bar.getByRole('button').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') ?? el.textContent))
      return { ok: JSON.stringify(names) === JSON.stringify(['plf-booking 2 tasks', 'plf-errand 1 task', 'plf-packing 1 task']), detail: JSON.stringify(names) }
    })
    await h.assert('2: the focus is on the first label and the button says the bar is open', async () => ({
      ok: (await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))) === 'plf-booking 2 tasks'
        && (await button.getAttribute('aria-expanded')) === 'true',
    }))

    // --- 3. One label ------------------------------------------------------------------------------------
    await pill('plf-errand').click()
    await waitFor(async () => same(await rowTitles(), ['PLF Buy adapter']))
    await h.assert('3: one label shows only its tasks', async () => ({ ok: same(await rowTitles(), ['PLF Buy adapter']), detail: JSON.stringify(await rowTitles()) }))
    await h.assert('3: the section without such a task is not drawn', async () => ({ ok: !(await mainText()).includes('PLF Bookings') }))
    await h.assert('3: the line under the list says how many are left out', async () => ({
      ok: (await more.innerText()).includes('4 more tasks in this project'),
      detail: await more.innerText().catch(() => 'none'),
    }))
    await h.assert('3: the pill is pressed and Clear is offered', async () => ({
      ok: (await pill('plf-errand').getAttribute('aria-pressed')) === 'true' && (await bar.getByRole('button', { name: 'Clear' }).count()) === 1,
    }))
    await h.capture('one-label', { clip: page.locator('main') })

    // --- 4. Two labels ------------------------------------------------------------------------------------
    await pill('plf-booking').click()
    const two = ['PLF Book flights', 'PLF Buy adapter', 'PLF Reserve hotel']
    await waitFor(async () => same(await rowTitles(), two))
    await h.assert('4: a second label adds its tasks, the section comes back', async () => ({
      ok: same(await rowTitles(), two) && (await mainText()).includes('PLF Bookings') && (await more.innerText()).includes('2 more tasks'),
      detail: JSON.stringify(await rowTitles()),
    }))

    // --- 9. axe ---------------------------------------------------------------------------------------------
    const barAxe = await h.axe('[data-project-label-bar]', { label: 'the label filter bar' })
    await h.assert('9: axe finds no serious or critical violation in the bar', { ok: noSerious(barAxe).length === 0, detail: barAxe.map((v) => v.id).join(', ') })

    // --- 5. Escape ------------------------------------------------------------------------------------------
    await pill('plf-booking').focus()
    await page.keyboard.press('Escape')
    await waitFor(async () => (await bar.count()) === 0)
    await h.assert('5: Escape closes the bar and puts the focus back on the button, which keeps the count', async () => ({
      ok: (await bar.count()) === 0
        && (await page.evaluate(() => document.activeElement?.hasAttribute('data-project-label-filter')))
        && (await button.getAttribute('aria-label')) === 'Filter by label, 2 picked'
        && (await button.innerText()).trim() === '2'
        && same(await rowTitles(), two),
      detail: await button.getAttribute('aria-label'),
    }))
    // The rows move up into the bar's place (list motion) before the capture.
    await h.wait(900)
    await h.capture('closed-with-filter', { clip: page.locator('main') })

    // --- 6. Show all -----------------------------------------------------------------------------------------
    await more.getByRole('button', { name: 'Show all' }).click()
    await waitFor(async () => same(await rowTitles(), everything))
    await h.assert('6: Show all brings every task back and the count goes', async () => ({
      ok: same(await rowTitles(), everything) && (await button.getAttribute('aria-label')) === 'Filter by label' && (await more.count()) === 0,
    }))

    // --- 7. Leaving forgets it ------------------------------------------------------------------------------
    await button.click()
    await waitFor(async () => (await bar.count()) === 1)
    await pill('plf-packing').click()
    await waitFor(async () => same(await rowTitles(), ['PLF Pack camera']))
    await h.goto(`/project/${plain.id}`)
    await waitFor(async () => (await mainText()).includes('PLF Plain task'))

    // --- 8. No labels, no button --------------------------------------------------------------------------------
    await h.assert('8: a project whose tasks carry no label has no filter button', async () => ({ ok: (await button.count()) === 0 }))

    await h.goto(`/project/${trip.id}`)
    await waitFor(async () => same(await rowTitles(), everything))
    await h.assert('7: back on the project every task shows and the bar is closed', async () => ({
      ok: same(await rowTitles(), everything) && (await bar.count()) === 0 && (await button.getAttribute('aria-label')) === 'Filter by label',
      detail: JSON.stringify(await rowTitles()),
    }))
  } finally {
    await cleanStale()
  }
}
