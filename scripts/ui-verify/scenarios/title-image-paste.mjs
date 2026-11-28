// title-image-paste: an image pasted in a task's title goes to its notes, without first going to the notes.
//
//   A. An open card: the image uploads at once, joins the notes and is saved; the title keeps the
//      focus and its text.
//   B. A paste that holds text (Office adds a picture of copied text) stays text in the title.
//   C. The new-task composer: the image is staged, the notes open to show it with the focus still in
//      the title, and Enter creates the task with the image in its notes.
//
// It works on throwaway Inbox tasks, deleted at the end.
export const meta = {
  id: 'TIP',
  wave: 3,
  title: 'An image pasted in the title uploads into the notes (open card and composer)',
}

const drawPng = (page, label) =>
  page.evaluate(async (text) => {
    const canvas = new OffscreenCanvas(480, 240)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#0a66d1'
    ctx.fillRect(0, 0, 480, 240)
    ctx.fillStyle = '#fff'
    ctx.font = 'bold 40px sans-serif'
    ctx.fillText(text, 24, 136)
    const blob = await canvas.convertToBlob({ type: 'image/png' })
    return Array.from(new Uint8Array(await blob.arrayBuffer()))
  }, label)

async function putImage(h, bytes, text) {
  const held = await h.app.evaluate(async ({ clipboard, ClipboardItem }, [data, words]) => {
    const entries = { 'image/png': new Blob([Buffer.from(data)], { type: 'image/png' }) }
    if (words) entries['text/plain'] = words
    await clipboard.write([new ClipboardItem(entries)])
    return (await clipboard.read()).flatMap((item) => item.types)
  }, [bytes, text])
  await h.assert(`clipboard holds the image${text ? ' and text' : ''}`, {
    ok: held.includes('image/png') && (!text || held.includes('text/plain')),
    detail: JSON.stringify(held),
  })
}

const paste = (h) => h.key(process.platform === 'darwin' ? 'Meta+v' : 'Control+v')

async function serverTask(h, id) {
  const task = await h.api('GET', `/tasks/${id}`)
  return { title: task.title, description: task.description ?? '', attachments: (task.attachments ?? []).length }
}

async function waitFor(fn, timeout = 15000) {
  const end = Date.now() + timeout
  let last
  while (Date.now() < end) {
    last = await fn()
    if (last.ok) return last
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  return last
}

export default async function run(h) {
  const page = h.page
  await h.resize(1280, 820)
  await h.dismiss()
  const made = []
  // The clipboard is the computer's own: keep what is on it and put it back at the end.
  await h.app.evaluate(async ({ clipboard, ClipboardItem }) => {
    const items = await clipboard.read()
    globalThis.__tipClipboard = await Promise.all(items.map(async (item) =>
      new ClipboardItem(Object.fromEntries(await Promise.all(item.types.map(async (type) => [type, await item.getType(type)]))))))
  })
  try {
    const task = await h.api('POST', `/projects/${h.ids.inbox}/tasks`, { title: 'TIP paste into title' })
    made.push(task.id)
    await h.goto('/inbox')
    await h.dismiss()
    const row = page.locator(`[data-task-id="${task.id}"]`)
    await row.scrollIntoViewIfNeeded()
    await row.click({ position: { x: 180, y: 12 } })
    await h.wait(700)
    const title = row.locator('textarea').first()
    await title.click()
    await page.keyboard.press('End')

    // ---- A. Open card -----------------------------------------------------------------------
    await putImage(h, await drawPng(page, 'Pasted in the title'), null)
    await paste(h)
    const saved = await waitFor(async () => {
      const t = await serverTask(h, task.id)
      return { ok: t.attachments === 1 && /\[\[image:\d+\]\]/.test(t.description), detail: JSON.stringify(t) }
    })
    await h.assert('A: the image is uploaded and saved in the notes', saved)
    await row.locator('button[title="View image"]').first().waitFor({ timeout: 15000 }).catch(() => {})
    const cardState = await page.evaluate((id) => {
      const el = document.querySelector(`[data-task-id="${id}"]`)
      const area = el?.querySelector('textarea')
      return { title: area?.value, focusInTitle: document.activeElement === area, thumbs: el?.querySelectorAll('button[title="View image"]').length ?? 0 }
    }, task.id)
    await h.assert('A: the notes show the picture; the title keeps its text and the focus', {
      ok: cardState.title === 'TIP paste into title' && cardState.focusInTitle && cardState.thumbs === 1,
      detail: JSON.stringify(cardState),
    })
    await h.capture('card-after-paste', { clip: row })

    // ---- B. Text with a picture of it ---------------------------------------------------------
    await putImage(h, await drawPng(page, 'Office text'), ' and more')
    await paste(h)
    await h.wait(1200)
    const textPaste = await page.evaluate((id) => document.querySelector(`[data-task-id="${id}"] textarea`)?.value, task.id)
    const afterText = await serverTask(h, task.id)
    await h.assert('B: a paste with text is text in the title, no upload', {
      ok: textPaste === 'TIP paste into title and more' && afterText.attachments === 1,
      detail: JSON.stringify({ textPaste, attachments: afterText.attachments }),
    })
    await h.key('Escape')
    await h.wait(500)

    // ---- C. Composer --------------------------------------------------------------------------
    await page.locator('button[aria-label="New task"]').last().click()
    await h.wait(300)
    const composer = page.getByPlaceholder('New task').first()
    await composer.click()
    await page.keyboard.type('TIP composer paste')
    await putImage(h, await drawPng(page, 'Composer'), null)
    await paste(h)
    await page.waitForFunction(() => [...document.querySelectorAll('img')].some((img) => img.src.startsWith('blob:') && img.naturalWidth === 480), null, { timeout: 10000 }).catch(() => {})
    const composerState = await page.evaluate(() => {
      const input = [...document.querySelectorAll('textarea, input')].find((el) => el.placeholder === 'New task')
      return {
        value: input?.value,
        focusInTitle: document.activeElement === input,
        staged: [...document.querySelectorAll('img')].filter((img) => img.src.startsWith('blob:') && img.naturalWidth === 480).length,
      }
    })
    await h.assert('C: the notes open with the staged picture; the focus stays in the title', {
      ok: composerState.value === 'TIP composer paste' && composerState.focusInTitle && composerState.staged === 1,
      detail: JSON.stringify(composerState),
    })
    await h.capture('composer-after-paste')
    await h.key('Enter')
    const created = await waitFor(async () => {
      const found = await h.api('GET', `/tasks?filter=${encodeURIComponent('title like "TIP composer paste"')}&per_page=5`)
      const list = Array.isArray(found) ? found : found?.items ?? []
      const hit = list.find((t) => t.title === 'TIP composer paste')
      if (!hit) return { ok: false, detail: 'not created' }
      if (!made.includes(hit.id)) made.push(hit.id)
      const t = await serverTask(h, hit.id)
      return { ok: t.attachments === 1 && /\[\[image:\d+\]\]/.test(t.description), detail: JSON.stringify(t) }
    }, 20000)
    await h.assert('C: Enter creates the task with the image in its notes', created)
  } finally {
    await h.app.evaluate(async ({ clipboard }) => {
      if (globalThis.__tipClipboard?.length) await clipboard.write(globalThis.__tipClipboard)
    }).catch(() => {})
    for (const id of made) await h.api('DELETE', `/tasks/${id}`).catch(() => {})
  }
}
