// attachment-viewer: an image attachment shows in the app instead of opening in another program.
//
//   A. The attachment list: an image row has a thumbnail and says View, another file still says Open.
//   B. The thumbnail opens the viewer over the app with the attachment list still open behind it: the file
//      name, "1 of 2", the original (not the 400 px preview) fitted to the window.
//   C. A large image: Actual size shows it at its own size with scrolling, Fit to window goes back.
//   D. Right and Left go through the task's images (round at the ends); a small image has no zoom.
//   E. Escape closes the viewer only: the list is still open and focus is back on the row.
//   F. The card keeps the pictures in its notes (it used to drop them when the editor tidied the
//      text on open) and a picture there opens the same viewer.
//
// It works on one throwaway Inbox task with two uploaded images and a text file, deleted at the end.
import { API_URL, readApiToken } from '../lib.mjs'

export const meta = {
  id: 'AV',
  wave: 3,
  title: 'Image attachments open in the in-app viewer: fit, actual size, arrows, Escape back to the list',
}

/** A PNG drawn in the page: a gradient with a grid and a label, so the captures show something real. */
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
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'
      for (let x = 0; x < w; x += 100) ctx.strokeRect(x, 0, 1, hgt)
      for (let y = 0; y < hgt; y += 100) ctx.strokeRect(0, y, w, 1)
      ctx.fillStyle = '#fff'
      ctx.font = `bold ${Math.round(hgt / 8)}px sans-serif`
      ctx.fillText(text, w / 20, hgt / 2)
      const blob = await canvas.convertToBlob({ type: 'image/png' })
      return Array.from(new Uint8Array(await blob.arrayBuffer()))
    },
    [width, height, label],
  )

