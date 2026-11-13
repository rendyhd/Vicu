// What an open card's notes editor does when the task's notes change in the cache (a refresh after
// another device or person edited them). Description format, "Synchronization": a clean editor
// takes the newer document; an editor with unsaved text is never silently replaced (review C-5).

export interface NotesEditorState {
  /** The text in the editor. */
  edit: string
  /** What the editor last loaded or saved; null until the editor is ready. Unsaved text differs from it. */
  baseline: string | null
}

/** True when the editor holds text the user has not saved yet. */
export function hasUnsavedNotes(state: NotesEditorState): boolean {
  return state.baseline !== null && state.edit !== state.baseline
}

/**
 * The editor after the cached notes became `server`. With unsaved text both the text and the
 * baseline stay, so the user's next save still goes out (and wins, as every notes save does).
 * Otherwise the editor shows `server` and, once ready, takes it as its baseline.
 */
export function notesAfterServerChange(state: NotesEditorState, server: string): NotesEditorState {
  if (hasUnsavedNotes(state)) return state
  return { edit: server, baseline: state.baseline === null ? null : server }
}

// The base of a notes save (description format, "Notes changed in two places"): the raw description
// the server stored when the editor's text was loaded from it. The save carries it, so main can tell
// whether another device changed the notes in between and keep both versions.

/** The base after the cached notes became `rawServer`: unsaved text keeps the base it was typed on. */
export function notesBaseAfterServerChange(state: NotesEditorState, base: string, rawServer: string): string {
  return hasUnsavedNotes(state) ? base : rawServer
}

/**
 * The base after a save answered. `answered` is the description the server answered with (null when
 * the save was queued and nothing answered); `saved` the description the save sent. When the server
 * holds other notes than were saved (merged with another device's) while the editor holds newer
 * unsaved text, that text was typed on what was saved, not on the server's notes, so the base stays
 * `saved` and the next save keeps the other device's text too.
 */
export function notesBaseAfterSave(answered: string | null, saved: string, unsaved: boolean): string {
  if (answered === null) return saved
  if (unsaved && answered !== saved) return saved
  return answered
}
