// project-manage: managing projects from the sidebar, the project page and Settings → Projects.
//
//   A. The … button shows on a hovered sidebar row and opens the project menu (Rename, Edit…,
//      Add subproject, Move to…, Set as Inbox, Review, Archive, Delete); right-click opens the same.
//   B. Move to… puts Q4 planning under Personal on the server; Undo in the toast puts it back.
//   C. Dragging Trip to Lisbon onto the middle of Work nests it there (the row shows the "into"
//      highlight while held); Undo puts it back after Home renovation.
//   D. Alt+Shift+Down / Up on a focused row reorders it among its siblings.
//   E. F2 renames in place; Enter saves and focus returns to the row.
//   F. + on the PROJECTS header adds an editable row; Enter creates the project. Archiving it puts
//      it in the Archived group, Restore brings it back, Delete removes it.
//   G. The project page has a … menu without Rename; Settings → Projects has Inbox, Projects,
//      Display and Review, and General no longer has the Inbox picker.
//
// It changes projects on the test server and puts every change back (a finally block repairs
// what a failure left behind). Run it alone: --scenario project-manage.
import { createApi, readApiToken } from '../lib.mjs'

export const meta = {
  id: 'pm',
  wave: null,
  title: 'Project management: … menu, Move to with Undo, drag to nest, keyboard moves, rename, create, archive and restore, Settings tab',
}

const MERGE = 'application/merge-patch+json'

