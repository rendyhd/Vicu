// WM (cross-app semantics section 22, docs/guide/work-and-personal.md): Work and Personal in the
// running app. Throwaway projects "WM Client" (with "WM Client sub") and "WM Home", the label
// "wm-work" and tasks titled "WM ...".
//
//   1. Feature off: no switch.  2. Settings: turn it on, pick the label, tick WM Client (synced).
//   3. Work: tree, Today, Inbox, Logbook.  4. Personal: the reverse.  5. All: everything.
//   6. Project menu: untick and tick again on the subproject (entry false, then none again).
//   7. A task added in Work gets the label; without a label "Added to Personal".
//   8. Search, the palette and Quick find mark what the mode would not list.
//   9. A project page reached in the other mode says "1 more in Work", Show reveals it until the page is left.
//   10. Pro only in Work.  11. axe on the sidebar and the Settings card.
// Removes everything it made, writes the synced keys back to none and puts the device settings back.
import { dueAt } from './_pro-groups.mjs'

export const meta = {
  id: 'WM',
  wave: 9,
  title: 'Work and Personal: the switch, the lists, the project menu, new tasks, search and Pro only in Work',
}

const list = (value) => (Array.isArray(value) ? value : (value?.items ?? []))

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
  const config = () => page.evaluate(() => window.api.getConfig())
  const prefs = () => page.evaluate(() => window.api.getSyncedPrefs()).then((p) => p.values)
  const saveConfig = (patch) => page.evaluate((p) => window.api.saveConfigPatch(p), patch)
  const writePrefs = (values) => page.evaluate((v) => window.api.setSyncedPreferences(v), values)
  const reload = async () => {
    await page.reload()
    await h.wait(1500)
  }
  const refresh = async () => {
    await page.keyboard.press('F5')
    await h.wait(1300)
  }
  /** The text of the main region: the Logbook's rows are no [data-task-id] rows, so the titles are looked up in it. */
  const titles = async () => [await page.locator('main').innerText()]
  const has = (rows, title) => rows.some((text) => text.includes(title))
  const settled = async (view, expect) => {
    // Lists load after the route: wait until the expected rows are there (or give up).
    await waitFor(async () => {
      const rows = await titles()
      return expect.every((title) => has(rows, title))
    }, 25, 200)
    await h.wait(300)
    return titles()
  }
  const treeIds = () => page.locator('aside [data-sidebar-project]').evaluateAll((els) => els.map((el) => Number(el.getAttribute('data-sidebar-project'))))
  const setMode = (mode) => page.locator(`[data-work-mode="${mode}"]`).click()
  const storedMode = () => config().then((c) => c.work_mode ?? 'all')
  const findTask = async (title) => list(await h.api('GET', `/tasks?q=${encodeURIComponent(title)}&per_page=50`)).find((task) => task.title === title) ?? null
  const hasLabel = (task, label) => (task?.labels ?? []).some((entry) => entry.id === label.id)
  const card = page.locator('[data-work-mode-settings]')
  const openGeneral = async () => {
    await h.goto('/settings')
    await h.wait(600)
    await page.getByRole('navigation', { name: 'Settings' }).getByRole('button', { name: 'General', exact: true }).click()
    await h.wait(400)
    await card.scrollIntoViewIfNeeded()
  }
  const expandTree = async (title) => {
    const open = page.locator(`aside button[aria-label="Expand ${title}"]`)
    if (await open.count()) {
      await open.click()
      await h.wait(300)
    }
  }
  const noSerious = (violations) => violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')

  // What the profile has now, to put back.
  const before = await config()
  const beforePrefs = await prefs()
  const inbox = before.inbox_project_id
  const made = { projects: [], labels: [], tasks: [] }

  const cleanStale = async () => {
    for (const task of list(await h.api('GET', '/tasks?q=WM&per_page=200').catch(() => []))) {
      if (String(task.title).startsWith('WM ')) await h.api('DELETE', `/tasks/${task.id}`).catch(() => {})
    }
    for (const project of list(await h.api('GET', '/projects?per_page=200').catch(() => []))) {
      if (['WM Client', 'WM Home', 'WM Client sub'].includes(project.title)) await h.api('DELETE', `/projects/${project.id}`).catch(() => {})
    }
    for (const label of list(await h.api('GET', '/labels?per_page=200').catch(() => []))) {
      if (label.title === 'wm-work') await h.api('DELETE', `/labels/${label.id}`).catch(() => {})
    }
  }
  await cleanStale()

  try {
    await saveConfig({ work_mode_enabled: false, work_mode: 'all', pro_enabled: false, pro_only_in_work: false })

    // --- Setup: throwaway data ------------------------------------------------------------------------
    const mk = async (title, extra = {}) => {
      const project = await retry(() => h.api('POST', '/projects', { title, ...extra }))
      made.projects.push(project.id)
      return project
    }
    const client = await mk('WM Client')
    const home = await mk('WM Home')
    const sub = await mk('WM Client sub', { parent_project_id: client.id })
    const label = await retry(() => h.api('POST', '/labels', { title: 'wm-work' }))
    made.labels.push(label.id)
    const mkTask = async (title, projectId, { due = true, done = false, labelled = false } = {}) => {
      const task = await retry(() => h.api('POST', `/projects/${projectId}/tasks`, { title, ...(due ? { due_date: dueAt(0) } : {}) }))
      made.tasks.push(task.id)
      if (labelled) await retry(() => h.api('POST', `/tasks/${task.id}/labels`, { label_id: label.id }))
      if (done) await retry(() => h.api('PATCH', `/tasks/${task.id}`, { done: true }))
      return task
    }
    await mkTask('WM client today', client.id)
    await mkTask('WM client sub task', sub.id, { due: false })
    const homeToday = await mkTask('WM home today', home.id)
    await mkTask('WM inbox labelled', inbox, { labelled: true })
    await mkTask('WM inbox plain', inbox)
    await mkTask('WM client done', client.id, { due: false, done: true })
    await mkTask('WM home done', home.id, { due: false, done: true })
    await reload()

    // --- 1. Feature off ---------------------------------------------------------------------------------
    await h.goto('/today')
    await h.wait(600)
    await h.assert('1: with the feature off the sidebar has no Work and Personal switch', (await page.locator('[data-work-mode-switch]').count()) === 0)

    // --- 2. Settings -------------------------------------------------------------------------------------
    await openGeneral()
    await h.assert('2: the Work and Personal card is in Settings, General', (await card.count()) === 1)
    await h.assert('2: the label and the projects are offered only once the switch is on', (await card.locator('select').count()) === 0)
    await card.getByRole('switch').first().click()
    await h.wait(500)
    await h.assert('2: turning the switch on saves work_mode_enabled', async () => ({ ok: (await config()).work_mode_enabled === true }))
    // The label was made a moment ago through the API: wait for the app's label list to have it.
    const labelListed = () => card.locator('select option', { hasText: 'wm-work' }).count().then((n) => n > 0)
    if (!(await waitFor(labelListed, 10, 200))) await refresh() // F5 reads the labels again
    await waitFor(labelListed, 40, 200)
    await card.locator('select').selectOption({ label: 'wm-work' })
    const labelSaved = await waitFor(async () => (await prefs())['work.label'] === label.id)
    await h.assert('2: the picked label is the synced work.label', { ok: !!labelSaved, detail: JSON.stringify((await prefs())['work.label']) })
    const row = (title) => card.locator('[data-work-projects] li').filter({ has: page.getByText(title, { exact: true }) })
    await row('WM Client').locator('input[type="checkbox"]').click()
    const projectSaved = await waitFor(async () => (await prefs())[`work.project.${client.id}`] === true)
    await h.assert('2: ticking WM Client writes work.project.<id> = true', { ok: !!projectSaved, detail: JSON.stringify((await prefs())[`work.project.${client.id}`]) })
    await h.assert('2: the subproject shows ticked by inheritance and has no entry of its own', async () => {
      const ticked = !!(await waitFor(() => row('WM Client sub').locator('input[type="checkbox"]').isChecked(), 15, 200))
      const entry = (await prefs())[`work.project.${sub.id}`]
      return { ok: ticked && entry == null, detail: `ticked ${ticked}, entry ${JSON.stringify(entry)}` }
    })
    await h.assert('2: WM Home is not ticked', !(await row('WM Home').locator('input[type="checkbox"]').isChecked()))
    await h.capture('settings-card', { clip: card })
    const cardAxe = await h.axe('[data-work-mode-settings]', { label: 'the Work and Personal settings card' })
    await h.assert('11: axe finds no serious or critical violation in the Settings card', { ok: noSerious(cardAxe).length === 0, detail: cardAxe.map((v) => v.id).join(', ') })

    // --- 3. The switch, All then Work ---------------------------------------------------------------------
    await h.goto('/today')
    await h.wait(800)
    await h.assert('3: the switch appears with All selected', async () => ({
      ok: (await page.locator('[data-work-mode="all"]').getAttribute('aria-checked')) === 'true' && (await page.locator('[data-work-mode-switch] [role="radio"]').count()) === 3,
    }))
    await h.capture('sidebar-all', { clip: page.locator('aside').first() })
    const sidebarAxe = await h.axe('aside', { label: 'the sidebar with the switch' })
    await h.assert('11: axe finds no serious or critical violation in the sidebar', { ok: noSerious(sidebarAxe).length === 0, detail: sidebarAxe.map((v) => `${v.id}: ${v.targets.join(' ')}`).join(', ') })

    await setMode('work')
    await h.wait(500)
    await h.assert('3: clicking Work selects it and saves work_mode', async () => ({
      ok: (await page.locator('[data-work-mode="work"]').getAttribute('aria-checked')) === 'true' && (await storedMode()) === 'work',
    }))
    const checked = () => page.locator('[data-work-mode][aria-checked="true"]').getAttribute('data-work-mode')
    await h.assert('3: the chosen segment is readable (its text colour differs from its fill, also with forced colours)', async () => {
      const colours = await page.locator('[data-work-mode="work"]').evaluate((el) => ({ fill: getComputedStyle(el).backgroundColor, text: getComputedStyle(el).color }))
      return { ok: colours.fill !== colours.text, detail: JSON.stringify(colours) }
    })
    await h.key('ArrowRight')
    await h.wait(300)
    await h.assert('3: Right moves Work to Personal', { ok: (await checked()) === 'personal' && (await storedMode()) === 'personal' })
    await h.key('ArrowLeft')
    await h.wait(300)
    await h.assert('3: Left moves it back to Work', { ok: (await checked()) === 'work' })
    await h.key('End')
    await h.wait(300)
    await h.assert('3: End goes to Personal', { ok: (await checked()) === 'personal' })
    await h.key('Home')
    await h.wait(300)
    await h.assert('3: Home goes to All', { ok: (await checked()) === 'all' })
    await h.assert('3: the focus stays in the radio group', async () => ({ ok: (await page.evaluate(() => document.activeElement?.getAttribute('data-work-mode'))) === 'all' }))
    await setMode('work')
    await h.wait(500)

    await expandTree('WM Client')
    let ids = await treeIds()
    await h.assert('3: Work: the tree lists WM Client and its subproject, not WM Home', { ok: ids.includes(client.id) && ids.includes(sub.id) && !ids.includes(home.id), detail: JSON.stringify(ids) })
    await h.capture('sidebar-work', { clip: page.locator('aside').first() })

    await h.goto('/today')
    let rows = await settled('today', ['WM client today', 'WM inbox labelled'])
    await h.assert('3: Work, Today: the WM Client task and the labelled Inbox task', { ok: has(rows, 'WM client today') && has(rows, 'WM inbox labelled') })
    await h.assert('3: Work, Today: not the WM Home task nor the unlabelled Inbox task', { ok: !has(rows, 'WM home today') && !has(rows, 'WM inbox plain') })
    await h.capture('today-work')
    await h.goto('/inbox')
    rows = await settled('inbox', ['WM inbox labelled'])
    await h.assert('3: Work, Inbox: only the labelled task', { ok: has(rows, 'WM inbox labelled') && !has(rows, 'WM inbox plain') })
    await h.goto('/logbook')
    rows = await settled('logbook', ['WM client done'])
    await h.assert('3: Work, Logbook: the done WM Client task, not the WM Home one', { ok: has(rows, 'WM client done') && !has(rows, 'WM home done') })

    // --- 4. Personal -----------------------------------------------------------------------------------------
    await setMode('personal')
    await h.wait(500)
    ids = await treeIds()
    await h.assert('4: Personal: the tree lists WM Home, not WM Client nor its subproject', { ok: ids.includes(home.id) && !ids.includes(client.id) && !ids.includes(sub.id), detail: JSON.stringify(ids) })
    await h.capture('sidebar-personal', { clip: page.locator('aside').first() })
    await h.goto('/today')
    rows = await settled('today', ['WM home today', 'WM inbox plain'])
    await h.assert('4: Personal, Today: the WM Home task and the unlabelled Inbox task', { ok: has(rows, 'WM home today') && has(rows, 'WM inbox plain') })
    await h.assert('4: Personal, Today: not the WM Client task nor the labelled Inbox task', { ok: !has(rows, 'WM client today') && !has(rows, 'WM inbox labelled') })
    await h.capture('today-personal')
    await h.goto('/inbox')
    rows = await settled('inbox', ['WM inbox plain'])
    await h.assert('4: Personal, Inbox: only the unlabelled task', { ok: has(rows, 'WM inbox plain') && !has(rows, 'WM inbox labelled') })
    await h.goto('/logbook')
    rows = await settled('logbook', ['WM home done'])
    await h.assert('4: Personal, Logbook: the done WM Home task, not the WM Client one', { ok: has(rows, 'WM home done') && !has(rows, 'WM client done') })

    // --- 5. All ----------------------------------------------------------------------------------------------
    await setMode('all')
    await h.wait(500)
    await expandTree('WM Client')
    ids = await treeIds()
    await h.assert('5: All: the tree lists both projects and the subproject', { ok: ids.includes(client.id) && ids.includes(home.id) && ids.includes(sub.id), detail: JSON.stringify(ids) })
    await h.goto('/today')
    rows = await settled('today', ['WM client today', 'WM home today', 'WM inbox labelled', 'WM inbox plain'])
    await h.assert('5: All, Today: all four tasks', { ok: ['WM client today', 'WM home today', 'WM inbox labelled', 'WM inbox plain'].every((t) => has(rows, t)) })
    await h.goto('/logbook')
    rows = await settled('logbook', ['WM client done', 'WM home done'])
    await h.assert('5: All, Logbook: both done tasks', { ok: has(rows, 'WM client done') && has(rows, 'WM home done') })

    // --- 6. The project menu -------------------------------------------------------------------------------------
    const subKey = `work.project.${sub.id}`
    const menuTick = async () => {
      await page.locator(`aside [data-sidebar-project="${sub.id}"]`).click({ button: 'right' })
      const item = page.getByRole('menuitemcheckbox', { name: 'Work project' })
      await item.waitFor({ timeout: 5000 })
      return item
    }
    await expandTree('WM Client')
    let item = await menuTick()
    await h.assert('6: the menu offers "Work project", ticked for the subproject by inheritance', { ok: (await item.getAttribute('aria-checked')) === 'true' })
    await h.capture('project-menu', { page })
    await item.click()
    const falsed = await waitFor(async () => (await prefs())[subKey] === false)
    await h.assert('6: unticking writes work.project.<sub> = false', { ok: !!falsed, detail: JSON.stringify((await prefs())[subKey]) })
    await setMode('work')
    await h.wait(500)
    ids = await treeIds()
    await h.assert('6: in Work the subproject is gone from the tree, WM Client stays', { ok: ids.includes(client.id) && !ids.includes(sub.id), detail: JSON.stringify(ids) })
    await setMode('all')
    await h.wait(500)
    await expandTree('WM Client')
    item = await menuTick()
    await h.assert('6: the tick is off now', { ok: (await item.getAttribute('aria-checked')) === 'false' })
    await item.click()
    const cleared = await waitFor(async () => (await prefs())[subKey] == null)
    await h.assert('6: ticking it again takes the entry away (none, not true)', { ok: !!cleared, detail: JSON.stringify((await prefs())[subKey]) })

    // --- 7. New tasks in Work ---------------------------------------------------------------------------------------
    await setMode('work')
    await h.goto('/inbox')
    await h.wait(800)
    const compose = async (title) => {
      await page.locator('button[aria-label="New task"]').last().click()
      await h.wait(300)
      await page.keyboard.type(title, { delay: 10 })
      await h.wait(300)
      await page.keyboard.press('Enter')
      await h.wait(700)
      await page.keyboard.press('Escape')
      await h.wait(300)
    }
    await compose('WM added work')
    rows = await titles()
    await h.assert('7: a task added in Work from the Inbox stays visible', { ok: has(rows, 'WM added work') })
    const addedWork = await waitFor(() => findTask('WM added work'))
    if (addedWork) made.tasks.push(addedWork.id)
    await h.assert("7: the server's task carries the work label", { ok: hasLabel(addedWork, label), detail: JSON.stringify(addedWork?.labels) })
    await h.assert('7: no "Added to Personal" toast when the label was added', (await page.getByText('Added to Personal', { exact: false }).count()) === 0)

    await openGeneral()
    await card.locator('select').selectOption({ label: 'None' })
    await waitFor(async () => (await prefs())['work.label'] == null)
    await h.assert('7: the label is None now', async () => ({ ok: (await prefs())['work.label'] == null }))
    await h.capture('settings-no-label', { clip: card })
    await h.goto('/inbox')
    await h.wait(800)
    await compose('WM added plain')
    await h.capture('toast-added-personal')
    await h.assert('7: without a work label the "Added to Personal" toast shows', async () => ({ ok: (await page.getByText('Added to Personal', { exact: false }).count()) > 0 }))
    const addedPlain = await waitFor(() => findTask('WM added plain'))
    if (addedPlain) made.tasks.push(addedPlain.id)
    await h.assert('7: that task has no label', { ok: !!addedPlain && (addedPlain.labels ?? []).length === 0, detail: JSON.stringify(addedPlain?.labels) })
    await writePrefs({ 'work.label': label.id })
    await waitFor(async () => (await prefs())['work.label'] === label.id)

    // --- 8. Search, the palette and Quick find mark, never filter ------------------------------------------------------
    await h.goto('/search?q=WM%20home%20today')
    rows = await settled('search', ['WM home today'])
    await h.assert('8: Work, Search finds the WM Home task', { ok: has(rows, 'WM home today') })
    const mark = page.locator('[data-task-id]', { hasText: 'WM home today' }).locator('[data-work-mark]')
    await h.assert('8: it carries the word "Personal"', async () => ({ ok: (await mark.count()) === 1 && ((await mark.textContent()) ?? '').trim() === 'Personal' }))
    await h.capture('search-mark')
    await h.goto('/search?q=WM%20client%20today')
    await settled('search', ['WM client today'])
    await h.assert('8: a work task has no mark in Work', (await page.locator('[data-task-id] [data-work-mark]').count()) === 0)

    await h.goto('/today')
    await h.wait(500)
    await h.key('Control+Shift+P')
    await page.getByRole('combobox', { name: 'Command palette' }).fill('WM Home')
    await h.wait(800)
    const palette = page.locator('[role="listbox"][aria-label="Results"] [role="option"]')
    await h.assert('8: the palette finds the WM Home project, marked "Personal"', async () => {
      const option = palette.filter({ hasText: 'WM Home' }).first()
      return { ok: (await option.count()) === 1 && ((await option.locator('[data-work-mark]').textContent().catch(() => '')) ?? '').trim() === 'Personal' }
    })
    await h.assert('8: the palette marks the WM Home task too and filters nothing', async () => {
      const marks = await palette.locator('[data-work-mark]').count()
      return { ok: marks >= 2, detail: `${marks} marks` }
    })
    await h.capture('palette-mark', { page })
    await h.key('Escape')
    await h.wait(300)
    await h.key('Control+F')
    await page.getByRole('combobox', { name: 'Quick find' }).fill('WM home')
    await h.wait(1200)
    await h.assert('8: Quick find marks the WM Home task "Personal"', async () => {
      const option = page.locator('[role="listbox"][aria-label="Quick find results"] [role="option"]', { hasText: 'WM home today' })
      return { ok: (await option.count()) === 1 && ((await option.locator('[data-work-mark]').textContent().catch(() => '')) ?? '').trim() === 'Personal' }
    })
    await h.capture('quickfind-mark')
    await h.key('Escape')
    await h.key('Escape')

    // --- 9. A project page of the other mode ------------------------------------------------------------------------------
    await retry(() => h.api('POST', `/tasks/${homeToday.id}/labels`, { label_id: label.id }))
    await setMode('personal')
    await h.wait(400)
    await h.goto(`/project/${home.id}`)
    await h.wait(500)
    await refresh()
    await h.assert('9: Personal, WM Home: the work-labelled task is not listed', { ok: !has(await titles(), 'WM home today') })
    const more = page.locator('[data-work-mode-more]')
    await h.assert('9: the line "1 more in Work" shows', async () => ({ ok: (await more.count()) === 1 && ((await more.textContent()) ?? '').includes('1 more in Work'), detail: (await more.allTextContents()).join('|') }))
    await h.capture('project-more')
    await more.getByRole('button', { name: 'Show' }).click()
    await h.wait(500)
    await h.assert('9: Show reveals the task and the line goes', async () => ({ ok: has(await titles(), 'WM home today') && (await more.count()) === 0 }))
    // Show lasts until the page is left: another project and back hides the task again.
    await h.goto(`/project/${client.id}`)
    await h.wait(500)
    await h.goto(`/project/${home.id}`)
    await h.wait(500)
    await h.assert('9: after another project and back, the task is hidden again and the line is back', async () => ({
      ok: !has(await titles(), 'WM home today') && (await more.count()) === 1,
      detail: (await more.allTextContents()).join('|'),
    }))
    await retry(() => h.api('DELETE', `/tasks/${homeToday.id}/labels/${label.id}`)).catch(() => {})

    // --- 10. Pro only in Work -------------------------------------------------------------------------------------------------
    await saveConfig({ pro_enabled: true, pro_onboarding_seen: true })
    await reload()
    await openGeneral()
    const proSwitch = card.getByRole('switch').nth(1)
    await h.assert('10: with Pro on the card offers "Show Pro only in Work"', async () => ({ ok: (await card.getByText('Show Pro only in Work').count()) === 1 }))
    await proSwitch.click()
    await h.wait(500)
    await h.assert('10: it saves pro_only_in_work', async () => ({ ok: (await config()).pro_only_in_work === true }))
    await h.capture('settings-pro-only', { clip: card })
    const proNav = page.locator('aside [data-pro-nav]')
    await setMode('all')
    await h.wait(600)
    await h.assert('10: All shows the Pro section', async () => ({ ok: (await proNav.count()) === 1 }))
    await setMode('personal')
    await h.wait(600)
    await h.assert('10: Personal hides the Pro section', async () => ({ ok: (await proNav.count()) === 0 }))
    await h.capture('sidebar-personal-no-pro', { clip: page.locator('aside').first() })
    await setMode('work')
    await h.wait(600)
    await h.assert('10: Work shows the Pro section', async () => ({ ok: (await proNav.count()) === 1 }))
    await h.capture('sidebar-work-pro', { clip: page.locator('aside').first() })

    // --- 12. The narrow sidebar ----------------------------------------------------------------------------------------------------
    await saveConfig({ sidebar_width: 180 })
    await reload()
    await h.wait(500)
    const narrow = page.locator('aside').first()
    await h.capture('sidebar-narrow', { clip: narrow })
    await h.assert('12: at the narrowest sidebar the three segments fit without clipping', async () => {
      // The text's own width against the room inside the segment (an ellipsis hides overflow from scrollWidth).
      const bad = await page.locator('[data-work-mode-switch] [role="radio"]').evaluateAll((els) =>
        els
          .filter((el) => {
            const range = document.createRange()
            range.selectNodeContents(el)
            const style = getComputedStyle(el)
            const room = el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
            return range.getBoundingClientRect().width > room + 0.5
          })
          .map((el) => el.textContent),
      )
      const box = await page.locator('[data-work-mode-switch]').boundingBox()
      const side = await narrow.boundingBox()
      return { ok: bad.length === 0 && !!box && !!side && box.x + box.width <= side.x + side.width + 1, detail: JSON.stringify({ bad, box, side }) }
    })
  } finally {
    await saveConfig({ work_mode_enabled: false, work_mode: 'all', sidebar_width: before.sidebar_width ?? 260 }).catch(() => {})
    await saveConfig({ pro_enabled: before.pro_enabled ?? false, pro_only_in_work: before.pro_only_in_work ?? false, work_mode_enabled: before.work_mode_enabled ?? false, work_mode: before.work_mode ?? 'all' }).catch(() => {})
    const keys = { 'work.label': beforePrefs['work.label'] ?? null }
    for (const id of made.projects) keys[`work.project.${id}`] = null
    await writePrefs(keys).catch(() => {})
    await cleanStale()
    for (const id of made.tasks) await h.api('DELETE', `/tasks/${id}`).catch(() => {})
  }
}
