// PCR (cross-app semantics 12.6, Vicu-Mobile#114): a project's Completed row in the running app.
// Throwaway project "PCR Garden" with the subproject "PCR Beds" and tasks titled "PCR ...", and the
// synced setting `projects.show_done` turned on for the run (put back as it was afterwards).
//
//   1. The project ends with a folded "Completed" row with the count of its own done tasks.
//   2. Opened (a click), it lists them newest completion first, struck through, with the day.
//   3. Ticking a row reopens it: it leaves the Completed list for the open list, the count drops.
//   4. Enter on the row folds it again.  5. axe on the open Completed row.
// Removes everything it made.
export const meta = {
  id: 'PCR',
  wave: 9,
  title: 'Project page: the Completed row at the end of the list',
}

const list = (value) => (Array.isArray(value) ? value : (value?.items ?? []))
const PROJECTS = ['PCR Garden', 'PCR Beds']

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
  const waitFor = async (fn, tries = 40, gap = 250) => {
    for (let i = 0; i < tries; i++) {
      const value = await fn()
      if (value) return value
      await h.wait(gap)
    }
    return null
  }
  const noSerious = (violations) => violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')

  const cleanStale = async () => {
    for (const task of list(await h.api('GET', '/tasks?q=PCR&per_page=200').catch(() => []))) {
      if (String(task.title).startsWith('PCR ')) await h.api('DELETE', `/tasks/${task.id}`).catch(() => {})
    }
    for (const project of list(await h.api('GET', '/projects?per_page=200').catch(() => [])).sort((a, b) => (b.parent_project_id ?? 0) - (a.parent_project_id ?? 0))) {
      if (PROJECTS.includes(project.title)) await h.api('DELETE', `/projects/${project.id}`).catch(() => {})
    }
  }
  await cleanStale()

  const before = await page.evaluate(async () => (await window.api.getSyncedPrefs())?.values?.['projects.show_done'] ?? null)
  const section = page.locator('[data-project-completed]')
  const toggle = section.locator('button[aria-expanded]').first()
  const doneRows = section.locator('[data-task-id]')
  const rowTitles = (locator) => locator.evaluateAll((els) => els.map((el) => el.querySelector('.vicu-strike')?.textContent ?? ''))

  try {
    // --- Setup ----------------------------------------------------------------------------------------
    const garden = await retry(() => h.api('POST', '/projects', { title: 'PCR Garden' }))
    const beds = await retry(() => h.api('POST', '/projects', { title: 'PCR Beds', parent_project_id: garden.id }))
    for (const title of ['PCR Water the roses', 'PCR Buy seeds']) await retry(() => h.api('POST', `/projects/${garden.id}/tasks`, { title }))
    // Completed one after the other, so the last one is the newest.
    for (const title of ['PCR Rake leaves', 'PCR Mow the lawn', 'PCR Trim the hedge']) {
      const task = await retry(() => h.api('POST', `/projects/${garden.id}/tasks`, { title }))
      await retry(() => h.api('PATCH', `/tasks/${task.id}`, { done: true }))
      await h.wait(1100)
    }
    const other = await retry(() => h.api('POST', `/projects/${beds.id}/tasks`, { title: 'PCR Weed the beds' }))
    await retry(() => h.api('PATCH', `/tasks/${other.id}`, { done: true }))

    await page.evaluate(() => window.api.setSyncedPreference('projects.show_done', true))
    await h.goto('/today')
    await h.wait(600)
    await page.keyboard.press('F5')
    await h.wait(1200)
    await h.goto(`/project/${garden.id}`)
    await waitFor(async () => (await section.count()) === 1 && /3$/.test((await toggle.innerText()).trim()))

    // --- 1. Folded ------------------------------------------------------------------------------------
    await h.assert('1: the list ends with a folded Completed row counting the project\'s own done tasks', async () => {
      const text = (await toggle.innerText()).replace(/\s+/g, ' ').trim()
      return {
        ok: text === 'Completed 3' && (await toggle.getAttribute('aria-expanded')) === 'false' && (await doneRows.count()) === 0,
        detail: text,
      }
    })
    await page.mouse.move(5, 5)
    await h.capture('folded', { clip: page.locator('main') })

    // --- 2. Open --------------------------------------------------------------------------------------
    await toggle.click()
    await waitFor(async () => (await doneRows.count()) === 3)
    await h.assert('2: open, the done tasks newest first, struck through, with the day they were completed', async () => {
      const titles = await rowTitles(doneRows)
      const struck = await section.locator('.vicu-strike').count()
      const days = await doneRows.evaluateAll((els) => els.map((el) => el.innerText))
      return {
        ok: JSON.stringify(titles) === JSON.stringify(['PCR Trim the hedge', 'PCR Mow the lawn', 'PCR Rake leaves'])
          && struck === 3 && days.every((text) => /Today/.test(text)) && (await toggle.getAttribute('aria-expanded')) === 'true',
        detail: JSON.stringify({ titles, struck, days }),
      }
    })
    await page.mouse.move(5, 5)
    await h.capture('open', { clip: page.locator('main') })

    // --- 3. Reopen ------------------------------------------------------------------------------------
    await doneRows.filter({ hasText: 'PCR Mow the lawn' }).getByRole('checkbox').click()
    await waitFor(async () => (await doneRows.count()) === 2)
    await h.assert('3: a ticked row is reopened and moves up into the open list', async () => {
      const titles = await rowTitles(doneRows)
      const openRow = page.locator('main [data-task-id]').filter({ hasText: 'PCR Mow the lawn' })
      const inOpenList = (await openRow.count()) === 1 && (await section.locator('[data-task-id]', { hasText: 'PCR Mow the lawn' }).count()) === 0
      const server = await h.api('GET', `/tasks?filter=${encodeURIComponent(`done = true && project = ${garden.id}`)}&per_page=50`)
      return {
        ok: JSON.stringify(titles) === JSON.stringify(['PCR Trim the hedge', 'PCR Rake leaves']) && inOpenList && list(server).length === 2,
        detail: JSON.stringify({ titles, inOpenList, server: list(server).map((t) => t.title) }),
      }
    })
    await h.assert('3b: the count follows', async () => {
      const ok = await waitFor(async () => /2$/.test((await toggle.innerText()).trim()))
      return { ok: !!ok, detail: (await toggle.innerText()).trim() }
    })

    // --- 4. Keyboard ----------------------------------------------------------------------------------
    await toggle.focus()
    await page.keyboard.press('Enter')
    await h.assert('4: Enter on the row folds it again', async () => ({
      ok: (await waitFor(async () => (await toggle.getAttribute('aria-expanded')) === 'false' && (await doneRows.count()) === 0)) !== null,
    }))

    // --- 5. axe ---------------------------------------------------------------------------------------
    await toggle.click()
    await waitFor(async () => (await doneRows.count()) === 2)
    const violations = noSerious(await h.axe('[data-project-completed]', { label: 'the Completed row' }))
    await h.assert('5: no serious axe findings with the Completed list open', async () => ({
      ok: violations.length === 0,
      detail: violations.map((v) => v.id).join(', '),
    }))
  } finally {
    await page.evaluate((value) => window.api.setSyncedPreference('projects.show_done', value === true ? true : null), before).catch(() => {})
    await cleanStale()
  }
}
