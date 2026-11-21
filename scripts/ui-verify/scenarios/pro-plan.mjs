// PROPL (cross-app semantics 21.20): a 90-day plan in the running app.
//
//   A. A project without a plan says so; "Make this a 90-day plan" opens the dialog. A first day
//      three weeks back moves the last day 90 days after it; with a group, Save writes the synced
//      setting and the view says "Week 4 of 13".
//   B. The view counts from tasks and verdicts made through the API: an item with three milestones
//      (one delivered in week 1, one whose date moved in week 2 and is now overdue, one ahead) and an
//      item of its own. Totals, the item's owner and count, and the cells in words.
//   C. "Add milestone" with a person and a date: a subtask of the item, with the group's label and
//      that person's promise to the group.
//   D. The plan is linked from the project page, the project's menu and the group's page.
//   E. Close plan with carry-over: a new project that is the next plan; the open items and milestones
//      move, the delivered milestone stays behind as an item, the old plan is closed.
//
// Throwaway people, labels and projects ("... Proplx"), tasks titled PROPLX; all removed at the end.

import { kit, list, isoDay, dueAt } from './_pro-groups.mjs'

export const meta = {
  id: 'PROPL',
  wave: 9,
  title: 'Pro: a 90-day plan, its view, milestones, and closing with carry-over',
}

const noonAt = (offset) => {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset, 12, 0, 0).toISOString()
}

