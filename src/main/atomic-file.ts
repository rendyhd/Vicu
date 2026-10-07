import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  fsyncSync,
} from 'fs'
import { promises as fsp } from 'fs'
import { basename, dirname } from 'path'

// Crash-safe persistence for the small JSON files in userData (config.json,
// auth.json, offline-cache.json, install-id). A plain writeFileSync truncates
// the file first, so a crash or power loss mid-write leaves unparseable data and
// the app falls back to the Setup screen with every setting gone (D-CFG-1).

export function backupPathFor(path: string): string {
  return `${path}.bak`
}

function tmpPathFor(path: string): string {
  return `${path}.tmp`
}

function isParseableJson(raw: string): boolean {
  try {
    JSON.parse(raw)
    return true
  } catch {
    return false
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** The errors a file that another process is holding for a moment fails with (antivirus, search indexer, backup tools). */
export function isTransientFileError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code
  return code === 'EPERM' || code === 'EBUSY' || code === 'EACCES'
}

/** Block the thread for `ms` without spinning. Only for the few milliseconds a synchronous retry waits. */
export function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/**
 * Synchronous twin of `retryTransient`: run `fn`, retrying while `isTransient` says the error is
 * worth another try, and wait `delayMs`, doubling each time, between attempts. The total wait is
 * bounded by `attempts` (the last attempt is not followed by a wait).
 */
export function retryTransientSync<T>(
  fn: () => T,
  options: { attempts: number; delayMs: number; isTransient: (err: unknown) => boolean; sleep?: (ms: number) => void }
): T {
  const sleep = options.sleep ?? sleepSync
  for (let attempt = 1; ; attempt++) {
    try {
      return fn()
    } catch (err) {
      if (attempt >= options.attempts || !options.isTransient(err)) throw err
      sleep(options.delayMs * 2 ** (attempt - 1))
    }
  }
}

/** The file operations of `writeFileAtomic` that a test replaces to simulate a locked file. */
export interface AtomicWriteHooks {
  rename?: (from: string, to: string) => void
  /** Wait between rename attempts. */
  sleep?: (ms: number) => void
  /** Replace the target's contents in place, the last resort when the rename stays locked. */
  writeInPlace?: (path: string, data: string, mode?: number) => void
}

/** Rename attempts before giving up on the temp file: waits of 15, 30, 60, 120 and 240 ms in between. */
const SYNC_RENAME_ATTEMPTS = 6
const SYNC_RENAME_DELAY_MS = 15

function writeInPlaceSync(path: string, data: string, mode?: number): void {
  const fd = openSync(path, 'w', mode)
  try {
    writeFileSync(fd, data, 'utf-8')
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

/**
 * Replace `path` with `data` atomically: write and fsync a temp file next to it,
 * then rename it over the target. A crash at any point leaves either the old or
 * the new file, never a partial one. With `backup`, the previous file is first
 * copied to `<path>.bak`, but only while it still parses as JSON, so a corrupt
 * file can never overwrite the last good backup.
 *
 * On Windows the rename fails with EPERM/EBUSY/EACCES while another process holds the target. It
 * is retried for a short while (bounded, so the main thread is blocked for half a second at most);
 * if the target stays locked, the contents are written in place instead. That is not crash-safe by
 * itself, but the previous file is already in the backup when `backup` is set, and a save that
 * fails is worse than one that is not atomic. The error is thrown only when nothing worked.
 */
export function writeFileAtomic(
  path: string,
  data: string,
  options: { backup?: boolean; mode?: number; hooks?: AtomicWriteHooks } = {}
): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = tmpPathFor(path)
  const rename = options.hooks?.rename ?? renameSync
  const writeInPlace = options.hooks?.writeInPlace ?? writeInPlaceSync
  try {
    const fd = openSync(tmp, 'w', options.mode)
    try {
      writeFileSync(fd, data, 'utf-8')
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    if (options.backup) keepBackup(path)
    try {
      retryTransientSync(() => rename(tmp, path), {
        attempts: SYNC_RENAME_ATTEMPTS,
        delayMs: SYNC_RENAME_DELAY_MS,
        isTransient: isTransientFileError,
        sleep: options.hooks?.sleep,
      })
    } catch (renameError) {
      if (!isTransientFileError(renameError)) throw renameError
      try {
        writeInPlace(path, data, options.mode)
        console.warn(`[Files] ${basename(path)} stayed locked; wrote it in place (${errorMessage(renameError)})`)
        try {
          unlinkSync(tmp)
        } catch {
          // The temp file is only a leftover now.
        }
      } catch (inPlaceError) {
        console.warn(`[Files] Could not write ${basename(path)} in place either:`, errorMessage(inPlaceError))
        throw renameError
      }
    }
  } catch (err) {
    try {
      unlinkSync(tmp)
    } catch {
      // Nothing left to clean up.
    }
    throw err
  }
}

function keepBackup(path: string): void {
  try {
    if (!existsSync(path)) return
    if (!isParseableJson(readFileSync(path, 'utf-8'))) return
    copyFileSync(path, backupPathFor(path))
  } catch (err) {
    // A backup problem must never block saving the new data.
    console.warn(`[Files] Could not back up ${basename(path)}:`, errorMessage(err))
  }
}

/**
 * Run `fn`, retrying while `isTransient` says the error is worth another try.
 * Used for the final rename: on Windows an antivirus scanner or the search
 * indexer can hold the target for a few milliseconds and fail the rename with
 * EPERM/EBUSY/EACCES even though nothing is wrong.
 */
export async function retryTransient<T>(
  fn: () => Promise<T>,
  options: { attempts: number; delayMs: number; isTransient: (err: unknown) => boolean }
): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= options.attempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      if (attempt === options.attempts || !options.isTransient(err)) throw err
      await new Promise((resolve) => setTimeout(resolve, options.delayMs * attempt))
    }
  }
  throw lastError
}

