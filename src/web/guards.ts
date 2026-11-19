import { isExternalAllowed, safeExternalUrl } from '../main/web-security-policy'

// What the desktop's main process guards for every window (src/main/web-security.ts), for a page
// in a browser tab: the tab never leaves the app because of a link in a task's notes, a file
// dropped in the wrong place does not replace the app, and a tab left open across a new version
// loads that version instead of failing on a file that is gone.

const RELOADED_KEY = 'vicu-web-reloaded-for'

/** What a click on a link may do: stay in the app, open elsewhere, or nothing at all. */
export type LinkDecision = { kind: 'app' } | { kind: 'external'; url: string } | { kind: 'block' }

/**
 * Decide a link by its address. Only an address inside this page (its hash router) stays in the
 * tab; a web or mail address opens outside it; every other scheme (`obsidian:`, `javascript:`,
 * `file:`, `data:`) is refused, as on the desktop.
 */
export function decideLink(href: string, page: string): LinkDecision {
  let target: URL
  let here: URL
  try {
    here = new URL(page)
    target = new URL(href, here)
  } catch {
    return { kind: 'block' }
  }
  const sameDocument = target.origin === here.origin && target.pathname === here.pathname && target.search === here.search
  if (sameDocument && (target.protocol === 'http:' || target.protocol === 'https:')) return { kind: 'app' }
  if (!isExternalAllowed(target.href)) return { kind: 'block' }
  return { kind: 'external', url: safeExternalUrl(target.href) }
}

function linkOf(event: Event): HTMLAnchorElement | null {
  const path = event.composedPath()
  for (const node of path) {
    if (node instanceof HTMLAnchorElement && node.hasAttribute('href')) return node
  }
  return null
}

function onLinkClick(event: MouseEvent): void {
  // The host's own downloads and mail links are clicks made by code (src/web/files.ts).
  if (!event.isTrusted) return
  const link = linkOf(event)
  if (!link) return
  const decision = decideLink(link.getAttribute('href') ?? '', window.location.href)
  if (decision.kind === 'app') return
  // The page's own handler (the notes' link button, a task's link icon) may still run; the
  // browser's navigation does not.
  event.preventDefault()
  if (decision.kind === 'block') return
  if (decision.url.startsWith('mailto:')) window.location.href = decision.url
  else window.open(decision.url, '_blank', 'noopener,noreferrer')
}

export function startGuards(): void {
  // Capture, so no handler of the page can let a navigation through by stopping the event.
  document.addEventListener('click', onLinkClick, true)
  document.addEventListener('auxclick', onLinkClick, true)

  // A file dropped outside a drop zone would open in the tab, in place of the app. The app's own
  // drop zones handle the event first and are not affected.
  window.addEventListener('dragover', (event) => {
    if (event.dataTransfer?.types.includes('Files')) event.preventDefault()
  })
  window.addEventListener('drop', (event) => {
    if (event.dataTransfer?.types.includes('Files')) event.preventDefault()
  })

  // A part of the app that is loaded later is gone after an update: load the new version, once
  // per version, instead of showing a broken view.
  window.addEventListener('vite:preloadError', (event) => {
    const version = __APP_VERSION__
    try {
      if (sessionStorage.getItem(RELOADED_KEY) === version) return
      sessionStorage.setItem(RELOADED_KEY, version)
    } catch {
      return
    }
    event.preventDefault()
    window.location.reload()
  })
}
