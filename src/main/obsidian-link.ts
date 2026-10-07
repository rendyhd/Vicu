/**
 * Decisions about Obsidian note links, kept free of Electron and the network so they can be tested
 * with fakes. The Local REST API calls are passed in.
 *
 * A note gets a `uid` frontmatter property only when the user actually links it: Quick Entry shows
 * a path-based link on every open (read-only), and the uid is written when a task is saved with
 * that link (D-OBS-1). Writing on show modified notes the user never chose to link.
 */

export interface ObsidianNoteContext {
  deepLink: string
  noteName: string
  vaultName: string
  /** Vault-relative path of the note the link was built for; checked again before any write. */
  notePath: string
  /** True when the link uses the note's uid (survives renames); false for a path-based link. */
  isUidBased: boolean
}

export interface ActiveNote {
  path: string
  frontmatter?: Record<string, unknown>
}

export interface ObsidianLinkDeps {
  getActiveNote(): Promise<ActiveNote | null>
  /** Writes `uid` into the active note's frontmatter; false when Obsidian refused or is gone. */
  injectUid(uid: string): Promise<boolean>
  newUid(): string
}

type UidState = { kind: 'present'; uid: string } | { kind: 'absent' } | { kind: 'unusable' }

function readUid(frontmatter: Record<string, unknown> | undefined): UidState {
  const raw = frontmatter?.uid
  if (raw === undefined || raw === null) return { kind: 'absent' }
  if (typeof raw === 'string') return raw.trim() ? { kind: 'present', uid: raw } : { kind: 'absent' }
  if (typeof raw === 'number' && Number.isFinite(raw)) return { kind: 'present', uid: String(raw) }
  // An array or object: not ours to overwrite, and not usable in a link.
  return { kind: 'unusable' }
}

export function buildObsidianDeepLink(vaultName: string, notePath: string, uid: string): string {
  if (uid) {
    return `obsidian://advanced-uri?vault=${encodeURIComponent(vaultName)}&uid=${encodeURIComponent(uid)}`
  }
  const pathWithoutMd = notePath.replace(/\.md$/i, '')
  return `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(pathWithoutMd)}`
}

/** What Quick Entry shows for the active note. Read-only: never writes to Obsidian. */
export function describeActiveNote(note: ActiveNote, vaultName: string): ObsidianNoteContext {
  const notePath = note.path || ''
  const noteName = notePath.replace(/\.md$/i, '').split('/').pop() || 'Untitled'
  const state = readUid(note.frontmatter)
  const uid = state.kind === 'present' ? state.uid : ''
  return {
    deepLink: buildObsidianDeepLink(vaultName, notePath, uid),
    noteName,
    vaultName,
    notePath,
    isUidBased: uid !== '',
  }
}

/**
 * Called when a task is being saved with the note linked. Gives the note a uid and returns the
 * uid-based link, or returns the context unchanged (path link) when that cannot be done safely:
 * the note in front is no longer the one that was shown, Obsidian is unreachable, or the write
 * failed. A note that already has a uid is never written to.
 */
export async function resolveLinkForSave(
  context: ObsidianNoteContext,
  deps: ObsidianLinkDeps,
): Promise<ObsidianNoteContext> {
  if (context.isUidBased) return context

  const active = await deps.getActiveNote()
  // The write goes to whatever note is active, so only write when it is the linked one.
  if (!active || active.path !== context.notePath) return context

  const state = readUid(active.frontmatter)
  if (state.kind === 'unusable') return context
  if (state.kind === 'present') {
    return { ...context, deepLink: buildObsidianDeepLink(context.vaultName, context.notePath, state.uid), isUidBased: true }
  }

  const uid = deps.newUid()
  const written = await deps.injectUid(uid)
  if (!written) return context
  return { ...context, deepLink: buildObsidianDeepLink(context.vaultName, context.notePath, uid), isUidBased: true }
}
