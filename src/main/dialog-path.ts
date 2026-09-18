import { existsSync } from 'fs'
import { dirname } from 'path'

/**
 * Resolve the initial directory for a file open dialog.
 * Electron 43+ defaults to Downloads and no longer restores the OS last-used
 * folder — callers should persist and pass an explicit defaultPath.
 */
export function resolveDialogDefaultPath(
  persistedDirectory: string | null | undefined,
  fallbackDirectory: string
): string {
  if (typeof persistedDirectory === 'string' && persistedDirectory.length > 0 && existsSync(persistedDirectory)) {
    return persistedDirectory
  }
  return fallbackDirectory
}

/** Persist the directory containing a successfully chosen file. */
export function directoryFromSelectedFile(filePath: string): string {
  return dirname(filePath)
}
