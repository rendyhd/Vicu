// comment-files: files in a comment (docs/cross-app-semantics-v1.md section 9.5, "Attachments in a comment").
//
//   A. Paste an image: a chip at once, Comment waits for the upload, the file is on the task. Pasting
//      text is left alone.
//   B. The paperclip (the file dialog, stubbed) and a drop add files; Remove takes one out and off the
//      task, also while it is still uploading. Closing the pane keeps the chips.
//   C. Comment sends the exact HTML of the contract: text, <img> for the image, <p><a> for the rest.
//   D. The thread: a 200 px preview from the server's preview, file rows with name, size, Open and Save.
//   E. The preview opens the viewer with the original; Escape closes the viewer only.
//   F. Open and Save go through the main process (shell and the save dialog, stubbed).
//   G. An edit keeps the files, also with the text emptied; the files show while editing.
//   H. What another app wrote: data-src, an address on another host, a file of another task and an
//      "image" that is not one; nothing is fetched from a comment's own address.
//   I. A file newer than the list read before: "No longer available" must not flash.
//   J. The delete question says the files stay, and they do.
//   K. A file deleted from the task: its row says "No longer available", with no buttons.
//   L. A screenshot on the real clipboard and Ctrl+V, where A dispatches the paste.
//
// It works on one throwaway task in the shared project, deleted at the end. Run it alone:
// --scenario comment-files.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { API_URL, readApiToken, SERVER_URL } from '../lib.mjs'

export const meta = {
  id: 'CF',
  wave: null,
  title: 'Files in comments: paste, pick and drop, inline previews, the viewer, Open and Save, edit keeps them, gone files',
}

const items = (res) => (Array.isArray(res) ? res : (res?.items ?? []))

const COMPOSER = 'textarea[aria-label="Write a comment"]'
const GONE = 'No longer available'
/** The open thread is read again each minute; a little longer than that. */
const THREAD_REFRESH_WAIT_MS = 75000

/** A PNG drawn in the page, so the original can be told from the preview by its size. */
const drawPng = (page, width, height, label) =>
  page.evaluate(
    async ([w, hgt, text]) => {
      const canvas = new OffscreenCanvas(w, hgt)
      const ctx = canvas.getContext('2d')
      const gradient = ctx.createLinearGradient(0, 0, w, hgt)
      gradient.addColorStop(0, '#0a66d1')
      gradient.addColorStop(1, '#2bb673')
      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, w, hgt)
      ctx.fillStyle = '#fff'
      ctx.font = `bold ${Math.round(hgt / 8)}px sans-serif`
      ctx.fillText(text, w / 20, hgt / 2)
      const blob = await canvas.convertToBlob({ type: 'image/png' })
      return Array.from(new Uint8Array(await blob.arrayBuffer()))
    },
    [width, height, label],
  )

const bytesOf = (text) => Array.from(new TextEncoder().encode(text))

/** A paste on the composer, as the browser sends it; says what was stopped and how Comment looks right after. */
const paste = (page, files, text = null) =>
  page.evaluate(
    async ([selector, list, plain]) => {
      const data = new DataTransfer()
      for (const { name, type, bytes } of list) data.items.add(new File([new Uint8Array(bytes)], name, { type }))
      if (plain) data.setData('text/plain', plain)
      const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })
      document.querySelector(selector).dispatchEvent(event)
      await new Promise((resolve) => setTimeout(resolve, 0))
      const button = [...document.querySelectorAll('#comments-pane button')].find((b) => b.textContent.trim() === 'Comment')
      return { prevented: event.defaultPrevented, commentDisabled: !!button?.disabled }
    },
    [COMPOSER, files, text],
  )

/** Files dragged in from the system onto the composer. */
const drop = (page, files) =>
  page.evaluate(
    ([selector, list]) => {
      const data = new DataTransfer()
      for (const { name, type, bytes } of list) data.items.add(new File([new Uint8Array(bytes)], name, { type }))
      const target = document.querySelector(selector)
      for (const type of ['dragenter', 'dragover', 'drop']) {
        target.dispatchEvent(new DragEvent(type, { dataTransfer: data, bubbles: true, cancelable: true }))
      }
    },
    [COMPOSER, files],
  )

