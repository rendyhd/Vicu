import { promises as fsPromises } from 'fs'

/**
 * Read a file the user picked for upload without blocking the main process and without reading
 * one the server would refuse anyway. The old picker read every selected file synchronously and
 * whole, so a multi-gigabyte pick froze the app and exhausted memory before any size check
 * (D-IPC-5).
 */
export interface UploadFileDeps {
  stat(path: string): Promise<{ size: number; isFile(): boolean }>
  readFile(path: string): Promise<Buffer>
  /** An error message when `size` is over the server's limit, otherwise null. */
  checkSize(size: number): Promise<string | null>
}

export type LoadedUpload = { ok: true; buffer: Buffer } | { ok: false; error: string }

const realFs = {
  stat: (path: string) => fsPromises.stat(path),
  readFile: (path: string) => fsPromises.readFile(path),
}

export async function loadFileForUpload(
  filePath: string,
  deps: Pick<UploadFileDeps, 'checkSize'> & Partial<Pick<UploadFileDeps, 'stat' | 'readFile'>>
): Promise<LoadedUpload> {
  const stat = deps.stat ?? realFs.stat
  const readFile = deps.readFile ?? realFs.readFile
  try {
    const info = await stat(filePath)
    if (!info.isFile()) return { ok: false, error: 'Only files can be attached, not folders' }

    const tooLarge = await deps.checkSize(info.size)
    if (tooLarge) return { ok: false, error: tooLarge }

    const buffer = await readFile(filePath)
    // The file may have grown between stat and read.
    if (buffer.length !== info.size) {
      const grown = await deps.checkSize(buffer.length)
      if (grown) return { ok: false, error: grown }
    }
    return { ok: true, buffer }
  } catch (err) {
    return { ok: false, error: `Could not read the file: ${err instanceof Error ? err.message : String(err)}` }
  }
}
