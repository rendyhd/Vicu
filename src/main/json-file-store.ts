import { existsSync, renameSync } from 'fs'
import { basename } from 'path'
import { readFileWithBackup, writeFileAtomic, writeFileAtomicAsync } from './atomic-file'

export type LoadStatus = 'missing' | 'ok' | 'recovered' | 'corrupt'

export interface JsonFileStoreOptions<T> {
  path: string
  /** Keep `<path>.bak`, the previous good version, and load it when the file is unreadable. */
  backup: boolean
  /**
   * Set aside an unreadable file that has no usable backup as `<path>.corrupt-<time>`
   * instead of letting the next save overwrite it, so the data can still be salvaged by hand.
   */
  quarantineCorrupt?: boolean
  /** Used in log lines. */
  label: string
  empty: () => T
  /** Turn parsed JSON into the state. Throw when the shape is unusable so the backup is tried. */
  parse: (json: unknown) => T
}

/**
 * One JSON document on disk with its state held in memory (D-SYNC-5).
 *
 * - Reads happen once, at `load()`. Everything after that, including counts, comes from
 *   `state` and never touches the disk.
 * - Writes are asynchronous, atomic (temp file + rename, see atomic-file.ts), compact, and
 *   serialized: only one write runs at a time, and any number of mutations made while one runs
 *   collapse into a single trailing write of the latest state. A snapshot is taken when the write
 *   starts, so a stale snapshot can never overwrite a newer one.
 * - `save()` resolves once a write that includes the caller's mutation has finished, so a caller
 *   that tells the user "saved" can await it.
 * - `saveSync()` is for tiny, rarely written files whose callers need the data on disk before they
 *   return. Never mix it with `save()` on the same store.
 */
export class JsonFileStore<T> {
  state: T

  private version = 0
  private writtenVersion = 0
  private inFlight: Promise<void> = Promise.resolve()
  private queued: Promise<void> | null = null
  private writing = false

  constructor(private readonly options: JsonFileStoreOptions<T>) {
    this.state = options.empty()
  }

  get path(): string {
    return this.options.path
  }

  get hasUnsavedChanges(): boolean {
    return this.version > this.writtenVersion
  }

  /** Read the file once. Safe to call again to reload from disk. */
  load(): LoadStatus {
    const { path, label } = this.options
    const result = readFileWithBackup(path, (raw) => this.options.parse(JSON.parse(raw)))
    if (result) {
      this.state = result.value
      this.version = this.writtenVersion = 0
      return result.recovered ? 'recovered' : 'ok'
    }

    this.state = this.options.empty()
    this.version = this.writtenVersion = 0
    if (!existsSync(path)) return 'missing'

    console.warn(`[Files] ${label}: ${basename(path)} is unreadable and has no usable backup; starting empty`)
    if (this.options.quarantineCorrupt) {
      try {
        renameSync(path, `${path}.corrupt-${Date.now()}`)
      } catch (err) {
        console.warn(`[Files] Could not set aside ${basename(path)}:`, err instanceof Error ? err.message : err)
      }
    }
    return 'corrupt'
  }

  /** Record that `state` changed without scheduling a write. */
  markDirty(): void {
    this.version++
  }

  /** Persist the current state asynchronously. See the class comment for the guarantees. */
  save(): Promise<void> {
    this.version++
    return this.schedule()
  }

  /** Persist the current state before returning. Only for stores that never call `save()`. */
  saveSync(): void {
    if (this.writing) throw new Error(`${basename(this.options.path)}: cannot write synchronously during an async write`)
    const target = this.version
    writeFileAtomic(this.options.path, JSON.stringify(this.state), { backup: this.options.backup })
    this.writtenVersion = Math.max(this.writtenVersion, target)
  }

  /**
   * Wait for every write already started and persist anything still unsaved. Used before the app
   * quits. Never throws: a failing disk at shutdown is logged, there is nothing left to do about it.
   */
  async flush(): Promise<void> {
    try {
      await this.inFlight
      if (this.hasUnsavedChanges) await this.schedule()
    } catch (err) {
      console.warn(`[Files] ${this.options.label}: flush failed:`, err instanceof Error ? err.message : err)
    }
  }

  private schedule(): Promise<void> {
    if (this.queued) return this.queued
    const run = this.inFlight.then(() => {
      // From here on a new mutation needs a new write: this one has not snapshotted yet, but
      // the snapshot below is taken synchronously, so anything after this point is not in it.
      this.queued = null
      return this.writeNow()
    })
    this.queued = run
    // The chain only waits for the write to end, whatever the outcome.
    this.inFlight = run.catch(() => {})
    return run
  }

  private async writeNow(): Promise<void> {
    const target = this.version
    const data = JSON.stringify(this.state)
    this.writing = true
    try {
      await writeFileAtomicAsync(this.options.path, data, { backup: this.options.backup })
      this.writtenVersion = Math.max(this.writtenVersion, target)
    } finally {
      this.writing = false
    }
  }
}