/**
 * Async twin of `writeFileAtomic` for hot paths: the event loop keeps running
 * while the data is written and fsynced. Same guarantees (temp file + rename, an
 * optional parse-checked `.bak`). Callers that can overlap must serialize their
 * writes themselves because both writers share one `<path>.tmp`; the offline
 * stores do that through `JsonFileStore`.
 */
export async function writeFileAtomicAsync(
  path: string,
  data: string | Uint8Array,
  options: { backup?: boolean; mode?: number } = {}
): Promise<void> {
  await fsp.mkdir(dirname(path), { recursive: true })
  const tmp = tmpPathFor(path)
  try {
    const handle = await fsp.open(tmp, 'w', options.mode)
    try {
      await handle.writeFile(data, typeof data === 'string' ? 'utf-8' : undefined)
      await handle.sync()
    } finally {
      await handle.close()
    }
    if (options.backup) await keepBackupAsync(path)
    await retryTransient(() => fsp.rename(tmp, path), {
      attempts: 5,
      delayMs: 20,
      isTransient: isTransientFileError,
    })
  } catch (err) {
    try {
      await fsp.unlink(tmp)
    } catch {
      // Nothing left to clean up.
    }
    throw err
  }
}

async function keepBackupAsync(path: string): Promise<void> {
  try {
    let previous: string
    try {
      previous = await fsp.readFile(path, 'utf-8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
      throw err
    }
    if (!isParseableJson(previous)) return
    await fsp.copyFile(path, backupPathFor(path))
  } catch (err) {
    // A backup problem must never block saving the new data.
    console.warn(`[Files] Could not back up ${basename(path)}:`, errorMessage(err))
  }
}

/**
 * Read and parse `path`. When the file exists but cannot be read or parsed, fall
 * back to `<path>.bak` and log it. A missing file is a normal "nothing saved yet"
 * and returns null, as does a file with no usable backup. After a parse failure
 * the backup is copied back over the broken file so later reads see good data;
 * after a plain read error (for example a file briefly locked by antivirus) the
 * main file is left alone, since it may hold newer data than the backup.
 */
export function readFileWithBackup<T>(
  path: string,
  parse: (raw: string) => T
): { value: T; recovered: boolean } | null {
  if (!existsSync(path)) return null

  const name = basename(path)
  let primaryError: unknown
  let readFailed = false
  try {
    const raw = readFileSync(path, 'utf-8')
    try {
      return { value: parse(raw), recovered: false }
    } catch (err) {
      primaryError = err
    }
  } catch (err) {
    primaryError = err
    readFailed = true
  }

  const backup = backupPathFor(path)
  if (existsSync(backup)) {
    try {
      const value = parse(readFileSync(backup, 'utf-8'))
      console.warn(`[Files] ${name} is unreadable (${errorMessage(primaryError)}); using ${basename(backup)}`)
      if (!readFailed) {
        try {
          const tmp = tmpPathFor(path)
          copyFileSync(backup, tmp)
          renameSync(tmp, path)
        } catch (err) {
          console.warn(`[Files] Could not restore ${name} from its backup:`, errorMessage(err))
        }
      }
      return { value, recovered: true }
    } catch {
      // The backup is unusable too.
    }
  }

  console.warn(`[Files] ${name} is unreadable (${errorMessage(primaryError)}) and has no usable backup`)
  return null
}

/** Delete `path` together with its backup and any leftover temp file. */
export function removeFileAndBackup(path: string): void {
  for (const file of [path, backupPathFor(path), tmpPathFor(path)]) {
    try {
      unlinkSync(file)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
  }
}