export default async function run(h) {
  const page = h.page
  await h.resize(1500, 900)
  await h.dismiss()
  const k = kit(h, 'PROPLX')
  const match = (title) => title.includes('Proplx')
  const projects = async () => list(await h.api('GET', '/projects?per_page=200').catch(() => [])).filter((p) => match(String(p.title)))
  const removeProjects = async () => {
    const found = await projects()
    const keys = {}
    for (const project of found) keys[`project_plan.${project.id}`] = null
    if (found.length) await page.evaluate((v) => window.api.setSyncedPreferences(v), keys).catch(() => {})
    for (const project of found) await h.api('DELETE', `/projects/${project.id}`).catch(() => {})
  }
  await removeProjects()
  await k.cleanup({ match })

  try {
    const jan = await k.makePerson('Jan Proplx')
    const team = await k.makeLabel('Team Proplx')
    await k.makeGroup({ name: 'Team Proplx', label: team, people: [jan] })
    const project = await h.api('POST', '/projects', { title: 'Rollout Proplx' })
    const task = async (title, { parent = null, due = null, done = false } = {}) => {
      const made = await h.api('POST', `/projects/${project.id}/tasks`, { title, ...(due === null ? {} : { due_date: dueAt(due) }) })
      if (parent) await h.api('POST', `/tasks/${parent.id}/relations`, { other_task_id: made.id, relation_kind: 'subtask' })
      if (done) await h.api('PATCH', `/tasks/${made.id}`, { done: true })
      return made
    }
    const pilot = await task('PROPLX Pilot region')
    const m1 = await task('PROPLX shortlist', { parent: pilot, due: -16, done: true })
    const m2 = await task('PROPLX site visits', { parent: pilot, due: -3 })
    const m3 = await task('PROPLX sign off', { parent: pilot, due: 10 })
    const cost = await task('PROPLX Cost model', { due: 5 })
    await k.mutate([
      { op: 'set', collection: 'promises', id: String(m1.id), value: { dir: 'theirs', person: jan.id, to: { group: team.id }, verdicts: [{ id: 'v1proplx', kind: 'delivered', at: noonAt(-16) }] } },
      { op: 'set', collection: 'promises', id: String(m2.id), value: { dir: 'theirs', person: jan.id, to: { group: team.id }, verdicts: [{ id: 'v2proplx', kind: 'renegotiated', at: noonAt(-9), new_due: isoDay(-3) }] } },
      { op: 'set', collection: 'promises', id: String(m3.id), value: { dir: 'theirs', person: jan.id, to: { group: team.id } } },
    ])
    await k.start()

    // --- A. The dialog ------------------------------------------------------------------------------
    await h.goto(`/project-plan/${project.id}`)
    await page.locator('[data-pro-plan-none]').waitFor({ timeout: 8000 })
    await k.check('A: a project without a plan says so', (await page.locator('[data-pro-plan-none]').count()) === 1)
    await page.locator('[data-pro-plan-make]').click()
    await page.locator('[data-pro-plan-start]').waitFor({ timeout: 5000 })
    await k.check('A: a new plan starts today and ends 90 days later', (await page.locator('[data-pro-plan-start]').inputValue()) === isoDay(0) && (await page.locator('[data-pro-plan-end]').inputValue()) === isoDay(90))
    await page.locator('[data-pro-plan-start]').fill(isoDay(-21))
    await k.check('A: the last day follows the first', (await page.locator('[data-pro-plan-end]').inputValue()) === isoDay(69), await page.locator('[data-pro-plan-end]').inputValue())
    await page.locator('[data-pro-plan-group]').selectOption(String(team.id))
    await h.capture('plan-dialog')
    await page.locator('[data-pro-plan-save]').click()
    const stored = await k.waitFor(async () => (await k.prefs())[`project_plan.${project.id}`] ?? null)
    await k.check('A: the synced setting holds the two days and the group', stored?.start === isoDay(-21) && stored?.end === isoDay(69) && stored?.group === team.id && !stored?.closed, JSON.stringify(stored))
    await page.locator('[data-pro-plan-table]').waitFor({ timeout: 8000 })
    await k.check('A: the view says which week it is', ((await page.locator('[data-pro-plan-phase]').textContent()) ?? '').includes('Week 4 of 13'), await page.locator('[data-pro-plan-phase]').textContent())

    // --- B. The view ----------------------------------------------------------------------------------
    const totals = (await page.locator('[data-pro-plan-totals]').textContent()) ?? ''
    await k.check('B: the totals count 1 of 4 delivered and 1 overdue', totals.includes('1 of 4 delivered') && totals.includes('1 overdue'), totals)
    const row = page.locator(`[data-pro-plan-item="${pilot.id}"]`)
    await k.check('B: the item shows 1 of 3', ((await row.locator('[data-pro-plan-count]').textContent()) ?? '').trim() === '1 of 3')
    await k.check('B: the item shows the owner its milestones share', ((await row.locator('[data-pro-plan-owner]').textContent()) ?? '').includes('Jan Proplx'))
    await k.check('B: the item without subtasks is its own milestone', ((await page.locator(`[data-pro-plan-item="${cost.id}"] [data-pro-plan-count]`).textContent()) ?? '').trim() === '0 of 1')
    const cellText = async (item, week) => ((await page.locator(`[data-pro-plan-cell="${item}:${week}"] .sr-only`).textContent().catch(() => '')) ?? '').trim()
    await k.check('B: week 1 says 1 due, 1 delivered', (await cellText(pilot.id, 0)) === '1 due, 1 delivered', await cellText(pilot.id, 0))
    await k.check('B: week 2 says a date moved', (await cellText(pilot.id, 1)) === '1 date moved', await cellText(pilot.id, 1))
    await k.check('B: week 3 holds the moved milestone as due', (await cellText(pilot.id, 2)) === '1 due', await cellText(pilot.id, 2))
    await k.check('B: week 5 holds the milestone ahead', (await cellText(pilot.id, 4)) === '1 due', await cellText(pilot.id, 4))
    await k.check('B: this week is marked for a screen reader', (await page.locator('[data-pro-plan-week="4"][aria-current]').count()) === 1)
    await k.check('B: the table has 13 week columns', (await page.locator('[data-pro-plan-week]').count()) === 13)
    const scroll = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)
    await k.check('B: the page itself does not scroll sideways', scroll)
    await h.capture('plan-view')

    // --- C. Add a milestone -----------------------------------------------------------------------------
    await page.locator(`[data-pro-plan-expand="${pilot.id}"]`).click()
    await page.locator(`[data-pro-plan-milestones="${pilot.id}"]`).waitFor({ timeout: 5000 })
    await k.check('C: the open item lists its three milestones', (await page.locator(`[data-pro-plan-milestones="${pilot.id}"] [data-task-id]`).count()) >= 4)
    await page.locator(`[data-pro-plan-add-milestone="${pilot.id}"]`).click()
    await h.wait(300)
    await page.keyboard.type('$"Jan Proplx" PROPLX kick-off in 20 days', { delay: 12 })
    await h.wait(350)
    await page.keyboard.press('Enter')
    await h.wait(500)
    await page.keyboard.press('Escape')
    const added = await k.waitTask('PROPLX kick-off')
    await k.check('C: the milestone is a task on the server', !!added)
    if (added) {
      const full = await k.waitFor(async () => {
        const t = await h.api('GET', `/tasks/${added.id}`)
        return (t.related_tasks?.parenttask ?? []).some((p) => p.id === pilot.id) ? t : null
      })
      await k.check('C: it is a subtask of the item', !!full)
      await k.check('C: it is in the plan project', (full ?? added).project_id === project.id)
      await k.check("C: it carries the group's label", !!(await k.waitFor(async () => ((await h.api('GET', `/tasks/${added.id}`)).labels ?? []).some((l) => l.id === team.id))))
      const promise = await k.promiseOf(added.id)
      await k.check("C: it is Jan's promise to the group", promise?.dir === 'theirs' && promise?.person === jan.id && promise?.to?.group === team.id, JSON.stringify(promise))
      await k.check('C: the item counts it', !!(await k.waitFor(async () => ((await row.locator('[data-pro-plan-count]').textContent()) ?? '').trim() === '1 of 4')), await row.locator('[data-pro-plan-count]').textContent())
    }
    await h.capture('plan-item-open')
    await h.axe()

    // --- D. Ways in -------------------------------------------------------------------------------------
    await h.goto(`/project/${project.id}`)
    await h.wait(1000)
    const link = page.locator(`[data-pro-plan-link="${project.id}"]`)
    await k.check('D: the project page links to the plan with its week', ((await link.textContent().catch(() => '')) ?? '').includes('week 4 of 13'), await link.textContent().catch(() => ''))
    await h.goto(`/group/${team.id}`)
    await h.wait(1200)
    const groupRow = page.locator(`[data-pro-group-plans] [data-pro-group-plan="${project.id}"]`)
    await k.check("D: the group's page lists the plan", (await groupRow.count()) === 1)
    await k.check('D: with what it delivered', ((await groupRow.textContent().catch(() => '')) ?? '').includes('1 of 5 delivered'), await groupRow.textContent().catch(() => ''))
    await h.capture('group-plans')
    await groupRow.click()
    await page.locator('[data-pro-plan-table]').waitFor({ timeout: 8000 })
    await k.check('D: the row opens the plan', page.url().includes(`/project-plan/${project.id}`), page.url())

    // --- E. Close with carry-over -------------------------------------------------------------------------
    await page.locator('[data-pro-plan-close]').click()
    await page.locator('[data-pro-plan-close-confirm]').waitFor({ timeout: 5000 })
    const counts = (await page.locator('[data-pro-plan-close-counts]').textContent()) ?? ''
    await k.check('E: the dialog counts 1 delivered and 4 open', counts.includes('1 delivered') && counts.includes('4 open'), counts)
    await page.locator('[data-pro-plan-next-name]').fill('Rollout next Proplx')
    await h.capture('plan-close')
    await page.locator('[data-pro-plan-close-confirm]').click()
    const next = await k.waitFor(async () => (await projects()).find((p) => p.title === 'Rollout next Proplx') ?? null, 60, 300)
    await k.check('E: the new project exists on the server', !!next)
    if (next) {
      const after = await k.waitFor(async () => {
        const values = await k.prefs()
        return values[`project_plan.${next.id}`] && values[`project_plan.${project.id}`]?.closed ? values : null
      }, 60, 300)
      const oldPlan = after?.[`project_plan.${project.id}`]
      const newPlan = after?.[`project_plan.${next.id}`]
      await k.check('E: the old plan is closed today', oldPlan?.closed === isoDay(0), JSON.stringify(oldPlan))
      await k.check('E: the new plan carries on from it, for the same group, the day after it ended', newPlan?.from === project.id && newPlan?.group === team.id && newPlan?.start === isoDay(70) && newPlan?.end === isoDay(160), JSON.stringify(newPlan))
      const where = async (id) => (await h.api('GET', `/tasks/${id}`)).project_id
      const moved = await k.waitFor(async () => {
        for (const t of [pilot, m2, m3, cost, ...(added ? [added] : [])]) if ((await where(t.id)) !== next.id) return false
        return true
      }, 40, 300)
      await k.check('E: the open items and milestones moved to the new project', !!moved)
      await k.check('E: the delivered milestone stayed behind', (await where(m1.id)) === project.id)
      await k.check('E: its promise went nowhere', (await k.ledger()).promises[String(m2.id)]?.value?.person === jan.id)
      await k.waitFor(() => page.url().includes(`/project-plan/${next.id}`))
      await k.check('E: the new plan opened', page.url().includes(`/project-plan/${next.id}`), page.url())
      await page.locator('[data-pro-plan-table]').waitFor({ timeout: 8000 }).catch(() => {})
      await k.check('E: it says where it came from', (await page.locator('[data-pro-plan-from]').count()) === 1)
      await k.check('E: it starts later', ((await page.locator('[data-pro-plan-phase]').textContent().catch(() => '')) ?? '').startsWith('Starts'), await page.locator('[data-pro-plan-phase]').textContent().catch(() => ''))
      await h.capture('plan-next')
      await h.goto(`/project-plan/${project.id}`)
      await page.locator('[data-pro-plan-phase]').waitFor({ timeout: 8000 })
      await h.wait(800)
      await k.check('E: the closed plan says so', ((await page.locator('[data-pro-plan-phase]').textContent()) ?? '').startsWith('Closed'))
      await k.check('E: it still shows what it delivered, as an item', (await page.locator(`[data-pro-plan-item="${m1.id}"]`).count()) === 1)
      await k.check('E: it links to the plan that carries on', (await page.locator('[data-pro-plan-follow-on]').count()) === 1)
      await h.capture('plan-closed')
    }
  } finally {
    await removeProjects()
    await k.cleanup({ match })
  }
}
