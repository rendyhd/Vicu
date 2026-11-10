// saved-filters: Vikunja saved filters as custom lists (cross-app semantics 3.5 to 3.7).
//
// Needs saved filters on the test server: they are pseudo-projects with ids of -2 and below. The
// scenario never creates or changes them; it reads them, and it checks that the import is a copy.
// The harness profile is fresh, so the first custom-list sync is this device's first connect.
//
//   A. No saved filter shows as a project (the sidebar's project tree, the projects read).
//   B. The first sync imports every saved filter no device imported yet, once: one list per
//      saved filter, with the filter_list icon and a toast when something was added.
//   C. An imported list says once that it is a copy; Got it closes it for good.
//   D. The editor keeps a note, shows the rule with names, and has Then by with orders named for
//      the field.
//   E. Settings, Projects: the Saved filters card and the import dialog with each filter's status.
//   F. The saved filters on the server are unchanged.
//   G. A filter whose list was deleted can be imported again from Settings; the toast's Open shows
//      the new list. The list set ends as it started.
export const meta = {
  id: 'saved-filters',
  wave: null,
  title: 'Saved filters: imported once as custom lists, never projects, with the copy notices',
}

const serverFilters = (page) =>
  page.evaluate(async () => {
    const state = await window.api.getSavedFilterState()
    return state
  })

