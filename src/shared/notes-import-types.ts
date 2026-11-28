/**
 * What the notes dialog (docs/ai-assistant-v1.md section 4.9) and the main process exchange: the
 * files picked in main's open dialog, as bytes with a name and type, never a path.
 */

/** Why a picked file cannot be used. */
export type NotesFileProblem = 'type' | 'size' | 'heic' | 'unreadable'

export interface NotesFile {
  name: string
  /** A media type by the extension (`application/pdf`, `image/jpeg`, `text/plain` ...), '' when unknown. */
  type: string
  bytes?: Uint8Array
  /** The file's last change, ms since the epoch: the notes' date when it is the first file. */
  modified?: number
  problem?: NotesFileProblem
}

export interface NotesPickResult {
  files: NotesFile[]
}
