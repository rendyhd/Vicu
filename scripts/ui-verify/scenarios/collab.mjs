// collab: household collaboration (docs/cross-app-semantics-v1.md section 9, design system 4 and 4.1).
//
//   A. A private project has no avatars and no Assign; its tasks have Comments in the card, and a
//      task without comments shows no count.
//   B. In the shared "Trip to Lisbon" the sidebar row has the shared mark, task lists ask for the
//      comment signals, and the flights row shows its assignees ("Assigned to you, Maya") and an
//      unread count ("2 comments, new").
//   C. The flights card has Assign after Project and Comments before More; Assign lists the members
//      (Sam "Can view only"), and unassigning and assigning Maya reach the server.
//   D. The count on the row opens the card and the comments pane: "Visible to you, Maya and Sam",
//      both comments, the mention in the accent colour; opening it marks the task read on the server.
//      A comment written with the mention picker reaches the server as a mention element. Escape
//      closes the pane and focus returns to the Comments button; Mod+Shift+C opens it again.
//   E. Share dialog from the sidebar menu: owner, Maya and Sam with their permissions; removing Sam
//      offers Undo in the dialog, which puts Sam back.
//   F. With every share removed the project turns private: the shared mark goes and task lists keep
//      asking for the comment signals, which every task has.
//
// It changes the server (assignees, a comment, shares) and puts the shares and assignees back in a
// finally block. Run it alone: --scenario collab.
import { createApi, readApiToken } from '../lib.mjs'

export const meta = {
  id: 'CO',
  wave: null,
  title: 'Collaboration: private projects with Comments only, shared rows with avatars and counts, Assign, the comments pane, sharing',
}

const items = (res) => (Array.isArray(res) ? res : (res?.items ?? []))

