// text-context-menu: a right click on text opens the native text menu, in the running app.
//
// A native menu is not in the page, so main's Menu.popup is wrapped to record what opens and the
// recorded items are run by role (Electron lowercases selectAll). Section E lets the real menu open.
//
//   A. Selected text in an open card's title: Cut, Copy, Paste, Select all; Copy reaches the clipboard.
//   B. Selected text in its notes: the same; Cut and Paste change the notes.
//   C. Selected read-only text in the comments pane: Copy only (skipped when the pane has no text).
//   D. A right click on a task row is still Vicu's own menu, and no text menu opens.
//   E. The real menu opens in a card, which stays open, and in Quick Entry, which does not hide.
//      Page captures do not show a native menu, so on Windows the window's area of the screen is saved.
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

export const meta = {
  id: 'TCM',
  wave: 3,
  title: 'Text context menu: Cut, Copy, Paste in the card title and notes, Copy on read-only text, row menu unchanged',
}

const wrapPopup = (app) =>
  app.evaluate(({ Menu, clipboard }) => {
    if (!globalThis.__menus) {
      globalThis.__menus = []
      globalThis.__clipboard = clipboard
      globalThis.__openReally = false
      const popup = Menu.prototype.popup
      Menu.prototype.popup = function (options) {
        globalThis.__menus.push(this)
        if (!globalThis.__openReally) return
        this.once('menu-will-show', () => (globalThis.__shown = true))
        // At a fixed spot: the harness's input does not move the real cursor, where a menu opens by default.
        popup.call(this, { ...options, x: 460, y: 60 })
      }
    }
    globalThis.__menus.length = 0
  })

const lastMenu = (app) =>
  app.evaluate(() => {
    const menu = globalThis.__menus.at(-1)
    return menu ? menu.items.filter((i) => i.type !== 'separator').map((i) => [i.role, i.enabled]) : null
  })

const runItem = (app, role) =>
  app.evaluate(({ BrowserWindow }, r) => {
    const item = globalThis.__menus.at(-1).items.find((i) => i.role === r)
    const win = BrowserWindow.getAllWindows().find((w) => w.isVisible())
    item.click(undefined, win, win.webContents)
  }, role)

const openReally = (app, on) =>
  app.evaluate((_e, value) => {
    globalThis.__openReally = value
    globalThis.__shown = false
    globalThis.__menus.length = 0
  }, on)
const realMenuShown = (app) => app.evaluate(() => globalThis.__shown === true)
const closeRealMenu = (app) => app.evaluate(() => globalThis.__menus.at(-1)?.closePopup())

/** Saves the area of the screen `match`'s window covers. */
async function captureScreen(h, match, name) {
  if (process.platform !== 'win32') return
  const b = await h.app.evaluate(({ BrowserWindow }, m) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.isVisible() && w.webContents.getURL().includes(m))
    return win?.getBounds()
  }, match)
  if (!b) return
  const file = join(h.runDir, `text-context-menu--${name}.png`)
  execFileSync('powershell.exe', ['-NoProfile', '-Command', `
    Add-Type -AssemblyName System.Drawing
    $bmp = New-Object System.Drawing.Bitmap ${b.width}, ${b.height}
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen(${b.x}, ${b.y}, 0, 0, $bmp.Size)
    $bmp.Save('${file}', [System.Drawing.Imaging.ImageFormat]::Png)
  `])
}

const readClipboard = (app) => app.evaluate(() => globalThis.__clipboard.readText())

