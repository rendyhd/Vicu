import { app, Menu, shell, BrowserWindow, MenuItemConstructorOptions } from 'electron'
import { isMac } from './platform'

export function setupApplicationMenu(getMainWindow: () => BrowserWindow | null): void {
  const template: MenuItemConstructorOptions[] = []

  // ── macOS App submenu (first item, app name) ──
  if (isMac) {
    template.push({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Preferences…',
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
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    })
  }

  // ── File ──
  template.push({
    label: 'File',
    submenu: [
      {
        label: 'New Task',
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
      isMac ? { role: 'close' } : { role: 'quit' },
    ],
  })

  // ── Edit (CRITICAL for ⌘C/⌘V on macOS) ──
  template.push({
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'pasteAndMatchStyle' },
      { role: 'selectAll' },
      ...(isMac
        ? [
            { type: 'separator' as const },
            {
              label: 'Speech',
              submenu: [
                { role: 'startSpeaking' as const },
                { role: 'stopSpeaking' as const },
              ],
            },
          ]
        : []),
    ],
  })

  // ── View ──
  template.push({
    label: 'View',
    submenu: [
      { role: 'reload' },
      { role: 'forceReload' },
      { role: 'toggleDevTools' },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
    ],
  })

  // ── Window ──
  template.push({
    label: 'Window',
    submenu: [
      { role: 'minimize' },
      { role: 'zoom' },
      ...(isMac
        ? [
            { type: 'separator' as const },
            { role: 'front' as const },
            { type: 'separator' as const },
            { role: 'window' as const },
          ]
        : [{ role: 'close' as const }]),
    ],
  })

  // ── Help ──
  template.push({
    role: 'help',
    submenu: [
      {
        label: 'Documentation',
        click: () => shell.openExternal('https://vikunja.io/docs'),
      },
    ],
  })

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