export default async function run(h) {
  const page = h.page
  const api = createApi(readApiToken())
  const ids = h.ids
  if (!ids.people?.maya || !ids.tasks?.flights) {
    h.emit({ t: 'skip', id: meta.id, message: 'the seed has no collaboration data: run node scripts/ui-verify/seed.mjs' })
    return
  }
  const maya = ids.people.maya
  const sam = ids.people.sam
  const flights = ids.tasks.flights
  const aside = page.locator('aside').first()
  const row = (id) => page.locator(`[data-task-id="${id}"]`)
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
  const serverTask = async (id) => {
    const list = items(await api.call('GET', `/tasks?filter=${encodeURIComponent(`id = ${id}`)}&expand=comment_count&expand=is_unread`))
    return list.find((t) => t.id === id) ?? (await api.call('GET', `/tasks/${id}`))
  }
  const shares = async () => items(await api.call('GET', `/projects/${ids.lisbon}/users`))
  const restore = async () => {
    const now = await shares()
    if (!now.some((u) => u.id === maya.id)) await api.call('POST', `/projects/${ids.lisbon}/users`, { username: maya.username, permission: 1 }).catch(() => {})
    if (!now.some((u) => u.id === sam.id)) await api.call('POST', `/projects/${ids.lisbon}/users`, { username: sam.username, permission: 0 }).catch(() => {})
    const task = await api.call('GET', `/tasks/${flights}`)
    if (!(task.assignees ?? []).some((a) => a.id === maya.id)) await api.call('POST', `/tasks/${flights}/assignees`, { user_id: maya.id }).catch(() => {})
  }

  try {
    await h.resize(1280, 820)

    // ---- A. A private project ---------------------------------------------------------------
    await h.goto(`/project/${ids.work}`)
    await h.dismiss()
    const privateSignals = await page.evaluate(() => ({
      avatars: document.querySelectorAll('[data-task-id] [aria-label^="Assigned to"]').length,
      counts: [...document.querySelectorAll('[data-task-id] button[aria-label]')].filter((b) => /\d+ comments?\b/.test(b.getAttribute('aria-label'))).length,
    }))
    await h.assert('A: a private project shows no avatars and no comment counts', { ok: privateSignals.avatars === 0 && privateSignals.counts === 0, detail: JSON.stringify(privateSignals) })
    const firstPrivateId = Number(await page.locator('[data-task-id]').first().getAttribute('data-task-id'))
    const firstPrivate = row(firstPrivateId)
    await firstPrivate.click({ position: { x: 180, y: 12 } })
    await h.wait(700)
    const privateBar = await page.evaluate(() => [...document.querySelectorAll('[data-prop]')].map((b) => b.getAttribute('data-prop')))
    await h.assert('A: a private card has Comments and no Assign', { ok: !privateBar.includes('assign') && privateBar.includes('comments'), detail: privateBar.join(',') })

    // A comment on a private task: a note to yourself, with nothing about other people.
    await firstPrivate.locator('button[data-prop="comments"]').click()
    const privatePane = page.locator('#comments-pane')
    const privateComposer = privatePane.locator('textarea[aria-label="Write a comment"]')
    await until(async () => (await privateComposer.count()) > 0)
    const privatePlaceholder = await privateComposer.getAttribute('placeholder')
    await h.assert('A: the comments pane opens on a private task and offers no mention', { ok: privatePlaceholder === 'Write a comment.', detail: privatePlaceholder })
    await h.assert('A: a private task has no Notify me', { ok: !/Notify me|Notifying you/.test((await privatePane.textContent()) ?? '') })
    await privateComposer.click()
    await h.type('Note to self')
    await h.key('Control+Enter')
    const privateComment = await until(async () => items(await api.call('GET', `/tasks/${firstPrivateId}/comments?per_page=50`)).find((c) => c.comment.includes('Note to self')))
    await h.assert('A: a comment on a private task reaches the server', !!privateComment)
    const privateRead = h.requests().filter((r) => r.url.includes(`/tasks/${firstPrivateId}/read`))
    await h.assert('A: reading it sends no read mark', { ok: privateRead.length === 0, detail: privateRead.map((r) => r.url).join(' | ') })
    await h.capture('comments-pane-private', { clip: { x: 0, y: 0, width: 1280, height: 820 } })
    await privateComposer.focus()
    await h.key('Escape')
    await h.wait(300)
    await h.dismiss()
    const privateCount = await until(async () => (await firstPrivate.locator('button[aria-label*="comment"]').count()) > 0)
    await h.assert('A: the row shows the count', !!privateCount)
    if (privateComment) await api.call('DELETE', `/tasks/${firstPrivateId}/comments/${privateComment.id}`)

    // ---- B. Shared rows -------------------------------------------------------------------------
    const mark = h.requests().length
    await h.goto(`/project/${ids.lisbon}`)
    await until(async () => (await row(flights).locator('[aria-label^="Assigned to"]').count()) > 0)
    const sidebarShared = await aside.locator(`[data-sidebar-project="${ids.lisbon}"]`).evaluate((el) => !!el.querySelector('svg.lucide-users') && /shared with/i.test(el.textContent))
    await h.assert('B: the sidebar row of the shared project has the shared mark', sidebarShared)
    const taskRequests = h.requests(mark).filter((r) => /\/tasks(\?|$)|\/views\/\d+\/tasks/.test(r.url))
    await h.assert('B: task lists ask for comment_count and is_unread', {
      ok: taskRequests.length > 0 && taskRequests.every((r) => r.url.includes('expand=comment_count') && r.url.includes('expand=is_unread')),
      detail: taskRequests.map((r) => r.url.replace(/^.*\/api\/v2/, '')).slice(0, 3).join(' | '),
    })
    const flightsRow = await row(flights).evaluate((el) => ({
      avatars: el.querySelector('[aria-label^="Assigned to"]')?.getAttribute('aria-label'),
      count: [...el.querySelectorAll('button[aria-label]')].map((b) => b.getAttribute('aria-label')).find((l) => /comments?/.test(l)),
    }))
    await h.assert('B: the flights row names its assignees, you first', { ok: flightsRow.avatars === 'Assigned to you, Maya', detail: flightsRow.avatars })
    await h.assert('B: the flights row has an unread comment count', { ok: flightsRow.count === '2 comments, new', detail: flightsRow.count })
    await h.capture('shared-rows', { clip: { x: 0, y: 0, width: 1280, height: 820 } })

    // ---- C. Card: Assign ------------------------------------------------------------------------
    await row(flights).click({ position: { x: 180, y: 12 } })
    await h.wait(700)
    const bar = await row(flights).evaluate((el) => [...el.querySelectorAll('button[data-prop]')].map((b) => ({ prop: b.getAttribute('data-prop'), name: b.getAttribute('aria-label') })))
    const order = bar.map((b) => b.prop)
    await h.assert('C: Assign follows Project, Comments sits before More', {
      ok: order.indexOf('assign') === order.indexOf('project') + 1 && order.indexOf('comments') === order.indexOf('more') - 1 && order.indexOf('attachments') === order.indexOf('assign') + 1,
      detail: order.join(','),
    })
    await h.assert('C: the Assign chip says who is assigned', { ok: bar.find((b) => b.prop === 'assign')?.name === 'Assigned: You, Maya', detail: bar.find((b) => b.prop === 'assign')?.name })
    await row(flights).locator('button[data-prop="assign"]').click()
    await h.wait(450)
    const options = await page.evaluate(() =>
      [...document.querySelectorAll('[role="listbox"]:popover-open [role="option"]')].map((o) => ({ text: o.textContent.trim(), selected: o.getAttribute('aria-selected'), disabled: o.getAttribute('aria-disabled') })),
    )
    await h.assert('C: Assign lists you first, then Maya and Sam', { ok: options.length === 3 && /\(you\)/.test(options[0].text) && /^Maya/.test(options[1].text) && /^Sam/.test(options[2].text), detail: JSON.stringify(options) })
    await h.assert('C: Sam can only view and cannot be picked', { ok: /Can view only/.test(options[2]?.text ?? '') && options[2]?.disabled === 'true', detail: JSON.stringify(options[2]) })
    await h.capture('assign-popover', { clip: { x: 0, y: 0, width: 1280, height: 820 } })
    await page.locator('[role="listbox"]:popover-open [role="option"]', { hasText: 'Maya' }).click()
    const unassigned = await until(async () => !((await api.call('GET', `/tasks/${flights}`)).assignees ?? []).some((a) => a.id === maya.id))
    await h.assert('C: unassigning Maya reaches the server', !!unassigned)
    await page.locator('[role="listbox"]:popover-open [role="option"]', { hasText: 'Maya' }).click()
    const reassigned = await until(async () => ((await api.call('GET', `/tasks/${flights}`)).assignees ?? []).some((a) => a.id === maya.id))
    await h.assert('C: assigning Maya again reaches the server, and the list stays open', { ok: !!reassigned && (await page.locator('[role="listbox"]:popover-open').count()) === 1 })
    await h.key('Escape')
    await h.wait(300)
    await h.dismiss()

    // ---- D. Comments pane ---------------------------------------------------------------------
    await until(async () => (await row(flights).locator('button[aria-label*="comment"]').count()) > 0)
    await row(flights).locator('button[aria-label*="comment"]').click()
    const pane = page.locator('#comments-pane')
    await until(async () => (await pane.count()) > 0 && (await pane.locator('li[aria-label]').count()) >= 2)
    const paneText = (await pane.textContent()) ?? ''
    await h.assert('D: the count opens the card and the comments pane', { ok: (await pane.count()) === 1 && (await row(flights).locator('button[data-prop="comments"]').count()) === 1 })
    await h.assert('D: the pane says who can see the thread', { ok: paneText.includes('Visible to you, Maya and Sam'), detail: paneText.slice(0, 160) })
    const mention = await pane.locator('li[aria-label] p span.text-accent-blue').first().textContent().catch(() => null)
    await h.assert('D: the mention reads as @ and the name, in the accent colour', { ok: /^@/.test(mention ?? ''), detail: mention })
    const read = await until(async () => !(await serverTask(flights)).is_unread)
    await h.assert('D: opening the thread marks the task read on the server', !!read)
    await h.capture('comments-pane', { clip: { x: 0, y: 0, width: 1280, height: 820 } })

    const composer = pane.locator('textarea[aria-label="Write a comment"]')
    await composer.click()
    await h.type('@ma')
    await h.wait(400)
    const picker = await page.evaluate(() => [...document.querySelectorAll('[role="listbox"]:popover-open [role="option"]')].map((o) => o.textContent.trim()))
    await h.assert('D: typing @ma suggests Maya', { ok: picker.length === 1 && /^Maya/.test(picker[0]), detail: JSON.stringify(picker) })
    // A frame can come late on a busy renderer. Hold the frames back until a few letters are in: a
    // caret placed in a frame would then jump back over them and the rest would go in before them.
    await page.evaluate(() => {
      window.__realRaf = window.requestAnimationFrame
      window.__heldFrames = []
      window.requestAnimationFrame = (callback) => window.__heldFrames.push(callback)
    })
    await h.key('Enter')
    await h.type('see ')
    await page.evaluate(() => {
      const held = window.__heldFrames
      window.requestAnimationFrame = window.__realRaf
      delete window.__realRaf
      delete window.__heldFrames
      for (const callback of held) callback(performance.now())
    })
    await h.type('you at the gate')
    await h.assert('D: Enter in the picker inserts the username', { ok: (await composer.inputValue()) === `@${maya.username} see you at the gate`, detail: await composer.inputValue() })
    const before = items(await api.call('GET', `/tasks/${flights}/comments?per_page=50`)).length
    await h.key('Control+Enter')
    const posted = await until(async () => {
      const list = items(await api.call('GET', `/tasks/${flights}/comments?per_page=50`))
      return list.length > before ? list.find((c) => c.comment.includes('see you at the gate')) : undefined
    })
    await h.assert('D: Ctrl+Enter posts the comment with a mention element', { ok: !!posted && posted.comment.includes(`<mention-user data-id="${maya.username}"`), detail: posted?.comment })
    await h.assert('D: the composer is empty after sending', (await composer.inputValue()) === '')

    await composer.focus()
    await h.key('Escape')
    await h.wait(300)
    const afterEscape = await page.evaluate((id) => ({ pane: !!document.getElementById('comments-pane'), focus: document.activeElement?.id === `task-${id}-comments` }), flights)
    await h.assert('D: Escape closes the pane and focus returns to the Comments button', { ok: !afterEscape.pane && afterEscape.focus, detail: JSON.stringify(afterEscape) })
    await h.key('Control+Shift+C')
    await h.wait(400)
    await h.assert('D: Ctrl+Shift+C opens the pane again', (await pane.count()) === 1)
    const paneAxe = await h.axe('#comments-pane', { label: 'comments pane' })
    await h.assert('D: the pane has no serious accessibility problems', { ok: !paneAxe.some((v) => v.impact === 'serious' || v.impact === 'critical'), detail: paneAxe.map((v) => v.id).join(',') })
    await h.key('Control+Shift+C')
    await h.wait(300)
    await h.dismiss()

    // ---- E. Share dialog ------------------------------------------------------------------------
    await aside.locator(`[data-project-row="sidebar:${ids.lisbon}"]`).click({ button: 'right' })
    await h.wait(300)
    await page.getByRole('menuitem', { name: 'Share' }).click()
    const dialog = page.locator('dialog[open]')
    await until(async () => (await dialog.locator('li').count()) >= 3)
    const people = await dialog.locator('li').allTextContents()
    await h.assert('E: the dialog lists the owner, Maya and Sam', { ok: /Owner/.test(people[0] ?? '') && people.some((p) => /Maya/.test(p)) && people.some((p) => /Sam/.test(p)), detail: people.join(' | ') })
    const permissions = await dialog.locator('select[aria-label^="Permission for"]').evaluateAll((els) => els.map((e) => `${e.getAttribute('aria-label')}=${e.value}`))
    await h.assert('E: Maya can edit, Sam can view', { ok: permissions.includes('Permission for Maya=1') && permissions.includes('Permission for Sam=0'), detail: permissions.join(',') })
    await h.capture('share-dialog', { clip: { x: 0, y: 0, width: 1280, height: 820 } })
    await dialog.getByRole('button', { name: 'Remove Sam' }).click()
    const removed = await until(async () => !(await shares()).some((u) => u.id === sam.id))
    await h.assert('E: removing Sam reaches the server', !!removed)
    await dialog.getByRole('button', { name: 'Undo' }).click()
    const back = await until(async () => (await shares()).find((u) => u.id === sam.id))
    await h.assert('E: Undo in the dialog shares the project with Sam again, with the same permission', { ok: back?.permission === 0, detail: JSON.stringify(back) })
    await dialog.getByRole('button', { name: 'Done' }).click()
    await h.wait(300)

    // ---- F. Unshared again --------------------------------------------------------------------
    await aside.locator(`[data-project-row="sidebar:${ids.lisbon}"]`).click({ button: 'right' })
    await h.wait(300)
    await page.getByRole('menuitem', { name: 'Share' }).click()
    await until(async () => (await dialog.locator('li').count()) >= 3)
    for (const name of ['Maya', 'Sam']) {
      await dialog.getByRole('button', { name: `Remove ${name}` }).click()
      await h.wait(600)
    }
    await until(async () => (await shares()).length === 0)
    await dialog.getByRole('button', { name: 'Done' }).click()
    const unmarked = await until(async () => !(await aside.locator(`[data-sidebar-project="${ids.lisbon}"] svg.lucide-users`).count()), 10000)
    await h.assert('F: with no shares left the shared mark goes', !!unmarked)
    const quiet = h.requests().length
    await h.goto('/upcoming')
    await h.wait(800)
    await h.goto('/anytime')
    await h.wait(800)
    const later = h.requests(quiet).filter((r) => /\/tasks(\?|$)|\/views\/\d+\/tasks/.test(r.url))
    await h.assert('F: with nothing shared, task lists still ask for the comment signals', {
      ok: later.length > 0 && later.every((r) => r.url.includes('expand=comment_count')),
      detail: later.map((r) => r.url.replace(/^.*\/api\/v2/, '')).slice(0, 3).join(' | '),
    })
  } finally {
    await restore()
  }
}