export default async function run(h) {
  const page = h.page
  await h.resize(1280, 860)
  await h.dismiss()
  const theme = (await page.evaluate(() => document.documentElement.classList.contains('dark'))) ? 'dark' : 'light'

  const dir = mkdtempSync(join(tmpdir(), 'vicu-comment-files-'))
  const notesPath = join(dir, 'notes.txt')
  const savedPath = join(dir, 'saved copy.txt')
  const NOTES = 'Budget notes for the trip.'
  writeFileSync(notesPath, NOTES)

  const task = await h.api('POST', `/projects/${h.ids.lisbon}/tasks`, { title: 'CF files in comments' })
  const address = (id) => `${SERVER_URL}/api/v1/tasks/${task.id}/attachments/${id}`
  const onTask = async () => items(await h.api('GET', `/tasks/${task.id}/attachments`))
  const named = async (name) => (await onTask()).find((a) => a.file.name === name) ?? null
  const comments = async () => items(await h.api('GET', `/tasks/${task.id}/comments`))
  const until = async (fn, ms = 15000) => {
    const end = Date.now() + ms
    let last
    while (Date.now() < end) {
      last = await fn()
      if (last) return last
      await h.wait(200)
    }
    return last
  }

  const pane = page.locator('#comments-pane')
  const composer = pane.locator(COMPOSER)
  const chips = pane.locator('ul[aria-label="Files in this comment"] li')
  const commentButton = pane.locator('button', { hasText: /^Comment$/ })
  const thread = pane.locator('ol[aria-label="Comments"]')
  // The day dividers are list items too; a comment's item has a name.
  const threadComments = thread.locator('li[aria-label]')

  const openThread = async () => {
    await h.goto(`/project/${h.ids.lisbon}`)
    await h.dismiss()
    const row = page.locator(`[data-task-id="${task.id}"]`)
    await row.scrollIntoViewIfNeeded()
    await row.click({ position: { x: 180, y: 12 } })
    await h.wait(600)
    if (!(await composer.isVisible().catch(() => false))) {
      await page.locator(`[data-task-id="${task.id}"] button[data-prop="comments"]`).click()
    }
    await composer.waitFor({ timeout: 10000 })
  }
  const uploaded = () => until(async () => (await pane.locator('[aria-label^="Uploading "]').count()) === 0)

  // Anything fetched from an address in a comment would show here.
  const elsewhere = []
  const onRequest = (request) => {
    if (request.url().includes('example.invalid')) elsewhere.push(request.url())
  }
  page.on('request', onRequest)

  // The system's dialogs and the default app are stand-ins: the rest of the way is the real one.
  await h.app.evaluate(({ dialog, shell }, [open, save]) => {
    globalThis.__cf = { open: dialog.showOpenDialog, save: dialog.showSaveDialog, openPath: shell.openPath, opened: [] }
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [open] })
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: save })
    shell.openPath = async (path) => {
      globalThis.__cf.opened.push(path)
      return ''
    }
  }, [notesPath, savedPath])

  try {
    const board = await drawPng(page, 1200, 800, 'Whiteboard')
    await openThread()

    // ---- A. Paste ---------------------------------------------------------------------------
    await composer.click()
    await h.type('Here are the files')
    const textPaste = await paste(page, [], 'plain text')
    await h.assert('A: pasting text is left to the text box', { ok: !textPaste.prevented, detail: JSON.stringify(textPaste) })

    const pasted = await paste(page, [{ name: 'board.png', type: 'image/png', bytes: board }])
    await h.assert('A: pasting an image is taken, and Comment waits for the upload', {
      ok: pasted.prevented && pasted.commentDisabled,
      detail: JSON.stringify(pasted),
    })
    await h.assert('A: it has a chip with its name at once', { ok: (await chips.count()) === 1 && (await chips.first().textContent()).includes('board.png') })
    await h.assert('A: the upload finishes and Comment can be pressed', async () => {
      const done = await uploaded()
      return { ok: !!done && (await commentButton.isEnabled()) }
    })
    await h.assert('A: the file is on the task already', async () => ({ ok: !!(await until(() => named('board.png'))) }))

    // ---- B. Pick, drop, remove --------------------------------------------------------------
    await pane.locator('button[aria-label="Attach files"]').click()
    await until(async () => (await chips.count()) === 2)
    await h.assert('B: the paperclip adds what the file dialog picked', {
      ok: (await chips.nth(1).textContent()).includes('notes.txt') && !!(await until(() => named('notes.txt'))),
      detail: await chips.allTextContents().then((t) => t.join(' | ')),
    })

    await drop(page, [{ name: 'dropped.txt', type: 'text/plain', bytes: bytesOf('dropped on the composer') }])
    await until(async () => (await chips.count()) === 3)
    await uploaded()
    await h.assert('B: a dropped file is added', { ok: !!(await until(() => named('dropped.txt'))) })

    await paste(page, [{ name: 'extra.png', type: 'image/png', bytes: board }])
    await uploaded()
    await until(() => named('extra.png'))
    await pane.locator('button[aria-label="Remove extra.png"]').click()
    await h.assert('B: Remove takes the chip away and the file off the task', async () => ({
      ok: (await chips.count()) === 3 && !!(await until(async () => !(await named('extra.png')))),
    }))

    await paste(page, [{ name: 'race.png', type: 'image/png', bytes: board }])
    await pane.locator('button[aria-label="Remove race.png"]').click()
    await uploaded()
    await h.wait(1500)
    await h.assert('B: a file removed while it uploads does not stay on the task', async () => ({
      ok: (await chips.count()) === 3 && !(await named('race.png')),
      detail: (await onTask()).map((a) => a.file.name).join(', '),
    }))
    await h.capture(`composer-chips-${theme}`, { clip: pane })
    await h.axe('#comments-pane', { label: 'composer with files' })

    await pane.locator('button[aria-label="Close comments"]').click()
    await h.wait(300)
    await page.locator(`[data-task-id="${task.id}"] button[data-prop="comments"]`).click()
    await composer.waitFor({ timeout: 5000 })
    await h.assert('B: closing the pane keeps the text and the chips', {
      ok: (await chips.count()) === 3 && (await composer.inputValue()) === 'Here are the files',
    })

    // ---- C. Send ----------------------------------------------------------------------------
    const boardFile = await named('board.png')
    const notesFile = await named('notes.txt')
    const droppedFile = await named('dropped.txt')
    await commentButton.click()
    const links = `<p><a href="${address(notesFile.id)}">notes.txt</a></p><p><a href="${address(droppedFile.id)}">dropped.txt</a></p>`
    const image = `<img src="${address(boardFile.id)}" alt="board.png">`
    const sent = await until(async () => (await comments())[0])
    await h.assert('C: the server has the HTML of the contract', {
      ok: sent?.comment === `<p>Here are the files</p>${image}${links}`,
      detail: sent?.comment,
    })
    await h.assert('C: the composer is empty again', { ok: (await chips.count()) === 0 && (await composer.inputValue()) === '' })

    // ---- D. The thread ----------------------------------------------------------------------
    const preview = thread.locator('button[aria-label="View board.png"]')
    await preview.waitFor({ timeout: 10000 })
    await until(() => preview.evaluate((b) => b.querySelector('img')?.complete && b.querySelector('img').naturalWidth > 0))
    await h.settle()
    const shown = await preview.evaluate((b) => {
      const img = b.querySelector('img')
      const box = b.getBoundingClientRect()
      const list = b.closest('ol').getBoundingClientRect()
      return { h: Math.round(box.height), w: Math.round(box.width), inside: box.right <= list.right + 1, src: img.src, natural: img.naturalWidth }
    })
    await h.assert('D: the preview is 200 px high, keeps the image\'s shape and stays in the pane', {
      ok: shown.h === 200 && shown.w > 200 && shown.w <= 300 && shown.inside,
      detail: JSON.stringify(shown),
    })
    await h.assert('D: it is the server\'s preview through the app, not the original', {
      ok: shown.src.startsWith('blob:') && shown.natural < 1200,
      detail: JSON.stringify(shown),
    })
    await h.assert('D: the files have a row with their name and size, Open and Save', async () => {
      const text = await thread.locator('button[title="Open"]:has-text("notes.txt")').textContent()
      return {
        ok: /notes\.txt\s*\d+(\.\d+)? (B|KB|MB)/.test(text) && (await thread.locator('button[aria-label="Save notes.txt"]').count()) === 1,
        detail: text,
      }
    })
    await h.assert('D: nothing says a file is gone', { ok: (await pane.getByText(GONE).count()) === 0 })
    await h.capture(`thread-${theme}`, { clip: pane })
    await h.axe('#comments-pane', { label: 'comments pane with files' })

    // ---- E. The viewer ----------------------------------------------------------------------
    await preview.click()
    await page.waitForFunction(() => [...document.querySelectorAll('dialog[open] img')].at(-1)?.naturalWidth === 1200, null, { timeout: 15000 }).catch(() => {})
    const viewing = await page.evaluate(() => {
      const dialog = [...document.querySelectorAll('dialog[open]')].at(-1)
      return { title: dialog?.querySelector('h2')?.textContent ?? null, natural: dialog?.querySelector('img')?.naturalWidth ?? null }
    })
    await h.assert('E: the preview opens the viewer with the original', { ok: viewing.title === 'board.png' && viewing.natural === 1200, detail: JSON.stringify(viewing) })
    await h.key('Escape')
    await h.wait(400)
    const afterViewer = await page.evaluate(() => ({
      dialog: !!document.querySelector('dialog[open]'),
      pane: !!document.querySelector('#comments-pane'),
      focus: document.activeElement?.getAttribute('aria-label') ?? null,
    }))
    await h.assert('E: Escape closes the viewer only and focus goes back to the preview', {
      ok: !afterViewer.dialog && afterViewer.pane && afterViewer.focus === 'View board.png',
      detail: JSON.stringify(afterViewer),
    })

    // ---- F. Open and Save -------------------------------------------------------------------
    await thread.locator('button[title="Open"]:has-text("notes.txt")').click()
    const opened = await until(async () => (await h.app.evaluate(() => globalThis.__cf.opened)).at(-1))
    await h.assert('F: Open hands the downloaded file to the default app', {
      ok: !!opened && opened.endsWith('notes.txt') && readFileSync(opened, 'utf8') === NOTES,
      detail: opened,
    })
    await thread.locator('button[aria-label="Save notes.txt"]').click()
    await h.assert('F: Save writes the file where the dialog says', async () => {
      const done = await until(() => existsSync(savedPath) && readFileSync(savedPath, 'utf8') === NOTES)
      return { ok: !!done, detail: savedPath }
    })

    // ---- G. Edit ----------------------------------------------------------------------------
    const edit = async () => {
      await threadComments.first().hover()
      await threadComments.first().locator('button[aria-label="Edit comment"]').click()
      return thread.locator('textarea[aria-label="Edit comment"]')
    }
    let editor = await edit()
    await h.assert('G: the editor has the text alone, with the files shown under it', {
      ok: (await editor.inputValue()) === 'Here are the files' && (await thread.locator('button[title="Open"]:has-text("notes.txt")').count()) === 1 && (await preview.count()) === 1,
      detail: await editor.inputValue(),
    })
    await editor.fill('The files for the trip')
    await thread.locator('button', { hasText: /^Save$/ }).click()
    await h.assert('G: an edit changes the text and keeps the files', async () => {
      const edited = await until(async () => {
        const now = (await comments())[0]
        return now?.comment.startsWith('<p>The files') ? now : null
      })
      return { ok: edited?.comment === `<p>The files for the trip</p>${image}${links}`, detail: edited?.comment }
    })
    await h.wait(400)
    editor = await edit()
    await editor.fill('')
    await h.assert('G: Save stays on with no text when the comment has files', { ok: await thread.locator('button', { hasText: /^Save$/ }).isEnabled() })
    await thread.locator('button', { hasText: /^Save$/ }).click()
    await h.assert('G: the text can go, the files stay', async () => {
      const edited = await until(async () => {
        const now = (await comments())[0]
        return now?.comment.startsWith('<img') ? now : null
      })
      return { ok: edited?.comment === `${image}${links}`, detail: edited?.comment }
    })

    // ---- H. What another app wrote ----------------------------------------------------------
    await h.api('POST', `/tasks/${task.id}/comments`, {
      comment:
        `<p>From the web</p><img data-src="${SERVER_URL}/api/v2/tasks/${task.id}/attachments/${boardFile.id}" src="https://example.invalid/placeholder.png" alt="">` +
        `<img src="https://example.invalid/tracker.png" alt="tracker">` +
        `<img src="${SERVER_URL}/api/v1/tasks/999999/attachments/${boardFile.id}" alt="other task">` +
        `<p><a href="https://example.invalid/tasks/${task.id}/attachments/${notesFile.id}?x=1">a link</a></p>` +
        `<img src="${address(droppedFile.id)}" alt="not a picture">`,
    })
    // Comments are never pushed: another app's arrives when the open thread is read again, each minute.
    const foreign = threadComments.filter({ hasText: 'From the web' })
    await foreign.waitFor({ timeout: THREAD_REFRESH_WAIT_MS }).catch(() => {})
    await h.capture(`from-another-app-${theme}`, { clip: pane })
    await h.assert('H: the comment is in the thread', { ok: (await foreign.count()) === 1, detail: await thread.textContent().catch(() => 'no thread') })
    await until(() => foreign.locator('button[aria-label="View board.png"] img').evaluate((img) => img.complete && img.naturalWidth > 0).catch(() => false))
    const sources = await pane.locator('img').evaluateAll((all) => all.map((img) => img.src.split(':')[0]))
    await h.assert('H: an image in data-src shows, by id, through the app', {
      ok: (await foreign.locator('button[aria-label="View board.png"] img').count()) === 1 && sources.every((s) => s === 'blob' || s === 'data'),
      detail: sources.join(', '),
    })
    await h.assert('H: an image of another address or task is dropped', {
      ok: (await pane.locator('img[src*="example.invalid"], img[src*="999999"]').count()) === 0 && (await pane.getByText('tracker').count()) === 0 && (await pane.getByText('other task').count()) === 0,
    })
    await h.assert('H: a link naming this task\'s file is that file, by id', { ok: (await foreign.locator('button[title="Open"]:has-text("notes.txt")').count()) === 1 })
    await h.assert('H: a comment with more than Vicu writes cannot be edited here', { ok: (await foreign.locator('button[aria-label="Edit comment"]').count()) === 0 })
    await h.assert('H: an "image" that cannot be drawn is a file row with its real name', async () => {
      const row = foreign.locator('button[title="Open"]:has-text("dropped.txt")')
      await row.waitFor({ timeout: 10000 }).catch(() => {})
      return { ok: (await row.count()) === 1 && (await foreign.locator('button[aria-label^="View "]').count()) === 1, detail: await foreign.textContent() }
    })
    await h.assert('H: nothing was fetched from an address in a comment', { ok: elsewhere.length === 0, detail: elsewhere.join(', ') })

    // ---- I. A file newer than the list ------------------------------------------------------
    await page.evaluate((gone) => {
      window.__cfGone = false
      const check = () => {
        if (document.querySelector('#comments-pane')?.textContent.includes(gone)) window.__cfGone = true
      }
      window.__cfObserver = new MutationObserver(check)
      window.__cfObserver.observe(document.body, { subtree: true, childList: true, characterData: true })
    }, GONE)
    const form = new FormData()
    form.append('files', new Blob([NOTES], { type: 'text/plain' }), 'from-phone.txt')
    const uploadAnswer = await fetch(`${API_URL}/tasks/${task.id}/attachments`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${readApiToken()}` },
      body: form,
      signal: AbortSignal.timeout(30000),
    })
    if (!uploadAnswer.ok) throw new Error(`upload from-phone.txt -> ${uploadAnswer.status}`)
    const phone = await until(() => named('from-phone.txt'))
    await h.api('POST', `/tasks/${task.id}/comments`, { comment: `<p><a href="${address(phone.id)}">from-phone.txt</a></p>` })
    await composer.click()
    await h.type('Thanks')
    await commentButton.click()
    await thread.locator('button[title="Open"]:has-text("from-phone.txt")').waitFor({ timeout: THREAD_REFRESH_WAIT_MS }).catch(() => {})
    await h.settle()
    await h.assert('I: the next read of the thread brings the file from the other device', { ok: (await thread.locator('button[title="Open"]:has-text("from-phone.txt")').count()) === 1 })
    await h.assert('I: "No longer available" did not flash on the way', { ok: !(await page.evaluate(() => window.__cfGone)) })
    await page.evaluate(() => window.__cfObserver.disconnect())

    // ---- J. Delete --------------------------------------------------------------------------
    const askDelete = async (item) => {
      await item.hover()
      await item.locator('button[aria-label="Delete comment"]').click()
      await page.locator('dialog[open]').waitFor({ timeout: 5000 })
      return page.locator('dialog[open]').textContent()
    }
    const before = (await onTask()).length
    // The newest own comment has no files, so its question is the plain one.
    const own = threadComments.filter({ hasText: 'Thanks' })
    await h.assert('J: a comment without files has the plain question', {
      ok: !(await askDelete(own)).includes('attachments'),
    })
    await page.locator('dialog[open] button', { hasText: /^Cancel$/ }).click()
    await h.wait(300)
    const first = threadComments.first()
    const question = await askDelete(first)
    await h.assert('J: the delete question says the files stay', { ok: question.includes("Its files stay in the task's attachments."), detail: question })
    await h.capture(`delete-question-${theme}`)
    await page.locator('dialog[open] button', { hasText: /^Cancel$/ }).click()
    await h.wait(300)

    // ---- L. A screenshot on the real clipboard ------------------------------------------------
    // The steps above dispatch the paste; this one goes through the system clipboard and the key.
    // It borrows the clipboard of whoever runs this: everything on it is kept and put back, and it
    // runs only when that can be done (copied files are not something read() hands over).
    const clipboardKept = await h.app.evaluate(async ({ clipboard, ClipboardItem }) => {
      if (await clipboard.has('electron application/osclipboard;format="FileNameW"')) return false
      const kept = []
      for (const item of await clipboard.read()) {
        const payload = {}
        for (const type of item.types) payload[type] = await item.getType(type)
        if (item.types.length > 0) kept.push(new ClipboardItem(payload))
      }
      globalThis.__cfClipboard = kept
      globalThis.__cfClipboardText = await clipboard.readText()
      return kept.length > 0
    })
    if (!clipboardKept) {
      h.skip('L: a real screenshot paste', 'the clipboard holds nothing this step could put back afterwards')
    } else try {
      await h.app.evaluate(async ({ clipboard, ClipboardItem }, bytes) => {
        const image = new Blob([Buffer.from(bytes)], { type: 'image/png' })
        await clipboard.write([new ClipboardItem({ 'image/png': image })])
      }, board)
      await composer.click()
      await h.key('ControlOrMeta+V')
      await until(async () => (await chips.count()) === 1)
      await uploaded()
      const chipText = (await chips.first().textContent().catch(() => '')) ?? ''
      await h.assert('L: Ctrl+V with a screenshot on the clipboard makes a chip, and no text', {
        ok: /\.png/.test(chipText) && (await composer.inputValue()) === '',
        detail: chipText,
      })
      const pastedName = chipText.trim()
      await h.assert('L: the screenshot is on the task as a PNG', async () => {
        const stored = await until(() => named(pastedName))
        return { ok: stored?.file.mime === 'image/png', detail: JSON.stringify(stored?.file ?? null) }
      })
      await pane.locator(`button[aria-label="Remove ${pastedName}"]`).click()
      await until(async () => !(await named(pastedName)))
    } finally {
      const restored = await h.app.evaluate(async ({ clipboard }) => {
        await clipboard.write(globalThis.__cfClipboard)
        const same = (await clipboard.readText()) === globalThis.__cfClipboardText
        delete globalThis.__cfClipboard
        delete globalThis.__cfClipboardText
        return same
      })
      await h.assert('L: the clipboard is back as it was', { ok: restored })
    }

    // ---- K. Gone ----------------------------------------------------------------------------
    // The test server's SQLite can answer 500 "database is locked" while the app is writing too.
    const deleteFile = async (id) => {
      for (let attempt = 1; ; attempt++) {
        try {
          return await h.api('DELETE', `/tasks/${task.id}/attachments/${id}`)
        } catch (error) {
          if (error.status !== 500 || attempt === 5) throw error
          await h.wait(500)
        }
      }
    }
    await deleteFile(notesFile.id)
    await deleteFile(boardFile.id)
    // The list is read again when the pane opens.
    await pane.locator('button[aria-label="Close comments"]').click()
    await h.wait(300)
    await page.locator(`[data-task-id="${task.id}"] button[data-prop="comments"]`).click()
    await composer.waitFor({ timeout: 5000 })
    const firstComment = threadComments.first()
    await firstComment.getByText(GONE).first().waitFor({ timeout: 15000 }).catch(() => {})
    await h.settle()
    await h.assert('K: a deleted file and a deleted image both say so under their names', {
      ok: (await firstComment.getByText(GONE).count()) === 2 && (await firstComment.getByText('notes.txt').count()) === 1 && (await firstComment.getByText('board.png').count()) === 1,
      detail: await firstComment.textContent(),
    })
    await h.assert('K: they have no buttons, and the image no preview', {
      ok: (await firstComment.locator('button[title="Open"]:has-text("notes.txt"), button[aria-label="Save notes.txt"], button[aria-label^="View "], button[title="Open"]:has-text("board.png"), button[aria-label="Save board.png"]').count()) === 0,
    })
    await h.assert('K: a file still on the task keeps its row', { ok: (await firstComment.locator('button[title="Open"]:has-text("dropped.txt")').count()) === 1 })
    await h.capture(`gone-${theme}`, { clip: pane })
    await h.axe('#comments-pane', { label: 'comments pane with files that are gone' })

    await askDelete(firstComment)
    await page.locator('dialog[open] button', { hasText: /^Delete/ }).click()
    await h.assert('J: deleting the comment leaves its files on the task', async () => {
      const gone = await until(async () => !(await comments()).some((c) => c.comment.includes('dropped.txt')))
      const left = (await onTask()).map((a) => a.file.name)
      return { ok: !!gone && left.includes('dropped.txt') && left.length === before - 2, detail: left.join(', ') }
    })
  } finally {
    page.off('request', onRequest)
    await h.app.evaluate(({ dialog, shell }) => {
      if (!globalThis.__cf) return
      dialog.showOpenDialog = globalThis.__cf.open
      dialog.showSaveDialog = globalThis.__cf.save
      shell.openPath = globalThis.__cf.openPath
      delete globalThis.__cf
    }).catch(() => {})
    await h.api('DELETE', `/tasks/${task.id}`).catch(() => {})
    rmSync(dir, { recursive: true, force: true })
  }
}