async function upload(taskId, name, type, bytes) {
  const form = new FormData()
  form.append('files', new Blob([bytes], { type }), name)
  const res = await fetch(`${API_URL}/tasks/${taskId}/attachments`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${readApiToken()}` },
    body: form,
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) throw new Error(`upload ${name} -> ${res.status} ${(await res.text()).slice(0, 200)}`)
  const body = await res.json()
  const attachment = body?.success?.[0] ?? body?.items?.[0] ?? body?.[0] ?? body
  if (!attachment?.id) throw new Error(`upload ${name}: no attachment id in ${JSON.stringify(body).slice(0, 200)}`)
  return attachment
}

const viewer = (page) =>
  page.evaluate(() => {
    const dialog = [...document.querySelectorAll('dialog[open]')].at(-1)
    if (!dialog) return null
    const img = dialog.querySelector('img')
    const scroller = img?.parentElement
    const title = dialog.querySelector('h2')?.textContent ?? null
    const listOpen = !!document.querySelector('[popover][aria-label="Attachments"]:popover-open')
    return {
      modal: dialog.matches(':modal'),
      title,
      counter: [...dialog.querySelectorAll('span')].map((s) => s.textContent.trim()).find((t) => / of \d+$/.test(t)) ?? null,
      natural: img ? { w: img.naturalWidth, h: img.naturalHeight } : null,
      shown: img ? { w: Math.round(img.getBoundingClientRect().width), h: Math.round(img.getBoundingClientRect().height) } : null,
      stage: scroller ? { w: scroller.clientWidth, h: scroller.clientHeight, sw: scroller.scrollWidth, sh: scroller.scrollHeight, left: Math.round(scroller.scrollLeft), top: Math.round(scroller.scrollTop) } : null,
      zoomButton: dialog.querySelector('button[aria-label="Actual size"], button[aria-label="Fit to window"]')?.getAttribute('aria-label') ?? null,
      listOpen,
    }
  })

export default async function run(h) {
  const page = h.page
  await h.resize(1280, 820)
  await h.dismiss()
  const dark = await page.evaluate(() => document.documentElement.classList.contains('dark'))
  const theme = dark ? 'dark' : 'light'

  const task = await h.api('POST', `/projects/${h.ids.inbox}/tasks`, { title: 'AV image viewer task' })
  try {
    const big = await upload(task.id, 'whiteboard.png', 'image/png', new Uint8Array(await drawPng(page, 2400, 1600, 'Whiteboard 2400 x 1600')))
    // The way the phone uploads a shared file: the server reads the real type from the content.
    const small = await upload(task.id, 'small.png', 'application/octet-stream', new Uint8Array(await drawPng(page, 320, 200, 'Small')))
    await upload(task.id, 'notes.txt', 'text/plain', new TextEncoder().encode('not an image'))
    // The big image also sits in the notes, the way a pasted image does.
    const stored = `<p>Photo of the board</p>\n[[image:${big.id}]]`
    await h.api('PATCH', `/tasks/${task.id}`, { description: stored })

    await h.goto('/inbox')
    await h.dismiss()
    const row = page.locator(`[data-task-id="${task.id}"]`)
    await row.scrollIntoViewIfNeeded()
    await row.click({ position: { x: 180, y: 12 } })
    await h.wait(700)

    // ---- A. The list ------------------------------------------------------------------------
    await page.locator(`[data-task-id="${task.id}"] button[data-prop="attachments"]`).click()
    await h.wait(600)
    const rows = await page.evaluate(() => {
      const list = document.querySelector('[popover][aria-label="Attachments"]')
      return [...(list?.querySelectorAll('button[title]') ?? [])]
        .filter((b) => b.title === 'View' || b.title === 'Open')
        .map((b) => ({ name: b.textContent.trim(), title: b.title }))
    })
    await h.assert('A: image rows say View, the text file says Open', {
      ok: rows.filter((r) => r.title === 'View').length === 2 && rows.find((r) => r.name.startsWith('notes.txt'))?.title === 'Open',
      detail: JSON.stringify(rows),
    })
    await page.waitForFunction(() => {
      const imgs = [...document.querySelectorAll('[popover][aria-label="Attachments"] button[title="View"] img')]
      return imgs.length === 2 && imgs.every((img) => img.complete && img.naturalWidth > 0)
    }, null, { timeout: 15000 }).catch(() => {})
    const thumbs = await page.evaluate(() => {
      const list = document.querySelector('[popover][aria-label="Attachments"]')
      const drawn = (title) => [...(list?.querySelectorAll(`button[title="${title}"] img`) ?? [])].filter((img) => img.naturalWidth > 0).length
      return { view: drawn('View'), open: drawn('Open') }
    })
    await h.assert('A: image rows show a thumbnail, the text file does not', { ok: thumbs.view === 2 && thumbs.open === 0, detail: JSON.stringify(thumbs) })
    await h.capture(`list-thumbnails-${theme}`)

    // ---- B. View ----------------------------------------------------------------------------
    const bigRow = page.locator('[popover][aria-label="Attachments"] button[title="View"]', { hasText: 'whiteboard.png' })
    await bigRow.locator('img').click()
    await h.wait(400)
    await page.waitForFunction(() => {
      const img = [...document.querySelectorAll('dialog[open] img')].at(-1)
      return !!img && img.complete && img.naturalWidth > 1000
    }, null, { timeout: 15000 }).catch(() => {})
    await h.settle()
    let v = await viewer(page)
    await h.assert('B: View opens a modal viewer titled with the file name, the list stays open behind it', {
      ok: !!v && v.modal && v.title === 'whiteboard.png' && v.listOpen,
      detail: JSON.stringify(v),
    })
    await h.assert('B: it shows the original, not the 400 px preview', { ok: v?.natural?.w === 2400 && v?.natural?.h === 1600, detail: JSON.stringify(v?.natural) })
    await h.assert('B: the image is fitted inside the stage', {
      ok: !!v?.shown && !!v?.stage && v.shown.w <= v.stage.w + 1 && v.shown.h <= v.stage.h + 1 && (Math.abs(v.shown.w - v.stage.w) <= 1 || Math.abs(v.shown.h - v.stage.h) <= 1),
      detail: JSON.stringify({ shown: v?.shown, stage: v?.stage }),
    })
    await h.assert('B: the counter reads 1 of 2', { ok: v?.counter === '1 of 2', detail: v?.counter })
    await h.capture(`viewer-fit-${theme}`)
    await h.axe('dialog[open]', { label: 'image viewer' })

    // ---- C. Actual size ---------------------------------------------------------------------
    await page.locator('dialog[open] img').click()
    await h.wait(300)
    v = await viewer(page)
    await h.assert('C: a click shows the large image at its own size, scrollable', {
      ok: v?.shown?.w === 2400 && v?.stage?.sw >= 2400 && v?.zoomButton === 'Fit to window',
      detail: JSON.stringify({ shown: v?.shown, stage: v?.stage, button: v?.zoomButton }),
    })
    await h.assert('C: it scrolls to where it was clicked (the middle)', {
      ok: !!v?.stage && v.stage.left > 0 && v.stage.top > 0,
      detail: JSON.stringify(v?.stage),
    })
    await h.capture(`viewer-actual-size-${theme}`)
    await page.locator('dialog[open] button[aria-label="Fit to window"]').click()
    await h.wait(300)
    v = await viewer(page)
    await h.assert('C: Fit to window goes back', { ok: !!v?.shown && v.shown.w < 2400 && v.zoomButton === 'Actual size', detail: JSON.stringify(v?.shown) })

    // ---- D. Arrows --------------------------------------------------------------------------
    await h.key('ArrowRight')
    await page.waitForFunction(() => [...document.querySelectorAll('dialog[open] img')].at(-1)?.naturalWidth === 320, null, { timeout: 15000 }).catch(() => {})
    await h.settle()
    v = await viewer(page)
    await h.assert('D: Right shows the next image', { ok: v?.title === 'small.png' && v?.counter === '2 of 2', detail: JSON.stringify({ title: v?.title, counter: v?.counter }) })
    await h.assert('D: a small image is shown at its own size, without the zoom button', {
      ok: v?.shown?.w === 320 && v?.shown?.h === 200 && v?.zoomButton === null,
      detail: JSON.stringify({ shown: v?.shown, button: v?.zoomButton }),
    })
    await h.capture(`viewer-small-${theme}`)
    await h.key('ArrowRight')
    await h.wait(400)
    v = await viewer(page)
    await h.assert('D: Right on the last image goes round to the first', { ok: v?.title === 'whiteboard.png' && v?.counter === '1 of 2', detail: v?.title })
    await h.key('ArrowLeft')
    await h.wait(400)
    v = await viewer(page)
    await h.assert('D: Left goes back round to the last', { ok: v?.title === 'small.png', detail: v?.title })

    // ---- D2. Copy image ---------------------------------------------------------------------
    const clipboardImage = () => h.app.evaluate(async ({ clipboard, nativeImage }) => {
      const items = await clipboard.read()
      const item = items.find((entry) => entry.types.includes('image/png'))
      if (!item) return { types: items.flatMap((entry) => entry.types) }
      const blob = await item.getType('image/png')
      const size = nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer())).getSize()
      return { types: item.types, ...size }
    })
    await h.app.evaluate(({ clipboard }) => clipboard.writeText('before'))
    await page.locator('dialog[open] button[title="Copy image"]').click()
    await page.waitForFunction(() => document.querySelector('dialog[open] [role="status"]')?.textContent === 'Image copied', null, { timeout: 10000 }).catch(() => {})
    let clip = await clipboardImage()
    await h.assert('D2: Copy puts the image on the clipboard at its own size', { ok: clip.width === 320 && clip.height === 200, detail: JSON.stringify(clip) })
    await h.capture(`viewer-copied-${theme}`)
    await h.app.evaluate(({ clipboard }) => clipboard.writeText('before'))
    await h.key('ArrowRight')
    await page.waitForFunction(() => [...document.querySelectorAll('dialog[open] img')].at(-1)?.naturalWidth === 2400, null, { timeout: 15000 }).catch(() => {})
    await h.key(process.platform === 'darwin' ? 'Meta+c' : 'Control+c')
    await page.waitForFunction(() => document.querySelector('dialog[open] [role="status"]')?.textContent === 'Image copied', null, { timeout: 10000 }).catch(() => {})
    clip = await clipboardImage()
    await h.assert('D2: Mod+C copies the image shown', { ok: clip.width === 2400, detail: JSON.stringify(clip) })
    await h.key('ArrowLeft')
    await h.wait(400)

    // ---- E. Escape --------------------------------------------------------------------------
    await h.key('Escape')
    await h.wait(400)
    const after = await page.evaluate(() => ({
      dialog: !!document.querySelector('dialog[open]'),
      listOpen: !!document.querySelector('[popover][aria-label="Attachments"]:popover-open'),
      focus: document.activeElement?.getAttribute('title') ?? null,
      focusText: document.activeElement?.textContent?.trim().slice(0, 40) ?? null,
    }))
    await h.assert('E: Escape closes the viewer only; the list stays open with focus on the row', {
      ok: !after.dialog && after.listOpen && after.focus === 'View' && after.focusText?.startsWith('whiteboard.png'),
      detail: JSON.stringify(after),
    })
    await h.key('Escape')
    await h.wait(400)

    await h.assert('E: opening the card and the viewer saved nothing: the picture is still in the notes', async () => {
      const description = (await h.api('GET', `/tasks/${task.id}`)).description
      return { ok: description === stored, detail: description }
    })
    // ---- F. Notes picture -------------------------------------------------------------------
    const thumb = page.locator(`[data-task-id="${task.id}"] button[title="View image"]`)
    await thumb.first().waitFor({ timeout: 15000 }).catch(() => {})
    await h.settle()
    if ((await thumb.count()) > 0) await h.capture(`notes-picture-${theme}`, { clip: page.locator(`[data-task-id="${task.id}"]`) })
    if ((await thumb.count()) === 0) {
      const card = await page.evaluate((id) => {
        const el = document.querySelector(`[data-task-id="${id}"]`)
        return { expanded: !!el?.querySelector('button[data-prop="schedule"]'), imgs: el?.querySelectorAll('img').length ?? 0, pulses: el?.querySelectorAll('.animate-pulse').length ?? 0, html: el?.querySelector('.col-start-2.pt-2')?.innerHTML.slice(-700) }
      }, task.id)
      await h.assert('F: the card shows the picture in its notes as a button', { ok: false, detail: JSON.stringify(card) })
    } else {
      await thumb.first().click()
      await page.waitForFunction(() => [...document.querySelectorAll('dialog[open] img')].at(-1)?.naturalWidth === 2400, null, { timeout: 15000 }).catch(() => {})
      v = await viewer(page)
      await h.assert('F: a picture in the notes opens the viewer on that image', { ok: v?.modal && v?.title === 'whiteboard.png' && v?.natural?.w === 2400, detail: JSON.stringify(v) })
      await h.key('Escape')
      await h.wait(300)
      await h.assert('F: Escape closes it', { ok: (await viewer(page)) === null })
    }
  } finally {
    await h.api('DELETE', `/tasks/${task.id}`).catch(() => {})
  }
}
