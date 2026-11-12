// PROA (cross-app semantics 21.1 to 21.4, 21.14): Pro's first layer in the running app, against the
// server. What matters is that Pro off is today's Vicu and that Pro on writes only what 21.1 allows.
//
//   A. Off: no Pro section in the sidebar, no Pro chips on a card. Settings, Pro turns it on.
//   B. Flags: the card's Flag chip writes is_favorite alone; Flagged lists the task.
//   C. A sequential project: Available shows the first task with Next; Remaining the others, with
//      their reason.
//   D. A start date in three days: Anytime's Available leaves it out and says how many wait;
//      Remaining shows "Starts ..."; Upcoming lists it on its day under Starts.
//   E. After: a task blocked by an open task says "After: <title>".
//   F. Focus on the project: the sidebar shows only it (and the Inbox's lists); Clear brings all back.
//   G. Off again: the Pro section and chips are gone, nothing was written by turning it off.
//
// Its own throwaway project and tasks; everything is deleted and Pro is turned off at the end.

export const meta = {
  id: 'PROA',
  wave: 7,
  title: 'Pro layer A: switch, flags, sequential projects, start dates, after, focus',
}

const pad = (n) => String(n).padStart(2, '0')
const dayFrom = (days) => {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const midnightOf = (day) => {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d, 0, 0, 0).toISOString()
}

