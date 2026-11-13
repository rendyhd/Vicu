// `vicu://` links (Pro plan 7.1.10): for other apps, mail rules and scripts. Pure, no Electron.
//
//   vicu://task/<id>                          opens the task in the main window
//   vicu://add?title=&project=&due=           opens Quick Entry with the text filled in; never creates
//   vicu://view/<smart list>                  opens a smart list
//
// Anything else is ignored. A link is only read, never trusted to do more than these.

export const DEEP_LINK_SCHEME = 'vicu'

export const DEEP_LINK_VIEWS = ['inbox', 'today', 'upcoming', 'anytime', 'logbook', 'plan', 'review', 'routines', 'flagged', 'waiting'] as const
export type DeepLinkView = (typeof DEEP_LINK_VIEWS)[number]

export type DeepLink =
  | { kind: 'task'; id: number }
  | { kind: 'add'; title: string; project: string | null; due: string | null }
  | { kind: 'view'; view: DeepLinkView }

const MAX_TEXT = 500

function text(value: string | null): string | null {
  if (value === null) return null
  // Line breaks and control characters would make the one-line title field misbehave.
  const clean = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  return clean ? clean.slice(0, MAX_TEXT) : null
}

export function parseDeepLink(raw: string): DeepLink | null {
  if (typeof raw !== 'string' || raw.length > 4096) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== `${DEEP_LINK_SCHEME}:`) return null
  // `vicu://task/12` puts "task" in the host; `vicu:task/12` in the path. Both read the same.
  let parts: string[]
  try {
    parts = [url.hostname, ...url.pathname.split('/')].map((part) => decodeURIComponent(part).trim()).filter(Boolean)
  } catch {
    // A bad percent-escape such as `%E0` is not a link we know; it must never throw into the app.
    return null
  }
  const [route, arg] = parts
  switch (route?.toLowerCase()) {
    case 'task': {
      if (!arg || !/^\d{1,12}$/.test(arg)) return null
      const id = Number(arg)
      return id > 0 ? { kind: 'task', id } : null
    }
    case 'add': {
      const title = text(url.searchParams.get('title'))
      if (!title) return null
      return { kind: 'add', title, project: text(url.searchParams.get('project')), due: text(url.searchParams.get('due')) }
    }
    case 'view': {
      const view = arg?.toLowerCase()
      return view && (DEEP_LINK_VIEWS as readonly string[]).includes(view) ? { kind: 'view', view: view as DeepLinkView } : null
    }
    default:
      return null
  }
}

/** The link among a launch's arguments (Windows and Linux pass it there). */
export function deepLinkFromArgv(argv: readonly string[]): DeepLink | null {
  for (const arg of argv) {
    if (typeof arg === 'string' && arg.toLowerCase().startsWith(`${DEEP_LINK_SCHEME}:`)) {
      const link = parseDeepLink(arg)
      if (link) return link
    }
  }
  return null
}

/** The route a view link opens in the main window. */
export function routeOfView(view: DeepLinkView): string {
  return view === 'waiting' ? '/waiting-on' : `/${view}`
}

/**
 * The text Quick Entry starts with: the title, then the project in the syntax in use, then the due
 * phrase, so the parser reads them as if typed.
 */
export function quickEntryText(link: Extract<DeepLink, { kind: 'add' }>, projectPrefix: string): string {
  const parts = [link.title]
  if (link.project) parts.push(`${projectPrefix}${/\s/.test(link.project) ? `"${link.project}"` : link.project}`)
  if (link.due) parts.push(link.due)
  return parts.join(' ')
}
