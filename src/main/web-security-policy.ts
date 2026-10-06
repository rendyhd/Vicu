// Pure URL decisions for the Electron web-security guards (D-SEC-1). Nothing in
// here touches Electron, so it can be unit-tested directly. The Electron glue
// lives in web-security.ts.

/**
 * Session partition used by the OIDC sign-in and silent-reauth windows. Those
 * windows load third-party identity-provider pages, have no preload and are
 * sandboxed, so they are exempt from the app-origin navigation guards (the
 * guards would otherwise block the whole sign-in flow).
 */
export const AUTH_WINDOW_PARTITION = 'persist:oidc-auth'

/** Where the app's own pages come from. */
export interface AppOrigin {
  /** Vite dev server URL (ELECTRON_RENDERER_URL) when running `npm run dev`. */
  devServerUrl?: string | null
  /** Absolute filesystem path of the packaged renderer directory (out/renderer). */
  rendererDir?: string | null
  /** Compare packaged file paths case-insensitively (Windows and macOS). */
  caseInsensitivePaths?: boolean
}

/** Schemes that may be handed to the operating system via shell.openExternal. */
const EXTERNAL_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:', 'mailto:', 'obsidian:'])

function parseUrl(url: unknown): URL | null {
  if (typeof url !== 'string' || url.length === 0) return null
  try {
    return new URL(url)
  } catch {
    return null
  }
}

/**
 * True when `url` is one of the app's own pages: the dev server origin in
 * development, or a file under the packaged renderer directory in production
 * (main window, Quick Entry and Quick View all live there).
 */
export function isAppUrl(url: unknown, origin: AppOrigin): boolean {
  const parsed = parseUrl(url)
  if (!parsed) return false

  if (origin.devServerUrl) {
    const dev = parseUrl(origin.devServerUrl)
    if (!dev) return false
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.origin === dev.origin
  }

  if (!origin.rendererDir) return false
  if (parsed.protocol !== 'file:') return false
  // Reject UNC-style file://host/share URLs: the app never loads from a host.
  if (parsed.host !== '') return false
  // Encoded separators are how a traversal would hide from the URL parser.
  if (/%2f|%5c/i.test(parsed.pathname)) return false

  // Compare decoded filesystem paths rather than URL strings, so differences in
  // how Chromium and Node percent-encode unusual characters in the install
  // path (spaces, accents, brackets) can never make the app distrust itself.
  let targetPath: string
  try {
    targetPath = decodeURIComponent(parsed.pathname)
  } catch {
    return false
  }
  // A leading slash before a drive letter is URL syntax, not part of the path.
  targetPath = targetPath.replace(/^\/(?=[A-Za-z]:)/, '')
  if (targetPath.split('/').includes('..')) return false

  let rootPath = origin.rendererDir.replace(/\\/g, '/')
  if (!rootPath.endsWith('/')) rootPath += '/'
  if (origin.caseInsensitivePaths) {
    targetPath = targetPath.toLowerCase()
    rootPath = rootPath.toLowerCase()
  }
  return targetPath.startsWith(rootPath)
}

/**
 * True when `url` may be opened in the user's default handler (browser, mail
 * client, Obsidian). Anything else (file:, javascript:, data:, custom schemes)
 * is dropped.
 */
export function isExternalAllowed(url: unknown): boolean {
  const parsed = parseUrl(url)
  return !!parsed && EXTERNAL_PROTOCOLS.has(parsed.protocol)
}

export type NavigationDecision = 'allow' | 'external' | 'block'

/**
 * What to do with a main-frame navigation request: let app pages through, hand
 * allowlisted external links to the OS, drop everything else (a dropped file, a
 * javascript: URL, an unknown scheme).
 */
export function decideNavigation(url: unknown, origin: AppOrigin): NavigationDecision {
  if (isAppUrl(url, origin)) return 'allow'
  if (isExternalAllowed(url)) return 'external'
  return 'block'
}

/** Structural subset of an IPC event, so the check is testable without Electron. */
export interface SenderEventLike {
  senderFrame?: { url: string; parent?: unknown } | null
}

/**
 * IPC senders are trusted only when the calling frame is a top-level app page.
 * A null frame (already destroyed) or a subframe is rejected.
 */
export function isTrustedSender(event: SenderEventLike | null | undefined, origin: AppOrigin): boolean {
  const frame = event?.senderFrame
  if (!frame) return false
  if (frame.parent) return false
  return isAppUrl(frame.url, origin)
}
