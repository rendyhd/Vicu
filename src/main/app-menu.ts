import { app, Menu, shell, BrowserWindow, MenuItemConstructorOptions } from 'electron'
import { isMac } from './platform'
import { t } from '../shared/i18n'

/**
 * Builds the application menu in the language in use (called again when the language changes).
 * Every item has a label of ours, role items too: Electron's own role labels are English, and
 * macOS translates only some of them.
 */
export function setupApplicationMenu(getMainWindow: () => BrowserWindow | null): void {
  const template: MenuItemConstructorOptions[] = []

  // ── macOS App submenu (first item, app name) ──
  if (isMac) {
    template.push({
      label: app.name,
      submenu: [
        { role: 'about', label: t('menu.about') },
        { type: 'separator' },
        {
          label: t('menu.preferences'),
          accelerator: 'CmdOrCtrl+,',
          click: () => {
            const win = getMainWindow()
            if (win) {
              win.show()
              win.focus()
              win.webContents.send('navigate', '/settings')
            }
          },
        },
        { type: 'separator' },
        { role: 'services', label: t('menu.services') },
        { type: 'separator' },
        { role: 'hide', label: t('menu.hide') },
        { role: 'hideOthers', label: t('menu.hideOthers') },
        { role: 'unhide', label: t('menu.showAll') },
        { type: 'separator' },
        { role: 'quit', label: t('menu.quit') },
      ],
    })
  }

  // ── File ──
  template.push({
    label: t('menu.file'),
    submenu: [
      {
        label: t('menu.newTask'),
        accelerator: 'CmdOrCtrl+N',
        click: () => {
          const win = getMainWindow()
          if (win) {
            win.show()
            win.focus()
            win.webContents.send('new-task')
          }
        },
      },
      { type: 'separator' },
      {
        label: t('menu.print'),
        accelerator: 'CmdOrCtrl+P',
        click: () => {
          const win = getMainWindow()
          if (win && win.isVisible() && win.isFocused()) {
            win.webContents.send('print-view')
          }
        },
      },
      { type: 'separator' },
      isMac ? { role: 'close', label: t('menu.closeWindow') } : { role: 'quit', label: t('menu.quit') },
    ],
  })

  // ── Edit (CRITICAL for ⌘C/⌘V on macOS) ──
  template.push({
    label: t('menu.edit'),
    submenu: [
      { role: 'undo', label: t('menu.undo') },
      { role: 'redo', label: t('menu.redo') },
      { type: 'separator' },
      { role: 'cut', label: t('menu.cut') },
      { role: 'copy', label: t('menu.copy') },
      { role: 'paste', label: t('menu.paste') },
      { role: 'pasteAndMatchStyle', label: t('menu.pasteAndMatchStyle') },
      { role: 'selectAll', label: t('menu.selectAll') },
      ...(isMac
        ? [
            { type: 'separator' as const },
            {
              label: t('menu.speech'),
              submenu: [
                { role: 'startSpeaking' as const, label: t('menu.startSpeaking') },
                { role: 'stopSpeaking' as const, label: t('menu.stopSpeaking') },
              ],
            },
          ]
        : []),
    ],
  })

  // ── View ──
  template.push({
    label: t('menu.view'),
    submenu: [
      {
        // Reads the page again from the server without leaving it (F5 is handled by the page).
        label: t('menu.refresh'),
        accelerator: 'CmdOrCtrl+R',
        click: () => {
          const win = getMainWindow()
          if (win && win.isVisible()) win.webContents.send('refresh-view')
        },
      },
      { role: 'forceReload', label: t('menu.reloadWindow') },
      { role: 'toggleDevTools', label: t('menu.toggleDevTools') },
      { type: 'separator' },
      { role: 'resetZoom', label: t('menu.actualSize') },
      { role: 'zoomIn', label: t('menu.zoomIn') },
      { role: 'zoomOut', label: t('menu.zoomOut') },
      { type: 'separator' },
      { role: 'togglefullscreen', label: t('menu.toggleFullScreen') },
    ],
  })

  // ── Window ──
  template.push({
    label: t('menu.window'),
    submenu: [
      { role: 'minimize', label: t('menu.minimize') },
      { role: 'zoom', label: t('menu.zoom') },
      ...(isMac
        ? [
            { type: 'separator' as const },
            { role: 'front' as const, label: t('menu.bringAllToFront') },
            { type: 'separator' as const },
            { role: 'window' as const, label: t('menu.window') },
          ]
        : [{ role: 'close' as const, label: t('menu.closeWindow') }]),
    ],
  })

  // ── Help ──
  template.push({
    role: 'help',
    label: t('menu.help'),
    submenu: [
      {
        label: t('menu.documentation'),
        click: () => shell.openExternal('https://vikunja.io/docs'),
      },
    ],
  })

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
