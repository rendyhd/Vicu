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
