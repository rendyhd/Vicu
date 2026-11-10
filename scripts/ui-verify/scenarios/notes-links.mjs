// notes-links: typing in a card's notes next to a link, in the running app (rendyhd/Vicu#67).
//
// The editor used to write `target` and `rel` on links, the storage sanitizer dropped them, and
// the editor then reset its document on every keystroke, so a space typed after a link vanished.
//
//   A. Typing a sentence on a new line under a link keeps every space.
//   B. Typing right after the link, on its line, keeps the space too.
//   C. The saved description has the words outside the link, and its link has no target or rel.

export const meta = {
  id: 'NL',
  wave: 3,
  title: 'Notes: spaces typed after a link are kept and saved',
}

export default async function run(h) {
  const { page } = h
  await h.resize(1280, 820)
  const task = await h.api('POST', `/projects/${h.ids.inbox}/tasks`, {
    title: 'Notes link scratch task',
    description: '<p>See <a href="https://example.com">example</a></p>',
  })

  try {
    await h.goto('/inbox')
    await h.key('F5') // the task was made behind the app's back
    await h.wait(800)
    await page.locator(`[data-task-id="${task.id}"]`).first().click()
    await h.wait(600)

    const notes = page.locator('.ProseMirror').first()
    await notes.locator('a').first().click({ modifiers: [] })
    await h.wait(100)

    // ---- A. A new line under the link ---------------------------------------------------------
    // ProseMirror reads a caret move on the next selectionchange: a person never presses the
    // next key within the same few milliseconds.
    await h.key('End')
    await h.wait(150)
    await h.key('Enter')
    await page.keyboard.type('hello world again', { delay: 40 })
    await h.wait(200)
    let text = await notes.innerText()
    await h.assert('a sentence typed under a link keeps its spaces', {
      ok: text.includes('hello world again'),
      detail: JSON.stringify(text),
    })

    // ---- B. Right after the link ---------------------------------------------------------------
    await h.key('ArrowUp')
    await h.wait(150)
    await h.key('End')
    await h.wait(150)
    await page.keyboard.type(' and more', { delay: 40 })
    await h.wait(200)
    text = await notes.innerText()
    await h.assert('words typed right after a link keep their spaces', {
      ok: text.includes(' and more'),
      detail: JSON.stringify(text),
    })
    await h.capture('typed')

    // ---- C. Saved ------------------------------------------------------------------------------
    await h.key('Escape')
    await h.wait(1500)
    const saved = await h.api('GET', `/tasks/${task.id}`)
    const description = saved.description ?? ''
    await h.assert('the saved notes have the words', {
      ok: description.includes('hello world again') && description.includes(' and more'),
      detail: description,
    })
    await h.assert('words typed after the link are not part of it', {
      ok: description.includes('<a href="https://example.com">example</a> and more'),
      detail: description,
    })
    await h.assert('the saved link has no target or rel', {
      ok: !/<a [^>]*(target|rel)=/.test(description),
      detail: description,
    })
  } finally {
    await h.api('DELETE', `/tasks/${task.id}`).catch(() => {})
  }
}
