import { app, session, shell, type WebContents } from 'electron'
import { join } from 'path'
import { isMac, isWindows } from './platform'
import {
  AUTH_WINDOW_PARTITION,
  decideNavigation,
  isAppUrl,
  isExternalAllowed,
  isTrustedSender,
  type AppOrigin,
  type SenderEventLike,
} from './web-security-policy'

export { isAppUrl, isExternalAllowed } from './web-security-policy'

/**
 * Locations the app's own pages are loaded from. Resolved on every call so
 * ELECTRON_RENDERER_URL is read after electron-vite has set it. In the bundle
 * __dirname is out/main, so the renderer sits next to it.
 */
export function getAppOrigin(): AppOrigin {
  return {
    devServerUrl: process.env.ELECTRON_RENDERER_URL || null,
    rendererDir: join(__dirname, '../renderer'),
    caseInsensitivePaths: isWindows || isMac,
  }
}

function openExternally(url: string): void {
  shell.openExternal(url).catch((err: unknown) => {
    console.warn('[WebSecurity] openExternal failed:', err instanceof Error ? err.message : err)
  })
}

function isAuthWindow(contents: WebContents): boolean {
  try {
    return contents.session === session.fromPartition(AUTH_WINDOW_PARTITION)
  } catch {
    return false
  }
}

function guardContents(contents: WebContents): void {
  // <webview> is never used. Without this a compromised page could embed one
  // with its own webPreferences.
  contents.on('will-attach-webview', (event) => {
    event.preventDefault()
  })

  // OIDC sign-in windows have to follow the identity provider's redirects and
  // popups. They run sandboxed without a preload, so they expose nothing.
  if (isAuthWindow(contents)) return

  const onNavigate = (event: { preventDefault: () => void }, url: string): void => {
    const decision = decideNavigation(url, getAppOrigin())
    if (decision === 'allow') return
    event.preventDefault()
    if (decision === 'external') openExternally(url)
  }
  contents.on('will-navigate', onNavigate)

  // App pages never redirect. If one does, refuse it.
  contents.on('will-redirect', (event, url) => {
    if (!isAppUrl(url, getAppOrigin())) event.preventDefault()
  })

  // New windows would inherit this window's webPreferences, so none are ever
  // created. Allowlisted links go to the system handler instead.
  contents.setWindowOpenHandler(({ url }) => {
    if (isExternalAllowed(url)) openExternally(url)
    return { action: 'deny' }
  })
}

let registered = false

/**
 * Install the navigation, window-open and webview guards on every WebContents
 * the app creates (D-SEC-1). Call once, before the first window exists.
 */
export function registerWebSecurity(): void {
  if (registered) return
  registered = true
  app.on('web-contents-created', (_event, contents) => guardContents(contents))
}

/** True when the IPC call came from a top-level app page. */
export function isTrustedIpcSender(event: SenderEventLike): boolean {
  try {
    return isTrustedSender(event, getAppOrigin())
  } catch {
    // senderFrame.url throws if the frame was destroyed mid-call.
    return false
  }
}

/** Throws unless the IPC call came from a top-level app page. */
export function assertTrustedSender(event: SenderEventLike): void {
  if (isTrustedIpcSender(event)) return
  let url = 'unknown'
  try {
    url = event.senderFrame?.url ?? 'no frame'
  } catch { /* destroyed frame */ }
  throw new Error(`Rejected IPC call from untrusted sender: ${url}`)
}
