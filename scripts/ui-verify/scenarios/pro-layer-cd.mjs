// PROCD (cross-app semantics 21.9 to 21.11, 3.8): meetings, the portfolio and the power layer in
// the running app.
//
//   A. An initiative in the ledger shows on Portfolio; parking it takes its task off Today, starting
//      it again brings the task back. Quarterly impact opens.
//   B. A Pro list (flagged, grouped by project, rows show project and estimate) groups its rows and
//      shows the estimate; Table shows the columns.
//   C. The list editor offers the starters; Quick wins fills the name.
//   D. Two selected rows, Mod+I: the inspector flags both on the server.
//   E. The weekly review shows the execution steps and the mirror; the sponsor desk and a meeting
//      page load, and a round starts.
//
// Its own throwaway label, project, tasks, list and ledger records; removed at the end, Pro off again.

export const meta = {
  id: 'PROCD',
  wave: 7,
  title: 'Pro layers C and D: portfolio, parking, lists, table, inspector, weekly, sponsor, meeting',
}

const pad = (n) => String(n).padStart(2, '0')
const todayAt = () => {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59).toISOString()
}

export default async function run(h) {
  const page = h.page
  await h.resize(1400, 900)
  await h.dismiss()

  const items = (value) => (Array.isArray(value) ? value : value?.items ?? [])
  const cleanProjects = async () => {
    for (const project of items(await h.api('GET', '/projects?per_page=200').catch(() => []))) {
      if (String(project.title).startsWith('PROCD')) await h.api('DELETE', `/projects/${project.id}`).catch(() => {})
    }
  }
  await cleanProjects()
  for (const stale of items(await h.api('GET', '/labels?per_page=200'))) {
    if (stale.title === 'Kim Probe') await h.api('DELETE', `/labels/${stale.id}`).catch(() => {})
  }

  const ledger = async () => (await page.evaluate(() => window.api.getProLedger())).ledger
  const mutate = (operations) => page.evaluate((ops) => window.api.mutateProLedger(ops), operations)
  const listId = 'procd-list'
  const meetingId = 'procd-meeting'
  let project = null
  let label = null
  const tasks = []

  try {
    label = await h.api('POST', '/labels', { title: 'Kim Probe' })
    project = await h.api('POST', '/projects', { title: 'PROCD Launch' })
    for (const title of ['PROCD write brief', 'PROCD book venue']) {
      tasks.push(await h.api('POST', `/projects/${project.id}/tasks`, { title, due_date: todayAt(), is_favorite: true }))
    }
    await page.evaluate(() => window.api.saveConfigPatch({ pro_enabled: true, pro_onboarding_seen: true, pro_list_views: {} }))
    await page.evaluate((id) => window.api.setSyncedPreferences({ [`label_kind.${id}`]: 'person' }), label.id)
    await mutate([
      { op: 'set', collection: 'initiatives', id: String(project.id), value: { status: 'active', rank: 1 } },
      { op: 'set', collection: 'meetings', id: meetingId, value: { name: 'PROCD weekly', people: [label.id] } },
      { op: 'estimate', taskId: tasks[0].id, minutes: 30 },
    ])
    await page.evaluate((list) => window.api.upsertCustomList(list), {
      id: listId,
      name: 'PROCD flagged',
      icon: 'flag',
      filter: { project_ids: [], add_to_project_id: 0, sort_by: 'due_date', order_by: 'asc', due_date_filter: 'all', flagged: true, group_by: 'project', row_fields: ['project', 'estimate'] },
    })
    await page.reload()
    await h.wait(1500)
    await page.keyboard.press('F5')
    await h.wait(1200)

    // --- A. Portfolio and parking --------------------------------------------------------------
    await h.goto('/portfolio')
    await h.wait(800)
    await h.assert('A: the initiative is on Portfolio', (await page.locator(`[data-pro-initiative="${project.id}"]`).count()) === 1)
    await h.capture('portfolio')
    await h.goto('/today')
    await h.wait(800)
    const onToday = () => page.getByText('PROCD write brief', { exact: true }).count()
    await h.assert('A: its task is on Today', (await onToday()) > 0)
    await mutate([{ op: 'set', collection: 'initiatives', id: String(project.id), value: { status: 'parked', rank: 1, parked: { on: '2026-11-12', reason: 'Probe' } } }])
    await h.wait(800)
    await h.assert('A: parked, its task leaves Today', (await onToday()) === 0)
    await mutate([{ op: 'set', collection: 'initiatives', id: String(project.id), value: { status: 'active', rank: 1 } }])
    await h.wait(800)
    await h.assert('A: started again, the task is back', (await onToday()) > 0)
    await h.goto('/portfolio')
    await h.wait(600)
    await page.getByRole('button', { name: 'Quarterly impact' }).click()
    await h.wait(500)
    await h.assert('A: the impact summary opens', (await page.locator('[data-pro-impact]').count()) === 1)
    await h.capture('impact')
    await page.keyboard.press('Escape')
    await h.wait(300)

    // --- B. A Pro list ---------------------------------------------------------------------------
    await h.goto(`/list/${listId}`)
    await h.wait(1000)
    await h.assert('B: the rows are grouped by project', (await page.locator(`[data-list-group="project:${project.id}"]`).count()) === 1)
    await h.assert('B: the row shows the estimate', (await page.locator('[data-row-estimate]').count()) >= 1)
    await h.capture('list-grouped')
    await page.getByRole('radio', { name: 'Table' }).click()
    await h.wait(500)
    await h.assert('B: Table shows the two tasks', (await page.locator('[data-table-task-id]').count()) === 2)
    await h.capture('list-table')
    await page.getByRole('radio', { name: 'Rows' }).click()
    await h.wait(500)

    // --- C. Starters --------------------------------------------------------------------------------
    await page.getByRole('button', { name: 'New list' }).first().click()
    await h.wait(500)
    await h.assert('C: the editor offers starters', (await page.locator('[data-pro-list-starters]').count()) === 1)
    await page.locator('[data-pro-list-starters]').getByRole('button', { name: 'Quick wins' }).click()
    await h.wait(300)
    await h.assert('C: Quick wins fills the name', (await page.getByLabel('Name', { exact: true }).inputValue()) === 'Quick wins')
    await h.assert('C: the Pro section and preview show', (await page.locator('[data-pro-list-preview]').count()) === 1)
    await h.capture('list-editor')
    await page.keyboard.press('Escape')
    await h.wait(400)

    // --- D. Inspector -------------------------------------------------------------------------------
    await mutate([])
    const rows = page.locator('[data-task-id]')
    await rows.nth(0).click({ modifiers: ['Control'] })
    await rows.nth(1).click({ modifiers: ['Control'] })
    await h.wait(300)
    await page.keyboard.press('Control+i')
    await h.wait(500)
    await h.assert('D: Mod+I opens the inspector', (await page.locator('[data-pro-inspector]').count()) === 1)
    await h.capture('inspector')
    await page.locator('[data-pro-inspector]').getByRole('button', { name: '15m' }).click()
    let estimated = false
    for (let i = 0; i < 30 && !estimated; i++) {
      const current = await ledger()
      estimated = tasks.every((task) => current.estimates[String(task.id)]?.[0] === 15)
      if (!estimated) await h.wait(200)
    }
    await h.assert('D: the inspector sets both estimates', estimated)
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await h.wait(300)

    // --- E. Weekly review, sponsor desk, meeting ---------------------------------------------------
    await h.goto('/weekly-review')
    await h.wait(1500)
    await h.assert('E: the weekly review has the execution steps', (await page.locator('[data-pro-weekly-step]').count()) >= 3)
    await h.assert('E: and the mirror', (await page.locator('[data-pro-mirror]').count()) === 1)
    await h.capture('weekly')
    await h.goto('/sponsor')
    await h.wait(800)
    await h.assert('E: the sponsor desk loads', (await page.locator('[data-pro-escalations]').count()) === 1)
    await h.goto(`/meeting/${meetingId}`)
    await h.wait(800)
    await page.locator('[data-pro-meeting-start]').click()
    await h.wait(500)
    await h.assert('E: a round starts with the person', (await page.locator(`[data-pro-meeting-card="${label.id}"]`).count()) === 1)
    await h.capture('meeting')
    await h.axe('main', { label: 'meeting' })
  } finally {
    await page.evaluate((id) => window.api.deleteCustomList(id), listId).catch(() => {})
    await mutate([
      ...(project ? [{ op: 'set', collection: 'initiatives', id: String(project.id), value: null }] : []),
      { op: 'set', collection: 'meetings', id: meetingId, value: null },
      ...tasks.map((task) => ({ op: 'estimate', taskId: task.id, minutes: null })),
    ]).catch(() => {})
    await cleanProjects()
    if (label) {
      await page.evaluate((id) => window.api.setSyncedPreferences({ [`label_kind.${id}`]: null }), label.id).catch(() => {})
      await h.api('DELETE', `/labels/${label.id}`).catch(() => {})
    }
    await page.evaluate(() => {
      try {
        localStorage.removeItem('vicu-pro-list-table')
        for (const key of Object.keys(localStorage)) if (key.startsWith('vicu-pro-round:')) localStorage.removeItem(key)
      } catch {}
    }).catch(() => {})
    await page.evaluate(() => window.api.saveConfigPatch({ pro_enabled: false, pro_list_views: {} })).catch(() => {})
  }
}
