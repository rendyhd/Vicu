import { app, BrowserWindow, Menu, type WebContents } from 'electron'
import { textMenuTemplate } from './text-menu-template'

function attachTextMenu(contents: WebContents): void {
  contents.on('context-menu', (_event, params) => {
    const template = textMenuTemplate(params, (suggestion) => contents.replaceMisspelling(suggestion))
    if (template.length === 0) return
    const window = BrowserWindow.fromWebContents(contents) ?? undefined
    // A mouse click opens at the pointer by default; Shift+F10 opens where the text is.
    const place = params.menuSourceType === 'mouse' ? {} : { x: params.x, y: params.y }
    Menu.buildFromTemplate(template).popup({ window, ...place })
  })
}

let registered = false

/**
 * Electron shows no menu of its own on a right click, so selected text and text fields need
 * this one (Cut, Copy, Paste) in every window. Call once, before the first window exists.
 */
export function registerTextContextMenu(): void {
  if (registered) return
  registered = true
  app.on('web-contents-created', (_event, contents) => attachTextMenu(contents))
}