export default async function run(h) {
  const { page, app } = h
  await wrapPopup(app)
  await h.resize(1280, 820)
  const task = await h.api('POST', `/projects/${h.ids.inbox}/tasks`, {
    title: 'Text menu scratch task',
    description: '<p>Scratch notes body</p>',
  })

  try {
    await h.goto('/inbox')
    await h.key('F5') // the task was made behind the app's back
    await h.wait(800)
    const row = page.locator(`[data-task-id="${task.id}"]`).first()
    await row.click()
    await h.wait(600)

    // ---- A. The title ----------------------------------------------------------------------
    const title = page.locator(`[data-task-id="${task.id}"] input, [data-task-id="${task.id}"] textarea`).first()
    const hasInput = await title.count()
    const titleField = hasInput ? title : page.locator(`[data-task-id="${task.id}"] [contenteditable="true"]`).first()
    await titleField.click({ clickCount: 3 })
    await titleField.click({ button: 'right' })
    await h.wait(200)
    let items = await lastMenu(app)
    await h.assert('the card title offers Cut, Copy, Paste and Select all', {
      ok: items?.map((i) => i[0]).join() === 'cut,copy,paste,selectall',
      detail: JSON.stringify(items),
    })
    await h.assert('Copy is enabled on selected title text', { ok: items?.find((i) => i[0] === 'copy')?.[1] === true, detail: JSON.stringify(items) })
    await runItem(app, 'copy')
    await h.wait(200)
    const copiedTitle = await readClipboard(app)
    await h.assert('Copy puts the title on the clipboard', { ok: copiedTitle.includes('Text menu scratch task'), detail: copiedTitle })

    // ---- B. The notes ----------------------------------------------------------------------
    const notes = page.locator(`[data-task-id="${task.id}"] .ProseMirror, .ProseMirror`).first()
    await notes.click({ clickCount: 3 })
    await h.wait(100)
    await notes.click({ button: 'right' })
    await h.wait(200)
    items = await lastMenu(app)
    await h.assert('the notes offer Cut, Copy, Paste and Select all', {
      ok: items?.map((i) => i[0]).join() === 'cut,copy,paste,selectall',
      detail: JSON.stringify(items),
    })
    await runItem(app, 'copy')
    await h.wait(200)
    const copiedNotes = await readClipboard(app)
    await h.assert('Copy puts the selected notes on the clipboard', { ok: copiedNotes.includes('Scratch notes body'), detail: copiedNotes })

    await runItem(app, 'cut')
    await h.wait(200)
    await h.assert('Cut removes the notes text', { ok: !(await notes.innerText()).includes('Scratch notes body'), detail: await notes.innerText() })
    await notes.click({ button: 'right' })
    await h.wait(200)
    await runItem(app, 'paste')
    await h.wait(200)
    await h.assert('Paste puts it back', { ok: (await notes.innerText()).includes('Scratch notes body'), detail: await notes.innerText() })
    await notes.click({ button: 'right' })
    await h.wait(200)
    await runItem(app, 'selectall')
    await h.wait(200)
    const selected = await page.evaluate(() => getSelection()?.toString() ?? '')
    await h.assert('Select all selects the notes', { ok: selected.includes('Scratch notes body'), detail: selected })
    await h.capture('card')

    // ---- C. Read-only text -------------------------------------------------------------------
    await h.key('Escape')
    await h.wait(300)
    await h.key('Escape')
    await h.wait(300)
    const heading = page.locator('h1').first()
    if (await heading.count()) {
      await heading.click({ clickCount: 3 })
      const picked = await page.evaluate(() => getSelection()?.toString() ?? '')
      if (picked.trim()) {
        await heading.click({ button: 'right' })
        await h.wait(200)
        items = await lastMenu(app)
        await h.assert('selected read-only text offers Copy only', { ok: items?.map((i) => i[0]).join() === 'copy', detail: JSON.stringify(items) })
      } else {
        h.emit({ t: 'skip', id: 'TCM', message: 'the page heading could not be selected' })
      }
    }

    // ---- D. The row keeps its own menu -----------------------------------------------------
    await app.evaluate(() => {
      globalThis.__menus.length = 0
    })
    await page.evaluate(() => getSelection()?.removeAllRanges())
    await h.goto('/inbox')
    await h.rows().first().click({ button: 'right' })
    await h.wait(350)
    const vicuMenu = await page.evaluate(() => document.querySelector('[role="menu"]')?.getAttribute('aria-label') ?? null)
    await h.assert('a task row still opens Task actions', { ok: vicuMenu === 'Task actions', detail: String(vicuMenu) })
    await h.assert('and no native menu opens over it', { ok: (await lastMenu(app)) === null, detail: JSON.stringify(await lastMenu(app)) })
    await h.key('Escape')
    await h.wait(300)

    // ---- E. The real menu --------------------------------------------------------------------
    await h.goto('/inbox')
    await page.locator(`[data-task-id="${task.id}"]`).first().click()
    await h.wait(600)
    await openReally(app, true)
    const card = page.locator('.ProseMirror').first()
    await card.click({ clickCount: 3 })
    await card.click({ button: 'right' })
    await h.wait(500)
    await h.assert('the real menu opens on selected text in a card', await realMenuShown(app))
    await captureScreen(h, 'index.html', 'card-native-menu')
    await closeRealMenu(app)
    await h.wait(300)
    await h.assert('the card is still open after the menu closes', async () => (await page.locator('.ProseMirror').count()) > 0)
    await h.key('Escape')
    await h.wait(300)

    const quick = await h.showQuick('entry')
    await h.wait(400)
    await app.evaluate(({ BrowserWindow }) => {
      globalThis.__quickBlurs = 0
      const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('quick-entry'))
      win?.on('blur', () => globalThis.__quickBlurs++)
    })
    await openReally(app, true)
    const field = quick.locator('input, textarea').first()
    await field.fill('Quick entry words')
    await field.click({ button: 'right' })
    await h.wait(600)
    await h.assert('the real menu opens in Quick Entry', await realMenuShown(app))
    const during = await app.evaluate(({ BrowserWindow }) => ({
      visible: BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('quick-entry'))?.isVisible(),
      blurs: globalThis.__quickBlurs,
    }))
    await captureScreen(h, 'quick-entry', 'quick-entry-native-menu')
    await h.assert('Quick Entry stays open behind the menu', { ok: during.visible === true, detail: JSON.stringify(during) })
    await closeRealMenu(app)
    await h.wait(300)
    await field.fill('')
    await h.hideQuick('entry')
    await openReally(app, false)
  } finally {
    await h.api('DELETE', `/tasks/${task.id}`).catch(() => {})
  }
}
