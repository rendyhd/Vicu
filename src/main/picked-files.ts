import { randomUUID } from 'crypto'
import * as path from 'path'
import { promises as fsPromises } from 'fs'

/**
 * Files the user picked in the attach dialog, held here between the pick and their uploads so the
 * renderer can show each one uploading. The renderer only ever sees a token, a name and a size: it
 * names a file to upload by its token, never by a path, so it cannot send a file the user did not
 * pick. A token is used once and is forgotten after ten minutes.
 */
export interface PickedFile {
  token: string
  name: string
  /** Bytes, from stat; 0 when the file could not be read (its upload then says why). */
  size: number
}

const TOKEN_TTL_MS = 10 * 60_000

interface Held {
  path: string
  at: number
}

export interface PickedFilesDeps {
  stat(filePath: string): Promise<{ size: number }>
  now(): number
  newToken(): string
}

const realDeps: PickedFilesDeps = {
  stat: (filePath) => fsPromises.stat(filePath),
  now: () => Date.now(),
  newToken: () => randomUUID(),
}

export class PickedFiles {
  private readonly held = new Map<string, Held>()

  constructor(private readonly deps: PickedFilesDeps = realDeps) {}

  /** Holds [paths] and returns what the renderer may know about each, in the order picked. */
  async remember(paths: readonly string[]): Promise<PickedFile[]> {
    this.forgetOld()
    const picked: PickedFile[] = []
    for (const filePath of paths) {
      let size = 0
      try {
        size = (await this.deps.stat(filePath)).size
      } catch {
        // Unreadable now: the upload says why.
      }
      const token = this.deps.newToken()
      this.held.set(token, { path: filePath, at: this.deps.now() })
      picked.push({ token, name: path.basename(filePath), size })
    }
    return picked
  }

  /** The path behind [token], once; null for a token that is unknown, used or too old. */
  take(token: unknown): string | null {
    this.forgetOld()
    if (typeof token !== 'string') return null
    const held = this.held.get(token)
    if (!held) return null
    this.held.delete(token)
    return held.path
  }

  private forgetOld(): void {
    const now = this.deps.now()
    for (const [token, held] of this.held) {
      if (now - held.at > TOKEN_TTL_MS) this.held.delete(token)
    }
  }
}
