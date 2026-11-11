// Importing a calendar file into Events, once (contract 20.10, plan phase 2f): the main process opens
// the file dialog, reads the file and gives the window a preview, with and without Busy only. The
// window writes the Events (one synced-preferences change) and offers Undo. The file's path never
// reaches a window; nothing stays linked to the file.

import { BrowserWindow, dialog } from 'electron'
import { readFile, stat } from 'fs/promises'
import { basename } from 'path'
import { handleTrusted } from '../secure-ipc'
import { stripBom } from '../atomic-file'
import { toLocalDate } from '../../shared/due-dates'
import type { IcsImportPreview } from '../../shared/ics-import'
import { importPreview } from './ics-import'

/** A calendar file larger than this is not read (ical.js parses in the main process). */
const MAX_FILE_BYTES = 5 * 1024 * 1024

type ImportResult = { success: true; data: IcsImportPreview | null } | { success: false; error: string }

export function registerCalendarImportIpc(): void {
  handleTrusted('calendar:import-file', async (event): Promise<ImportResult> => {
    const parent = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      title: 'Import a calendar file',
      buttonLabel: 'Open',
      filters: [
        { name: 'Calendar files', extensions: ['ics', 'ical', 'icalendar', 'ifb'] },
        { name: 'All files', extensions: ['*'] },
      ],
      properties: ['openFile'],
    }
    const picked = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
    const path = picked.canceled ? undefined : picked.filePaths[0]
    if (!path) return { success: true, data: null }
    try {
      const info = await stat(path)
      if (info.size > MAX_FILE_BYTES) return { success: false, error: 'The file is too large to import (more than 5 MB).' }
      const text = stripBom(await readFile(path, 'utf8'))
      return importPreview(text, basename(path), toLocalDate(new Date()))
    } catch {
      return { success: false, error: 'The file could not be opened.' }
    }
  })
}
