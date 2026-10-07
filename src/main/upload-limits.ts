/**
 * Upload size limits, from the server's /info `max_file_size` string. Pure, so it can be tested.
 */

/** Vikunja's default `files.maxsize` (20MB, parsed as 20,000,000 bytes), used when /info has none. */
export const DEFAULT_MAX_UPLOAD_BYTES = 20 * 1000 * 1000

const UNITS: Record<string, number> = {
  '': 1,
  b: 1,
  k: 1e3,
  kb: 1e3,
  m: 1e6,
  mb: 1e6,
  g: 1e9,
  gb: 1e9,
  t: 1e12,
  tb: 1e12,
  kib: 1024,
  mib: 1024 ** 2,
  gib: 1024 ** 3,
  tib: 1024 ** 4,
}

/**
 * Parse a human-readable size such as "20MB". Decimal units are powers of 1000 and `iB` units
 * powers of 1024, the way the server reads its setting. Returns null when it cannot be read.
 */
export function parseMaxFileSize(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? Math.floor(value) : null
  if (typeof value !== 'string') return null
  const match = /^\s*(\d+(?:\.\d+)?)\s*([a-z]*)\s*$/i.exec(value)
  if (!match) return null
  const unit = UNITS[match[2].toLowerCase()]
  if (unit === undefined) return null
  const bytes = Math.floor(Number(match[1]) * unit)
  return Number.isFinite(bytes) && bytes > 0 ? bytes : null
}

function trimmed(value: number): string {
  return String(Math.round(value * 10) / 10)
}

export function describeSize(bytes: number): string {
  if (bytes >= 1e6) return `${trimmed(bytes / 1e6)} MB`
  if (bytes >= 1e3) return `${trimmed(bytes / 1e3)} KB`
  return `${bytes} bytes`
}

/** The message for a file over the limit, or null when it fits. */
export function uploadSizeError(size: number, maxBytes: number): string | null {
  if (size <= maxBytes) return null
  return `File is too large to upload (${describeSize(size)}; this server accepts up to ${describeSize(maxBytes)})`
}

const MIN_UPLOAD_TIMEOUT_MS = 60_000
const MAX_UPLOAD_TIMEOUT_MS = 30 * 60_000
const ASSUMED_SLOWEST_BYTES_PER_SECOND = 64 * 1024

/**
 * How long to let an upload run. A minute covers a small file; larger ones get a second per 64 KB
 * on top, so a file the server allows is not cut off on a slow link. Capped at 30 minutes.
 */
export function uploadTimeoutMs(bytes: number): number {
  const extra = Math.ceil(Math.max(0, bytes) / ASSUMED_SLOWEST_BYTES_PER_SECOND) * 1000
  return Math.min(MAX_UPLOAD_TIMEOUT_MS, MIN_UPLOAD_TIMEOUT_MS + extra)
}