export default async function run(h) {
  const page = h.page
  const api = createApi(readApiToken())
  const ids = h.ids
  const aside = page.locator('aside').first()
  const row = (id) => aside.locator(`[data-sidebar-project="${id}"]`)
  const activator = (id) => aside.locator(`[data-project-row="sidebar:${id}"]`)
  const project = (id) => api.call('GET', `/projects/${id}`)
  const menuItems = () =>
    page.evaluate(() => [...document.querySelectorAll('[role="menu"]:popover-open [role="menuitem"]')].map((el) => el.textContent.trim()))
  const until = async (fn, timeout = 8000) => {
    const end = Date.now() + timeout
    let last
    while (Date.now() < end) {
      last = await fn().catch(() => undefined)
      if (last) return last
      await h.wait(200)
    }
    return last
  }
  const undo = async () => {
    const button = page.getByRole('button', { name: 'Undo' }).first()
    await button.waitFor({ timeout: 6000 })
    await button.click()
    await h.wait(300)
  }

  const original = Object.fromEntries(
    await Promise.all([ids.work, ids.personal, ids.website, ids.q4, ids.home, ids.lisbon].map(async (id) => [id, await project(id)])),
  )
  let tempId = null

  try {
    await h.resize(1280, 820)
    await h.goto('/today')
    await h.wait(1500)

    // --- A. The … button and the menu -------------------------------------------------------------
    await row(ids.q4).hover()
    await h.wait(200)
    const more = row(ids.q4).getByRole('button', { name: 'Q4 planning actions' })
    await h.assert('A: the … button shows on a hovered row', async () => more.isVisible())
    await more.click()
    await h.wait(300)
    const items = await menuItems()
    const expected = ['Rename', 'Edit…', 'Add subproject', 'Move to…', 'Set as Inbox', 'Review', 'Archive', 'Delete']
    await h.assert('A: the menu lists every project action', {
      ok: expected.every((label) => items.some((item) => item.startsWith(label))),
      detail: JSON.stringify(items),
    })
    await h.capture('menu')
    await h.assert('A: axe finds no serious violation with the menu open', async () => {
      const found = await h.axe('[role="menu"]', { label: 'project menu' })
      return { ok: found.filter((v) => v.impact === 'serious' || v.impact === 'critical').length === 0, detail: found.map((v) => v.id).join(', ') }
    })
    await h.key('Escape')
    await h.wait(250)
    await activator(ids.work).click({ button: 'right' })
    await h.wait(300)
    await h.assert('A: right-click opens the same menu', async () => (await menuItems()).includes('Edit…'))
    await h.key('Escape')
    await h.wait(250)

    // --- B. Move to… and Undo -------------------------------------------------------------------
    await row(ids.q4).hover()
    await more.click()
    await h.wait(250)
    await page.locator('[role="menu"]:popover-open [role="menuitem"]', { hasText: 'Move to…' }).click()
    await h.wait(300)
    const picker = page.locator('[role="listbox"][aria-label="Move to"]')
    await h.assert('B: Move to… opens a picker with the top level and the projects', async () => {
      const options = await picker.locator('[role="option"]').allTextContents()
      return { ok: options[0] === 'Top level' && options.includes('Personal') && !options.includes('Q4 planning'), detail: JSON.stringify(options) }
    })
    await h.capture('move-to')
    await picker.locator('[role="option"]', { hasText: 'Personal' }).click()
    await h.assert('B: the server has Q4 planning under Personal', async () =>
      until(async () => (await project(ids.q4)).parent_project_id === ids.personal))
    await h.assert('B: a toast says where it went', async () => (await page.getByText('Moved “Q4 planning” into “Personal”').count()) > 0)
    await undo()
    await h.assert('B: Undo puts it back under Work', async () =>
      until(async () => (await project(ids.q4)).parent_project_id === ids.work))

    // --- C. Drag to nest ------------------------------------------------------------------------
    await h.wait(600)
    await h.drag(activator(ids.lisbon), row(ids.work), { hold: true })
    await h.wait(300)
    await h.assert('C: the Work row shows the "into" highlight while the drag is held', async () =>
      page.evaluate((id) => /ring-1/.test(document.querySelector(`aside [data-sidebar-project="${id}"]`)?.className ?? ''), ids.work))
    await h.capture('drag-into', { clip: aside })
    await h.mouseUp()
    await h.assert('C: the server has Trip to Lisbon under Work', async () =>
      until(async () => (await project(ids.lisbon)).parent_project_id === ids.work))
    await undo()
    await h.assert('C: Undo puts it back under Personal, after Home renovation', async () =>
      until(async () => {
        const [lisbon, home] = await Promise.all([project(ids.lisbon), project(ids.home)])
        return lisbon.parent_project_id === ids.personal && lisbon.position > home.position
      }))

    // --- D. Keyboard moves ----------------------------------------------------------------------
    await h.wait(600)
    await activator(ids.website).focus()
    await h.key('Alt+Shift+ArrowDown')
    await h.assert('D: Alt+Shift+Down moves Website redesign below Q4 planning', async () =>
      until(async () => (await project(ids.website)).position > (await project(ids.q4)).position))
    await h.assert('D: focus stays on the moved row', async () =>
      page.evaluate((id) => document.activeElement?.getAttribute('data-project-row') === `sidebar:${id}`, ids.website))
    await h.key('Alt+Shift+ArrowUp')
    await h.assert('D: Alt+Shift+Up moves it back', async () =>
      until(async () => (await project(ids.website)).position < (await project(ids.q4)).position))

    // --- E. Rename in place ---------------------------------------------------------------------
    await activator(ids.home).focus()
    await h.key('F2')
    await h.wait(250)
    await h.assert('E: F2 opens a rename field with the name selected', async () =>
      page.evaluate(() => {
        const el = document.activeElement
        return el?.tagName === 'INPUT' && el.selectionStart === 0 && el.selectionEnd === el.value.length && el.value === 'Home renovation'
      }))
    await h.type('Home renovation 2')
    await h.key('Enter')
    await h.assert('E: Enter saves the new name', async () => until(async () => (await project(ids.home)).title === 'Home renovation 2'))
    await h.assert('E: focus returns to the row', async () =>
      until(() => page.evaluate((id) => document.activeElement?.getAttribute('data-project-row') === `sidebar:${id}`, ids.home)))
    await h.key('F2')
    await h.wait(200)
    await h.type('Home renovation')
    await h.key('Enter')
    await until(async () => (await project(ids.home)).title === 'Home renovation')

    // --- F. Create, archive, restore, delete ----------------------------------------------------
    await aside.getByRole('button', { name: 'New project' }).click()
    await h.wait(250)
    await h.assert('F: + adds an editable row with focus in it', async () =>
      page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'New project name'))
    await h.capture('create-row', { clip: aside })
    await h.type('UI verify temp')
    await h.key('Enter')
    const created = await until(async () => (await api.list('/projects')).find((p) => p.title === 'UI verify temp'))
    tempId = created?.id ?? null
    await h.assert('F: Enter creates the project on the server', !!tempId)
    if (tempId) {
      await until(async () => (await row(tempId).count()) > 0)
      await row(tempId).hover()
      await row(tempId).getByRole('button', { name: 'UI verify temp actions' }).click()
      await h.wait(250)
      await page.locator('[role="menu"]:popover-open [role="menuitem"]', { hasText: 'Archive' }).click()
      await h.wait(300)
      await page.locator('dialog[open] button', { hasText: 'Archive' }).click()
      await h.assert('F: Archive archives it on the server', async () => until(async () => (await project(tempId)).is_archived === true))
      const group = aside.getByRole('button', { name: /^Archived/ })
      await h.assert('F: the sidebar shows an Archived group', async () => until(async () => (await group.count()) > 0))
      if ((await group.getAttribute('aria-expanded')) !== 'true') await group.click()
      await h.wait(300)
      await h.capture('archived-group', { clip: aside })
      await aside.getByRole('button', { name: /^UI verify temp/ }).first().hover()
      await h.wait(200)
      await aside.getByRole('button', { name: 'Restore UI verify temp' }).click()
      await h.assert('F: Restore brings it back', async () => until(async () => (await project(tempId)).is_archived === false))
      await until(async () => (await row(tempId).count()) > 0)
      await row(tempId).hover()
      await row(tempId).getByRole('button', { name: 'UI verify temp actions' }).click()
      await h.wait(250)
      await page.locator('[role="menu"]:popover-open [role="menuitem"]', { hasText: 'Delete' }).click()
      await h.wait(300)
      const confirm = page.locator('dialog[open] button', { hasText: 'Delete' })
      if (await confirm.count()) await confirm.click()
      await h.assert('F: Delete removes it from the server', async () =>
        until(async () => {
          try {
            await project(tempId)
            return false
          } catch (e) {
            return e.status === 404 || e.status === 403
          }
        }))
      tempId = null
    }

    // --- G. Project page and Settings -----------------------------------------------------------
    await h.goto(`/project/${ids.work}`)
    await h.wait(800)
    await page.locator('main').getByRole('button', { name: 'Work actions' }).click()
    await h.wait(300)
    const pageItems = await menuItems()
    await h.assert('G: the project page menu has Edit… and no Rename', {
      ok: pageItems.includes('Edit…') && !pageItems.some((item) => item.startsWith('Rename')),
      detail: JSON.stringify(pageItems),
    })
    await h.capture('page-menu')
    await h.key('Escape')
    await h.wait(200)

    await h.goto('/settings')
    await h.wait(600)
    await h.assert('G: General has an Appearance card and no Inbox picker', async () =>
      (await page.getByRole('heading', { name: 'Appearance' }).count()) === 1 && (await page.getByText('Inbox project', { exact: true }).count()) === 0)
    await page.getByRole('button', { name: 'Projects', exact: true }).click()
    await h.wait(600)
    const headings = await page.locator('main h2').allTextContents()
    await h.assert('G: Projects has Inbox, Projects, Display and Review', {
      ok: ['Inbox', 'Projects', 'Display', 'Review'].every((name) => headings.includes(name)),
      detail: JSON.stringify(headings),
    })
    await h.capture('settings-projects')
    await page.locator(`[data-project-row="settings:${ids.q4}"]`).click({ button: 'right' })
    await h.wait(300)
    await h.assert('G: right-click on a Settings row opens the project menu', async () => (await menuItems()).includes('Move to…'))
    await h.key('Escape')
    await h.assert('G: axe finds no serious violation in Settings → Projects', async () => {
      const found = await h.axe('main', { label: 'settings projects' })
      return { ok: found.filter((v) => v.impact === 'serious' || v.impact === 'critical').length === 0, detail: found.map((v) => v.id).join(', ') }
    })
  } finally {
    // Put back whatever a failure left changed.
    for (const [id, before] of Object.entries(original)) {
      const now = await project(Number(id)).catch(() => null)
      if (!now) continue
      const patch = {}
      if (now.parent_project_id !== before.parent_project_id) patch.parent_project_id = before.parent_project_id
      if (now.position !== before.position) patch.position = before.position
      if (now.title !== before.title) patch.title = before.title
      if (Object.keys(patch).length) await api.call('PATCH', `/projects/${id}`, patch, MERGE).catch(() => {})
    }
    if (tempId) await api.call('DELETE', `/projects/${tempId}`).catch(() => {})
  }
}
