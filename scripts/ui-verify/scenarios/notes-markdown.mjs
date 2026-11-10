// notes-markdown: Markdown typed or pasted into a card's notes (description format, "Markdown input";
// rendyhd/Vicu#66), in the running app.
//
//   A. Pasting a Markdown link (plain text on the clipboard) makes a link in the current line.
//   B. Pasting a Markdown document makes headings, lists, a checklist, a quote, code and a divider.
//   C. Plain text and text that comes with HTML paste as before; Shift+Ctrl+V pastes plain.
//   D. Typing the shortcuts at the start of a line and the inline markers formats the text.
//   E. What reaches the server is the description HTML.

export const meta = {
  id: 'MD',
  wave: 3,
  title: 'Notes: Markdown paste and typing shortcuts',
}

const DOC = [
  '# Plan',
  '',
  'Some **bold** and a [link](https://example.com/docs).',
  '',
  '- one',
  '  - nested',
  '- [ ] todo',
  '- [x] done',
  '',
  '1. first',
  '2. second',
  '',
  '> quoted',
  '',
  '```',
  'const a = 1 < 2',
  '```',
  '',
  '---',
].join('\n')

export default async function run(h) {
  const { page, app } = h
  await h.resize(1280, 820)
  const task = await h.api('POST', `/projects/${h.ids.inbox}/tasks`, {
    title: 'Notes markdown scratch task',
    description: '<p>Start</p>',
  })

  const setClipboard = (text, html) =>
    app.evaluate(
      ({ clipboard, ClipboardItem }, [t, x]) =>
        x ? clipboard.write([new ClipboardItem({ 'text/plain': t, 'text/html': x })]) : clipboard.writeText(t),
      [text, html],
    )
  const notes = page.locator('.ProseMirror').first()
  const notesHtml = () => notes.evaluate((el) => el.innerHTML)
  const clearNotes = async () => {
    await notes.click()
    await h.key('Control+a')
    await h.key('Delete')
    await h.wait(100)
  }

  try {
    await h.goto('/inbox')
    await h.key('F5')
    await h.wait(800)
    await page.locator(`[data-task-id="${task.id}"]`).first().click()
    await h.wait(600)

    // ---- A. A link into the current line -------------------------------------------------------
    await notes.click()
    await h.key('End')
    await page.keyboard.type(' see ')
    await setClipboard('[Link Text](http://www.example.com)')
    await h.key('Control+v')
    await h.wait(200)
    let html = await notesHtml()
    await h.assert('a pasted Markdown link is a link in the same line', {
      ok: /<p>Start see <a [^>]*href="http:\/\/www\.example\.com"[^>]*>Link Text<\/a><\/p>/.test(html),
      detail: html,
    })

    // ---- B. A document -------------------------------------------------------------------------
    await clearNotes()
    await setClipboard(DOC)
    await h.key('Control+v')
    await h.wait(300)
    html = await notesHtml()
    const has = (label, re) => h.assert(label, { ok: re.test(html), detail: html })
    await has('heading', /<h1>Plan<\/h1>/)
    await has('bold and link in a paragraph', /<p>Some <strong>bold<\/strong> and a <a [^>]*href="https:\/\/example\.com\/docs"[^>]*>link<\/a>\.<\/p>/)
    await has('nested bullet list', /<ul><li><p>one<\/p><ul><li><p>nested<\/p><\/li><\/ul><\/li><\/ul>/)
    await has('checklist with a ticked item', /data-type="taskList".*data-checked="false".*todo.*data-checked="true".*done/s)
    await has('numbered list', /<ol><li><p>first<\/p><\/li><li><p>second<\/p><\/li><\/ol>/)
    await has('quote', /<blockquote><p>quoted<\/p><\/blockquote>/)
    await has('code block', /<pre><code>const a = 1 &lt; 2<\/code><\/pre>/)
    await has('divider', /<hr/)
    await h.capture('pasted-document')

    // ---- C. Not Markdown -----------------------------------------------------------------------
    await clearNotes()
    await setClipboard('Plain *words* stay', '<p>Plain *words* stay</p>')
    await h.key('Control+v')
    await h.wait(200)
    html = await notesHtml()
    await h.assert('text that comes with HTML pastes as before', { ok: !/<em>/.test(html) && html.includes('Plain *words* stay'), detail: html })
    await clearNotes()
    await setClipboard('Plain **words** stay')
    await h.key('Control+Shift+v')
    await h.wait(200)
    html = await notesHtml()
    await h.assert('Shift+Ctrl+V pastes Markdown as plain text', { ok: !/<strong>/.test(html) && html.includes('**words**'), detail: html })

    // ---- D. Typing -----------------------------------------------------------------------------
    await clearNotes()
    const type = (text) => page.keyboard.type(text, { delay: 30 })
    await type('## Head')
    await h.key('Enter')
    await type('Some **bold** and *it* and ~~gone~~ and `code` and [a link](https://example.com) end')
    await h.key('Enter')
    await type('> quote')
    await h.key('Enter')
    await h.key('Enter')
    await type('- bullet')
    await h.key('Enter')
    await h.key('Enter')
    await type('1) numbered')
    await h.key('Enter')
    await h.key('Enter')
    await type('[ ] check')
    await h.key('Enter')
    await h.key('Enter')
    await type('- [ ] dash check')
    await h.key('Enter')
    await h.key('Enter')
    await type('---')
    await h.wait(300)
    html = await notesHtml()
    await has('typed heading', /<h2>Head<\/h2>/)
    await has('typed bold', /<strong>bold<\/strong>/)
    await has('typed italic', /<em>it<\/em>/)
    await has('typed strike', /<s>gone<\/s>/)
    await has('typed code', /<code>code<\/code>/)
    await has('typed link', /<a [^>]*href="https:\/\/example\.com"[^>]*>a link<\/a> end/)
    await has('typed quote', /<blockquote><p>quote<\/p><\/blockquote>/)
    await has('typed bullet', /<ul><li><p>bullet<\/p><\/li><\/ul>/)
    await has('typed 1) list', /<ol[^>]*><li><p>numbered<\/p><\/li><\/ol>/)
    await has('typed checklist', /data-type="taskList".*check<\/p>/s)
    await has('typed - [ ] checklist', /data-type="taskList"(?:(?!<ul>).)*dash check/s)
    await has('typed divider', /<hr/)
    await h.capture('typed')

    // ---- E. Saved ------------------------------------------------------------------------------
    await h.key('Escape')
    await h.wait(1500)
    const saved = (await h.api('GET', `/tasks/${task.id}`)).description ?? ''
    await h.assert('the server has the HTML', { ok: /<h2>Head<\/h2>/.test(saved) && /<strong>bold<\/strong>/.test(saved), detail: saved })
  } finally {
    await h.api('DELETE', `/tasks/${task.id}`).catch(() => {})
  }
}