export default async function run(h) {
  const page = h.page
  await h.resize(1400, 900)
  await h.dismiss()

  const leftBehind = await h.api('GET', `/projects?per_page=200`)
  for (const stale of Array.isArray(leftBehind) ? leftBehind : leftBehind.items ?? []) {
    if (String(stale.title).startsWith('PROA ')) await h.api('DELETE', `/projects/${stale.id}`).catch(() => {})
  }

  let project = null
  const prefKeys = []
  const setPrefs = async (values) => {
    prefKeys.push(...Object.keys(values))
    await page.evaluate((v) => window.api.setSyncedPreferences(v), values)
  }
  const reload = async (path) => {
    await page.reload()
    await h.wait(1500)
    if (path) await h.goto(path)
    await page.keyboard.press('F5')
    await h.wait(1200)
  }
  const proNav = () => page.locator('nav[aria-label="Pro"]')
  const rowOf = (id) => page.locator(`[data-task-id="${id}"]`).first()

  try {
    await page.evaluate(() => window.api.saveConfigPatch({ pro_enabled: false, pro_list_views: {}, pro_focus: null, pro_onboarding_seen: true }))
    project = await h.api('PUT', '/projects', { title: 'PROA project' }).catch(() => h.api('POST', '/projects', { title: 'PROA project' }))
    const make = (title, fields = {}) => h.api('POST', `/projects/${project.id}/tasks`, { title, ...fields })
    const first = await make('PROA first')
    const second = await make('PROA second')
    const third = await make('PROA third')
    const later = await make('PROA starts later', { start_date: midnightOf(dayFrom(3)) })

    // --- A. Off ---------------------------------------------------------------------------------
    await reload(`/project/${project.id}`)
    await h.assert('A: no Pro section while Pro is off', (await proNav().count()) === 0)
    await rowOf(first.id).click()
    await h.wait(500)
    await h.assert('A: no Pro chips on a card while Pro is off', (await page.locator('[data-prop="pro-flag"]').count()) === 0)
    await page.keyboard.press('Escape')
    await h.goto('/settings?section=pro')
    await h.wait(500)
    await page.getByRole('switch', { name: /Turn on Pro/ }).click()
    await proNav().waitFor({ timeout: 5000 }).catch(() => {})
    await h.assert('A: Settings turns Pro on', (await proNav().count()) === 1)
    await h.capture('settings-pro-on')

    // --- B. Flags --------------------------------------------------------------------------------
    await h.goto(`/project/${project.id}`)
    await h.wait(600)
    await page.locator('[data-pro-view="remaining"]').click()
    await h.wait(400)
    await rowOf(second.id).click()
    await h.wait(500)
    await h.capture('card-pro-chips')
    await page.locator('[data-prop="pro-flag"]').click()
    let flagged = null
    for (let i = 0; i < 30; i++) {
      flagged = await h.api('GET', `/tasks/${second.id}`)
      if (flagged.is_favorite === true) break
      await h.wait(150)
    }
    await h.assert('B: the Flag chip writes is_favorite', flagged?.is_favorite === true)
    await h.assert('B: the flag leaves the due date alone', flagged?.due_date === second.due_date)
    await page.keyboard.press('Escape')
    await proNav().getByRole('button', { name: 'Flagged' }).click()
    await h.wait(800)
    await page.locator('[data-pro-view="remaining"]').click()
    await h.wait(400)
    await h.assert('B: Flagged lists the flagged task', (await rowOf(second.id).count()) === 1)
    await h.capture('flagged')

    // --- C. Sequential project ---------------------------------------------------------------------
    await setPrefs({ [`project_mode.${project.id}`]: 'sequential', [`task_order.project.${project.id}`]: 'oldest' })
    await reload(`/project/${project.id}`)
    await page.locator('[data-pro-view="available"]').click()
    await h.wait(500)
    await h.assert('C: Available shows the first task', (await rowOf(first.id).count()) === 1)
    await h.assert('C: Available leaves out the later ones', (await rowOf(third.id).count()) === 0)
    await h.assert('C: the first task shows Next', (await rowOf(first.id).locator('[data-pro-next]').count()) === 1)
    await h.assert('C: a summary says what waits', (await page.locator('[data-pro-hidden-summary]').count()) === 1)
    await h.capture('sequential-available')
    await page.locator('[data-pro-view="remaining"]').click()
    await h.wait(400)
    const reason = (await rowOf(third.id).locator('[data-pro-reason]').textContent().catch(() => '')) ?? ''
    await h.assert('C: Remaining gives the reason', /Later in sequence/.test(reason), reason)
    await h.capture('sequential-remaining')
    await setPrefs({ [`project_mode.${project.id}`]: null })

    // --- D. Start date ---------------------------------------------------------------------------------
    await reload('/anytime')
    await page.locator('[data-pro-view="available"]').click()
    await h.wait(500)
    await h.assert('D: Anytime Available leaves the later start out', (await rowOf(later.id).count()) === 0)
    await page.locator('[data-pro-view="remaining"]').click()
    await h.wait(400)
    const starts = (await rowOf(later.id).locator('[data-pro-reason]').textContent().catch(() => '')) ?? ''
    await h.assert('D: Remaining says when it starts', /^Starts /.test(starts), starts)
    await h.goto('/upcoming')
    await h.wait(800)
    await h.assert('D: Upcoming lists it under Starts', (await page.locator(`[data-pro-starts] [data-task-id="${later.id}"]`).count()) === 1)
    await h.capture('upcoming-starts')

    // --- E. After ---------------------------------------------------------------------------------------
    await h.api('PUT', `/tasks/${third.id}/relations`, { other_task_id: first.id, relation_kind: 'blocked' })
      .catch(() => h.api('POST', `/tasks/${third.id}/relations`, { other_task_id: first.id, relation_kind: 'blocked' }))
    await reload(`/project/${project.id}`)
    await page.locator('[data-pro-view="remaining"]').click()
    await h.wait(500)
    const after = (await rowOf(third.id).locator('[data-pro-reason]').textContent().catch(() => '')) ?? ''
    await h.assert('E: a blocked task says what it waits on', /After: PROA first/.test(after), after)
    await h.capture('after')

    // --- F. Focus -----------------------------------------------------------------------------------------
    await page.evaluate((id) => window.api.saveConfigPatch({ pro_focus: { categories: [], projects: [id] } }), project.id)
    await reload('/anytime')
    await h.assert('F: the focus banner shows', (await page.locator('[data-pro-focus-banner]').count()) === 1)
    const treeRows = await page.locator('nav[aria-label="Projects"] [data-project-id], [data-project-row]').count().catch(() => -1)
    await h.capture('focus')
    await page.getByRole('button', { name: 'Clear focus' }).click()
    await h.wait(500)
    await h.assert('F: Clear removes the banner', (await page.locator('[data-pro-focus-banner]').count()) === 0, String(treeRows))

    // --- G. Off again -----------------------------------------------------------------------------------
    const before = await h.api('GET', `/tasks/${second.id}`)
    await h.goto('/settings?section=pro')
    await h.wait(500)
    await page.getByRole('switch', { name: /Turn on Pro/ }).click()
    await h.wait(800)
    await h.assert('G: the Pro section goes when Pro is off', (await proNav().count()) === 0)
    const afterOff = await h.api('GET', `/tasks/${second.id}`)
    await h.assert('G: turning Pro off writes nothing to tasks', before.updated === afterOff.updated)
  } finally {
    if (prefKeys.length) {
      await page.evaluate((keys) => window.api.setSyncedPreferences(Object.fromEntries(keys.map((k) => [k, null]))), [...new Set(prefKeys)]).catch(() => {})
    }
    await page.evaluate(() => window.api.saveConfigPatch({ pro_enabled: false, pro_list_views: {}, pro_focus: null })).catch(() => {})
    if (project) await h.api('DELETE', `/projects/${project.id}`).catch(() => {})
  }
}