export default async function run(h) {
  const page = h.page
  await h.resize(1280, 860)
  await h.goto('/today')
  await h.wait(1500)

  // ---- A. Never projects --------------------------------------------------------------------
  const projects = await page.evaluate(async () => {
    const result = await window.api.fetchProjects(true)
    return result.success ? result.data.map((p) => ({ id: p.id, title: p.title })) : null
  })
  await h.assert('the projects read has no negative ids', {
    ok: Array.isArray(projects) && projects.length > 0 && projects.every((p) => p.id > 0),
    detail: JSON.stringify(projects?.map((p) => p.id)),
  })
  const state = await serverFilters(page)
  if (!state || state.known.length === 0) {
    h.skip('saved filters', 'the test server has no saved filters; create some first')
    return
  }
  // Every project row in the sidebar has a "<title> actions" button; a custom list has none.
  const projectRows = await page.locator('aside').first().evaluate((aside) =>
    [...aside.querySelectorAll('button[aria-label$=" actions"]')].map((b) => b.getAttribute('aria-label')))
  await h.assert('no saved filter is listed among the projects in the sidebar', {
    ok: projectRows.length > 0 && !state.known.some((f) => projectRows.includes(`${f.title} actions`)),
    detail: JSON.stringify(projectRows),
  })

  // ---- B. First connect --------------------------------------------------------------------
  const importedBefore = state.imported
  await page.evaluate(() => window.api.syncCustomLists())
  await h.wait(2500)
  const lists = await page.evaluate(() => window.api.getCustomLists())
  const imported = lists.filter((l) => typeof l.saved_filter_id === 'number')
  const ids = imported.map((l) => l.saved_filter_id)
  await h.assert('every known saved filter is a list, each once', {
    ok: state.known.every((f) => ids.includes(f.id)) && new Set(ids).size === ids.length,
    detail: JSON.stringify(imported.map((l) => [l.name, l.saved_filter_id])),
  })
  await h.assert('imported lists use the filter_list icon', {
    ok: imported.every((l) => l.icon === 'filter_list'),
    detail: JSON.stringify(imported.map((l) => l.icon)),
  })
  const after = await serverFilters(page)
  await h.assert('the import record holds every known filter and nothing is offered', {
    ok: state.known.every((f) => after.imported.includes(f.id)) && after.offer.length === 0,
    detail: JSON.stringify({ before: importedBefore, after: after.imported, offer: after.offer }),
  })
  const newOnes = state.known.filter((f) => !importedBefore.includes(f.id)).length
  if (newOnes > 0) {
    const toast = page.getByText(newOnes === 1 ? 'Imported 1 saved filter as a list' : `Imported ${newOnes} saved filters as lists`)
    await h.assert('the import says so in a toast with Open', async () => {
      const shown = await toast.isVisible().catch(() => false)
      return { ok: shown, detail: `${newOnes} new` }
    })
    await h.capture('import-toast')
  } else {
    h.skip('import toast', 'nothing new at this sync (the startup sync or another device imported them); G checks the toast')
  }

  // ---- C. First-open notice ----------------------------------------------------------------
  const first = imported[0]
  await h.goto(`/list/${first.id}`)
  await h.wait(1500)
  const notice = page.getByText('Imported from your server')
  await h.assert('an imported list says it is a copy the first time it opens', async () => ({
    ok: await notice.isVisible(),
    detail: first.name,
  }))
  await h.capture('list-notice')
  await page.getByRole('button', { name: 'Got it' }).click()
  await h.wait(500)
  await h.goto('/today')
  await h.wait(500)
  await h.goto(`/list/${first.id}`)
  await h.wait(1200)
  await h.assert('Got it closes the notice for good', async () => ({ ok: !(await notice.isVisible()) }))

  // ---- D. Editor ---------------------------------------------------------------------------
  const ruled = imported.find((l) => /labels/.test(l.filter.rule ?? '')) ?? imported.find((l) => l.filter.then_by?.length) ?? first
  const item = page.locator('nav[aria-label="Custom lists"]').getByText(ruled.name, { exact: true })
  await item.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Edit' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor()
  // The dialog fills its fields in an effect after it opens.
  await h.wait(400)
  await h.assert('the editor keeps a note that the list is a copy', async () => ({
    ok: await dialog.getByText('Imported from a Vikunja saved filter.', { exact: false }).isVisible(),
  }))
  const ruleText = await dialog.getByLabel('Rule').inputValue()
  await h.assert('the rule is shown with names, not label ids', {
    ok: ruleText !== '' && !/labels (in|=) \d/.test(ruleText),
    detail: `${ruled.filter.rule} -> ${ruleText}`,
  })
  const orders = await dialog.getByLabel('Order', { exact: true }).locator('option').allInnerTexts()
  await h.assert('the orders are named for the field', {
    ok: !orders.includes('Ascending') && orders.length === 2,
    detail: JSON.stringify(orders),
  })
  await h.capture('editor', { clip: dialog })
  await dialog.getByLabel('Rule').scrollIntoViewIfNeeded()
  await h.capture('editor-rule', { clip: dialog })
  // A rule that does not read keeps Save off and says why.
  await dialog.getByLabel('Rule').fill('done = ')
  await h.wait(200)
  await h.assert('a rule that does not read turns Save off with a message', async () => ({
    ok: await dialog.getByRole('button', { name: 'Save' }).isDisabled(),
    detail: await dialog.locator('[id$="-rule-help"]').innerText(),
  }))
  await h.capture('editor-invalid', { clip: dialog })
  await dialog.getByRole('button', { name: 'Cancel' }).click()

  // ---- E. Settings -------------------------------------------------------------------------
  await h.goto('/settings')
  await h.wait(600)
  await page.getByRole('button', { name: 'Projects', exact: true }).click()
  await h.wait(600)
  const card = page.locator('div.rounded-card', { has: page.locator('h2', { hasText: /^Saved filters$/ }) })
  await card.scrollIntoViewIfNeeded()
  await h.capture('settings-card', { clip: card })
  await card.getByRole('button', { name: 'Import saved filters' }).click()
  const importDialog = page.getByRole('dialog')
  await importDialog.getByText('Imported before').first().waitFor({ timeout: 8000 })
  const rows = await importDialog.locator('label').allInnerTexts()
  await h.assert('the import dialog lists every filter, the imported ones as Imported before', {
    ok: rows.length === state.known.length && rows.every((r) => /Imported before|Can't import/.test(r)),
    detail: JSON.stringify(rows.map((r) => r.replace(/\s+/g, ' '))),
  })
  await h.assert('the dialog shows rules with label names, not ids', {
    ok: rows.every((r) => !/labels (in|=) \d/.test(r)),
    detail: JSON.stringify(rows.filter((r) => /labels/.test(r)).map((r) => r.replace(/\s+/g, ' '))),
  })
  await h.assert('nothing is ticked, so Import is off', async () => ({
    ok: await importDialog.getByRole('button', { name: 'Import', exact: true }).isDisabled(),
  }))
  await h.capture('import-dialog', { clip: importDialog })
  await importDialog.getByRole('button', { name: 'Cancel' }).click()

  // ---- F. The server is unchanged ----------------------------------------------------------
  const unchanged = await page.evaluate(async () => {
    const state = await window.api.getSavedFilterState()
    const previews = await window.api.previewSavedFilters()
    return { known: state.known.length, previews: previews?.length ?? null }
  })
  await h.assert('the saved filters are still on the server', {
    ok: unchanged.previews === state.known.length,
    detail: JSON.stringify(unchanged),
  })

  // ---- G. Import again after deleting the list ---------------------------------------------
  const again = imported[imported.length - 1]
  await page.evaluate((id) => window.api.deleteCustomList(id), again.id)
  await h.wait(800)
  await h.goto('/settings')
  await h.wait(600)
  await page.getByRole('button', { name: 'Projects', exact: true }).click()
  await h.wait(600)
  const card2 = page.locator('div.rounded-card', { has: page.locator('h2', { hasText: /^Saved filters$/ }) })
  await card2.scrollIntoViewIfNeeded()
  await card2.getByRole('button', { name: 'Import saved filters' }).click()
  const dialog2 = page.getByRole('dialog')
  await dialog2.getByText('Imported before').first().waitFor({ timeout: 8000 })
  const filterTitle = state.known.find((f) => f.id === again.saved_filter_id)?.title ?? again.name
  await dialog2.locator('label', { hasText: filterTitle }).click()
  await h.assert('ticking a filter imported before turns Import on', async () => ({
    ok: await dialog2.getByRole('button', { name: 'Import 1' }).isEnabled(),
  }))
  await dialog2.getByRole('button', { name: 'Import 1' }).click()
  const toast = page.getByText('Imported 1 saved filter as a list')
  await toast.waitFor({ timeout: 8000 }).catch(() => {})
  await h.assert('the import says so in a toast', async () => ({ ok: await toast.isVisible() }))
  await h.capture('import-toast')
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await h.wait(1200)
  const url = await page.evaluate(() => location.hash || location.pathname)
  const listsNow = await page.evaluate(() => window.api.getCustomLists())
  const back = listsNow.find((l) => l.saved_filter_id === again.saved_filter_id)
  await h.assert('Open shows the new list, and the filter has one list again', {
    ok: !!back && back.id !== again.id && url.includes(back.id) &&
      listsNow.filter((l) => l.saved_filter_id === again.saved_filter_id).length === 1,
    detail: JSON.stringify({ url, back: back?.id, old: again.id }),
  })
  await h.assert('the new list shows the first-open notice', async () => ({
    ok: await page.getByText('Imported from your server').isVisible(),
  }))
}
