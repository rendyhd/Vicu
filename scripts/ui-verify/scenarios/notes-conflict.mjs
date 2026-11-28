// notes-conflict: notes changed in two places (description format, "Synchronization", "Notes changed
// in two places"), in the running app.
//
//   A. A card's notes are edited while another device changes the same notes behind the app's back;
//      leaving the card saves, and the server keeps both versions: the other device's, a divider,
//      then this one's.
//   B. The app says so once, in a toast with the contract's words.
//   C. The open card shows the merged notes.
//   D. A plain edit afterwards (nobody else changed the notes) is saved as it is, without a divider.

export const meta = {
  id: 'NCF',
  wave: 3,
  title: 'Notes: an edit made on two devices keeps both versions',
}

const MESSAGE = 'Notes were also changed on another device. Both versions are kept.'

export default async function run(h) {
  const { page } = h
  await h.resize(1280, 820)
  const task = await h.api('POST', `/projects/${h.ids.inbox}/tasks`, {
    title: 'Notes conflict scratch task',
    description: '<p>Shopping</p>',
  })

  const row = page.locator(`[data-task-id="${task.id}"]`).first()
  const notes = page.locator('.ProseMirror').first()
  const stored = async () => (await h.api('GET', `/tasks/${task.id}`)).description ?? ''

  try {
    await h.goto('/inbox')
    await h.key('F5') // the task was made behind the app's back
    await h.wait(1000)
    await row.click()
    await h.wait(700)

    // ---- A. Two devices change the notes -------------------------------------------------------
    await notes.click()
    await h.key('End')
    await page.keyboard.type(' milk', { delay: 30 })
    await h.wait(200)
    // The other device saves first.
    await h.api('PATCH', `/tasks/${task.id}`, { description: '<p>Shopping: bread</p>' })
    await h.capture('typing')

    // Leaving the card saves.
    await h.key('Escape')
    await h.wait(2000)
    const merged = await stored()
    await h.assert('the server keeps both versions, theirs first, divided by <hr>', {
      ok: /Shopping: bread.*<hr>.*Shopping milk/s.test(merged),
      detail: merged,
    })
    await h.assert('neither version is lost', { ok: merged.includes('bread') && merged.includes('milk'), detail: merged })

    // ---- B. The toast --------------------------------------------------------------------------
    const toastCount = await page.getByText(MESSAGE, { exact: true }).count()
    await h.assert('a toast says the notes were also changed on another device', { ok: toastCount >= 1, detail: String(toastCount) })
    await h.capture('merged-toast')

    // ---- C. The card shows the merged notes ----------------------------------------------------
    await row.click()
    await h.wait(700)
    const shown = await notes.evaluate((el) => el.innerHTML)
    await h.assert('the open card shows both versions', {
      ok: shown.includes('bread') && shown.includes('milk') && /<hr/.test(shown),
      detail: shown,
    })

    // ---- D. A plain edit afterwards ------------------------------------------------------------
    // Click the last line (a click on the divider would select it, and typing would replace it).
    await notes.locator('p').last().click()
    await h.key('End')
    await page.keyboard.type(' eggs', { delay: 30 })
    await h.key('Escape')
    await h.wait(2000)
    const after = await stored()
    await h.assert('a later edit with no other change is saved as it is (one divider)', {
      ok: after.includes('eggs') && (after.match(/<hr/g) ?? []).length === 1,
      detail: after,
    })
  } finally {
    await h.api('DELETE', `/tasks/${task.id}`).catch(() => {})
  }
}
