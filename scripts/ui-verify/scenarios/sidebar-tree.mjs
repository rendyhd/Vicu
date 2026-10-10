// sidebar-tree (card 3.9a, D-9): the sidebar project tree with progress rings.
//
//   A. A sidebar render makes at most "projects + 1" count requests (a page of one task whose
//      envelope carries the total), each project at most once, none of them for the Inbox. A second
//      render (page reload) inside the ten-minute cache window makes none. Counted through the
//      main-process request log (request-log.cjs), from the launch of the app.
//   B. The tree shows the child projects of the areas; a project with tasks shows a ring whose
//      label reads "X of Y done" and matches the server; Inbox and Today show their counts.
//   C. Collapsing an area hides its children, is saved in the config and survives a reload;
//      expanding brings them back. Keyboard: ArrowLeft / ArrowRight on a focused row.
//   D. Captures of the sidebar (expanded and collapsed).
//
// Run it alone for the cleanest count (--scenario sidebar-tree): the log covers everything since launch.
export const meta = {
  id: 'tree',
  wave: null,
  title: 'Sidebar tree: children shown, rings read X of Y done, counts on Inbox and Today, collapse saved, at most projects + 1 count requests',
}

const COUNT_REQUEST = /\/api\/v2\/projects\/(\d+)\/tasks\?(.*)/

/** The count requests in a request list: [{ projectId, done }]. */
function countRequests(list) {
  const out = []
  for (const r of list) {
    if (r.method !== 'GET') continue
    const m = COUNT_REQUEST.exec(r.url)
    if (!m) continue
    const q = new URLSearchParams(m[2])
    if (q.get('per_page') !== '1') continue
    out.push({ projectId: Number(m[1]), filter: q.get('filter') })
  }
  return out
}

const sidebar = (page) => page.locator('aside').first()

