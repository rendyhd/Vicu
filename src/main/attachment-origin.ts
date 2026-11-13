// Marks a file Vicu wrote from server bytes as "came from the internet" (review S-3), so the
// operating system treats it like any other download: SmartScreen and Office Protected View on
// Windows (the Zone.Identifier stream, Mark-of-the-Web), Gatekeeper on macOS (the quarantine
// attribute). Nothing is done on Linux, which has no such mark. Marking is best effort: a file
// system without alternate data streams (FAT, a network share) or a missing xattr tool leaves the
// file as it is and never fails the open or save.

import { execFile } from 'child_process'
import { writeFile } from 'fs/promises'

/** Zone 3 is "Internet", the zone a browser gives a download. */
const INTERNET_ZONE = 3

/** The web origin of `serverUrl` (http or https only), or null when it has none. */
export function originOf(serverUrl: unknown): string | null {
  if (typeof serverUrl !== 'string' || serverUrl.trim() === '') return null
  try {
    const url = new URL(serverUrl.trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.origin
  } catch {
    return null
  }
}

/** What the `Zone.Identifier` stream holds: the Internet zone and, when known, the server. */
export function zoneIdentifierContent(serverUrl?: unknown): string {
  const origin = originOf(serverUrl)
  let text = `[ZoneTransfer]\r\nZoneId=${INTERNET_ZONE}\r\n`
  if (origin) text += `HostUrl=${origin}\r\n`
  return text
}

/** The name of the alternate data stream on NTFS. */
export function zoneIdentifierPath(filePath: string): string {
  return `${filePath}:Zone.Identifier`
}

/**
 * Arguments for `/usr/bin/xattr` that set `com.apple.quarantine`. The value is
 * `<flags>;<seconds since 1970 in hex>;<agent>;` with flags 0083, the ones a browser download gets
 * (Gatekeeper checks it, the user has not yet opened it).
 */
export function quarantineXattrArgs(filePath: string, nowMs: number): string[] {
  const seconds = Math.floor(nowMs / 1000).toString(16)
  return ['-w', 'com.apple.quarantine', `0083;${seconds};Vicu;`, filePath]
}

export const XATTR_PATH = '/usr/bin/xattr'

export interface MarkDeps {
  platform?: NodeJS.Platform
  now?: () => number
  writeFile?: (path: string, data: string) => Promise<void>
  execFile?: (file: string, args: string[]) => Promise<void>
}

function runExecFile(file: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 10_000 }, (err) => (err ? reject(err) : resolve()))
  })
}

/**
 * Marks `filePath`, already written, as downloaded from `serverUrl`. Never throws.
 */
export async function markFromInternet(filePath: string, serverUrl?: unknown, deps: MarkDeps = {}): Promise<void> {
  const platform = deps.platform ?? process.platform
  try {
    if (platform === 'win32') {
      const write = deps.writeFile ?? ((path: string, data: string) => writeFile(path, data, 'utf8'))
      await write(zoneIdentifierPath(filePath), zoneIdentifierContent(serverUrl))
    } else if (platform === 'darwin') {
      const run = deps.execFile ?? runExecFile
      await run(XATTR_PATH, quarantineXattrArgs(filePath, (deps.now ?? Date.now)()))
    }
  } catch {
    // Best effort: a file system or tool that cannot hold the mark leaves the file unmarked.
  }
}
