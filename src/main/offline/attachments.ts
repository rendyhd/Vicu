import { randomBytes } from 'crypto'
import { promises as fsp } from 'fs'
import { join } from 'path'
import { writeFileAtomicAsync } from '../atomic-file'

/** Offline attachment files live here, inside userData. */
export const OFFLINE_ATTACHMENTS_DIRNAME = 'offline-attachments'

const STORED_NAME = /^[a-f0-9]{16}\.bin$/

/**
 * Images pasted into Quick Entry while offline (D-QE-1). The bytes are kept on disk, not in the
 * queue file, so the queue stays small and a large paste is not re-serialized on every write.
 *
 * Files are named by a random id the queue generates. The caller's file name is only kept as
 * display text in the queued action, so a hostile name can never become a path.
 */
export class OfflineAttachmentFiles {
  constructor(readonly dir: string) {}

  private pathFor(file: string): string {
    if (!STORED_NAME.test(file)) throw new Error(`Invalid offline attachment name: ${file}`)
    return join(this.dir, file)
  }

  /** Write the bytes (atomically, readable by the current user only) and return the stored name. */
  async save(bytes: Uint8Array): Promise<string> {
    const name = `${randomBytes(8).toString('hex')}.bin`
    await writeFileAtomicAsync(join(this.dir, name), bytes, { mode: 0o600 })
    return name
  }

  async read(file: string): Promise<Buffer> {
    return fsp.readFile(this.pathFor(file))
  }

  /** Delete a file; one that is already gone is not an error. */
  async remove(file: string): Promise<void> {
    try {
      await fsp.unlink(this.pathFor(file))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
  }

  /**
   * Delete stored files that no queued or failed action refers to, plus leftover temp files from an
   * interrupted write. Run at startup: a crash between writing a file and saving the queue, or a
   * discard whose delete failed, would otherwise leave images behind for ever. Returns how many
   * files were deleted.
   */
  async sweep(keep: ReadonlySet<string>): Promise<number> {
    let names: string[]
    try {
      names = await fsp.readdir(this.dir)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 0
      throw err
    }

    let removed = 0
    for (const name of names) {
      const stale = name.endsWith('.bin.tmp') || (STORED_NAME.test(name) && !keep.has(name))
      if (!stale) continue
      try {
        await fsp.unlink(join(this.dir, name))
        removed++
      } catch {
        // Still in use or already gone; the next startup tries again.
      }
    }
    return removed
  }
}