export default async function run(h) {
  const page = h.page
  await h.resize(1280, 820)
  await h.goto('/today')
  await h.wait(2500)
  await h.settle(page, 800)

  // --- A. Request count -------------------------------------------------------------------
  const projects = (await h.api('GET', '/projects?per_page=100')).items.filter((p) => !p.is_archived)
  const inboxId = h.ids.inbox
  const shown = projects.filter((p) => p.id !== inboxId)
  const sinceLaunch = countRequests(h.requests())
  const perProject = new Map()
  for (const r of sinceLaunch) perProject.set(r.projectId, (perProject.get(r.projectId) ?? 0) + 1)

  await h.assert(`at most projects + 1 count requests (${sinceLaunch.length} for ${shown.length} projects)`, {
    ok: sinceLaunch.length > 0 && sinceLaunch.length <= shown.length + 1,
    detail: `${sinceLaunch.length} requests, limit ${shown.length + 1}`,
  })
  await h.assert('each project is counted at most once, with done = true', {
    ok: [...perProject.values()].every((n) => n === 1) && sinceLaunch.every((r) => r.filter === 'done = true'),
    detail: JSON.stringify([...perProject.entries()]),
  })
  await h.assert('the Inbox is not counted', !perProject.has(inboxId))

  const before = h.requests().length
  await page.reload()
  await page.waitForLoadState('domcontentloaded')
  await h.wait(2500)
  await h.settle(page, 600)
  const again = countRequests(h.requests(before))
  await h.assert('a second render inside the cache window makes no count requests', { ok: again.length === 0, detail: `${again.length}` })

  // --- B. Tree, rings, counts -------------------------------------------------------------
  for (const [name, id] of [['Work', h.ids.work], ['Personal', h.ids.personal], ['Website redesign', h.ids.website], ['Q4 planning', h.ids.q4], ['Home renovation', h.ids.home], ['Trip to Lisbon', h.ids.lisbon]]) {
    await h.assert(`the tree lists ${name}`, async () => (await sidebar(page).getByText(name, { exact: true }).count()) > 0)
  }

  const rings = await page.evaluate(() =>
    [...document.querySelectorAll('aside [data-progress-ring]')].map((el) => ({
      label: el.getAttribute('aria-label'),
      ring: el.getAttribute('data-progress-ring'),
      row: el.closest('[data-sidebar-project]')?.textContent?.trim() ?? '',
    })))
  const websiteTasks = (await h.api('GET', `/projects/${h.ids.website}/tasks?per_page=500`)).items
  const wDone = websiteTasks.filter((t) => t.done).length
  const wOpen = websiteTasks.filter((t) => !t.done).length
  const websiteRing = rings.find((r) => r.row.startsWith('Website redesign'))
  await h.assert('Website redesign shows a ring that matches the server', {
    ok: !!websiteRing && websiteRing.label === `${wDone} of ${wDone + wOpen} done`,
    detail: JSON.stringify({ ring: websiteRing?.label ?? null, server: `${wDone} of ${wDone + wOpen}` }),
  })
  await h.assert('rings have a name for assistive technology', rings.length > 0 && rings.every((r) => /^\d+ of \d+ done$/.test(r.label ?? '')))

  const navCounts = await page.evaluate(() => {
    const out = {}
    for (const b of document.querySelectorAll('aside nav[aria-label="Lists"] button')) {
      const label = b.querySelector('span')?.textContent?.trim()
      const count = b.querySelectorAll('span')[1]?.textContent?.trim() ?? null
      if (label) out[label] = count
    }
    return out
  })
  const inboxOpen = (await h.api('GET', `/projects/${inboxId}/tasks?filter=${encodeURIComponent('done = false')}&per_page=1`)).total
  await h.assert('Inbox shows its open task count', { ok: inboxOpen === 0 ? navCounts.Inbox === null : navCounts.Inbox === String(inboxOpen), detail: `${navCounts.Inbox} vs ${inboxOpen}` })
  await h.assert('Today shows a count', { ok: /^\d+$/.test(navCounts.Today ?? ''), detail: `${navCounts.Today}` })

  await h.capture('sidebar-expanded', { clip: sidebar(page) })

  // --- C. Collapse ------------------------------------------------------------------------
  const workRow = sidebar(page).locator('[role="button"]', { hasText: 'Work' }).first()
  const toggle = sidebar(page).getByRole('button', { name: 'Collapse Work' })
  await h.assert('Work has a collapse button that names it', async () => (await toggle.count()) === 1)
  await toggle.click()
  await h.wait(500)
  await h.assert('collapsing Work hides Website redesign and Q4 planning', async () =>
    (await sidebar(page).getByText('Website redesign', { exact: true }).count()) === 0 &&
    (await sidebar(page).getByText('Q4 planning', { exact: true }).count()) === 0 &&
    (await sidebar(page).getByText('Home renovation', { exact: true }).count()) > 0)
  await h.assert('the collapsed state is announced (aria-expanded false)', async () =>
    (await workRow.getAttribute('aria-expanded')) === 'false')
  await h.wait(600)
  const saved = await page.evaluate(async () => (await window.api.getConfig())?.sidebar_collapsed_projects ?? null)
  await h.assert('the collapsed area is saved in the config', { ok: Array.isArray(saved) && saved.includes(h.ids.work), detail: JSON.stringify(saved) })

  await h.capture('sidebar-collapsed', { clip: sidebar(page) })

  await page.reload()
  await page.waitForLoadState('domcontentloaded')
  await h.wait(1800)
  await h.settle(page, 500)
  await h.assert('the collapsed state survives a reload', async () => (await sidebar(page).getByText('Website redesign', { exact: true }).count()) === 0)

  // Keyboard: ArrowRight on the focused row expands it again.
  await workRow.focus()
  await page.keyboard.press('ArrowRight')
  await h.wait(500)
  await h.assert('ArrowRight on the row expands it', async () => (await sidebar(page).getByText('Website redesign', { exact: true }).count()) > 0)
  await page.keyboard.press('ArrowLeft')
  await h.wait(400)
  await h.assert('ArrowLeft on the row collapses it', async () => (await sidebar(page).getByText('Website redesign', { exact: true }).count()) === 0)
  await sidebar(page).getByRole('button', { name: 'Expand Work' }).click()
  await h.wait(500)
  await h.assert('expanding brings the children back', async () => (await sidebar(page).getByText('Website redesign', { exact: true }).count()) > 0)
  await h.wait(600)

  await h.axe('aside', { label: 'sidebar' })
}
