// The reference set of captures: every main view, the card and its date popover, the composer with
// parsed text, the context menu, and the two popup windows. 16 captures per theme.
export const meta = {
  id: 'baseline',
  wave: null,
  title: 'Inbox, Today, Upcoming, Anytime, Logbook, Review, Routines, Settings, project, tag, card, date popover, composer, context menu, Quick Entry, Quick View',
}

export default async function run(h) {
  const files = []
  const shot = async (name, opts) => files.push(await h.capture(name, opts))

  // The main views
  const views = [
    ['inbox', '/inbox'],
    ['today', '/today'],
    ['upcoming', '/upcoming'],
    ['anytime', '/anytime'],
    ['logbook', '/logbook'],
    ['review', '/review'],
    ['routines', '/routines'],
    ['settings', '/settings'],
    ['project', `/project/${h.ids.website}`],
    ['tag', `/tag/${h.ids.labels['deep work']}`],
  ]
  for (const [name, route] of views) {
    await h.goto(route)
    await shot(name)
  }

  // An open card
  await h.goto('/today')
  await h.click('Draft Q4 roadmap')
  await h.wait(900)
  await shot('open-card')
  await h.dismiss()

  // The date popover on the last Today row
  await h.goto('/today')
  const last = h.lastRow()
  const taskId = await last.getAttribute('data-task-id')
  await last.click({ position: { x: 180, y: 12 } })
  await h.wait(700)
  await h.click(`[data-task-id="${taskId}"] button[title="Schedule"]`)
  await h.wait(500)
  await shot('date-popover')
  await h.dismiss()

  // The composer with a parsed title (Vikunja syntax: *label, !priority)
  await h.goto('/today')
  await h.click('button[aria-label="New task"]')
  await h.wait(400)
  await h.type('Call Ana about the weekend tomorrow at 3pm *call !3')
  await h.wait(900)
  await shot('composer')
  await h.dismiss()

  // The context menu on a row
  await h.goto('/today')
  await h.rightClick('Book flights to Lisbon')
  await h.wait(500)
  await shot('context-menu')
  await h.dismiss()

  // Quick Entry with parsed text, and Quick View
  const qe = await h.showQuick('entry')
  await h.wait(800)
  await qe.keyboard.type('Pick up dry cleaning friday *errand', { delay: 25 })
  await h.wait(800)
  await shot('quick-entry', { page: qe, transparent: true })
  await qe.keyboard.press('Escape')
  await h.hideQuick('entry')

  const qv = await h.showQuick('view')
  await qv.getByText('Renew passport').first().waitFor({ timeout: 10000 }).catch(() => {})
  await h.wait(1200)
  await shot('quick-view', { page: qv, transparent: true })
  await qv.keyboard.press('Escape')
  await h.hideQuick('view')

  await h.assert('16 captures', { ok: files.length === 16, detail: files.length })
}
