// Notes to tasks (docs/ai-assistant-v1.md section 4.9) in the main process: the open dialog for
// note files (the window gets the files' bytes and names, never their paths), and the notes kept on
// the device while they are open, so they survive the app closing until they are added or
// discarded (4.9.11). Nothing here is uploaded anywhere.

import { BrowserWindow, app, dialog } from 'electron'
import { execFile } from 'child_process'
import { mkdtemp, readFile, rm, stat } from 'fs/promises'
import { tmpdir } from 'os'
import { basename, extname, join } from 'path'
import { promisify } from 'util'
import { handleTrusted } from './secure-ipc'
import { JsonFileStore } from './json-file-store'
import { isMac } from './platform'
import { t } from '../shared/i18n'
import { AI_LIMITS } from '../shared/ai/contract'
import type { NotesFile, NotesPickResult } from '../shared/notes-import-types'

const run = promisify(execFile)

/** The types a note file is read as, by its extension. */
const TYPES: Record<string, string> = {
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
}

export function notesFileType(name: string): string | null {
  return TYPES[extname(name).toLowerCase()] ?? null
}

/** HEIC is not drawn by Chromium: on macOS `sips` turns it into a JPEG, elsewhere it stays HEIC (4.9.2). */
async function heicAsJpeg(path: string): Promise<Uint8Array | null> {
  if (!isMac) return null
  const dir = await mkdtemp(join(tmpdir(), 'vicu-notes-'))
  try {
    const out = join(dir, 'page.jpg')
    await run('/usr/bin/sips', ['-s', 'format', 'jpeg', path, '--out', out], { timeout: 30_000 })
    return new Uint8Array(await readFile(out))
  } catch {
    return null
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}

async function readNoteFile(path: string): Promise<NotesFile> {
  const name = basename(path)
  const type = notesFileType(name)
  if (!type) return { name, type: '', problem: 'type' }
  const info = await stat(path)
  if (info.size > AI_LIMITS.notes_file_max_mb * 1024 * 1024) return { name, type, problem: 'size' }
  const modified = info.mtimeMs
  if (type === 'image/heic' || type === 'image/heif') {
    const jpeg = await heicAsJpeg(path)
    return jpeg ? { name, type: 'image/jpeg', bytes: jpeg, modified } : { name, type, problem: 'heic' }
  }
  return { name, type, bytes: new Uint8Array(await readFile(path)), modified }
}

// --- The open notes, kept until added or discarded -------------------------------------------------

let store: JsonFileStore<unknown> | null = null

function sessionStore(): JsonFileStore<unknown> {
  if (!store) {
    store = new JsonFileStore<unknown>({
      path: join(app.getPath('userData'), 'notes-import.json'),
      backup: false,
      label: 'Notes', // i18n-ignore: a log label
      empty: () => null,
      parse: (json) => json,
    })
    store.load()
  }
  return store
}

/** Sign-out and account switch: the open notes belong to the account they were made in. */
export async function clearNotesSession(): Promise<void> {
  const s = sessionStore()
  s.state = null
  await s.save()
}

export function registerNotesImportIpc(): void {
  handleTrusted('notes:pick-files', async (event): Promise<NotesPickResult> => {
    const parent = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      title: t('notes.pickTitle'),
      buttonLabel: t('notes.pickButton'),
      filters: [
        { name: t('notes.pickFilter'), extensions: Object.keys(TYPES).map((ext) => ext.slice(1)) },
      ],
      properties: ['openFile', 'multiSelections'],
    }
    const picked = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
    if (picked.canceled) return { files: [] }
    const files: NotesFile[] = []
    for (const path of picked.filePaths.slice(0, AI_LIMITS.notes_pages_max)) {
      try {
        files.push(await readNoteFile(path))
      } catch {
        files.push({ name: basename(path), type: notesFileType(path) ?? '', problem: 'unreadable' })
      }
    }
    return { files }
  })
  handleTrusted('notes:session-get', () => sessionStore().state)
  handleTrusted('notes:session-save', async (_event, session: unknown) => {
    const s = sessionStore()
    s.state = session && typeof session === 'object' ? session : null
    await s.save()
    return true
  })
  handleTrusted('notes:session-clear', async () => {
    await clearNotesSession()
    return true
  })
}

export async function flushNotesSession(): Promise<void> {
  if (store?.hasUnsavedChanges) await store.save()
}
