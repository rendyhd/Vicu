import { sendToAllWindows } from './host/windows'

// The shortcuts the desktop's application menu owns (src/main/app-menu.ts), for a browser tab,
// which has no menu: the same messages reach the page. A browser keeps Ctrl+N for a new window and
// never shows it to a page, so New task is Alt+N here (src/renderer/lib/host-shortcuts.ts names the
// keys the page shows).

export function startShortcuts(): void {
  window.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.repeat) return
    const mod = event.ctrlKey || event.metaKey
    // `code`, not `key`: with Alt held a Mac types another letter.
    if (event.altKey && !mod && !event.shiftKey && event.code === 'KeyN') {
      event.preventDefault()
      sendToAllWindows('new-task')
    } else if (mod && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'p') {
      // The app's own print layout of the list, instead of a print of the page with its sidebar.
      event.preventDefault()
      sendToAllWindows('print-view')
    } else if (mod && !event.altKey && !event.shiftKey && event.key === ',') {
      event.preventDefault()
      sendToAllWindows('navigate', '/settings')
    }
  })
}
