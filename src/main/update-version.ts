// Version comparison for the update checker (D-UPD-1). Pure and import-free so it can be tested
// directly. Follows semver 2.0.0 precedence: the numeric core decides first (numbers compare as
// numbers, so 1.10.0 is ahead of 1.9.0); a prerelease is behind the release it precedes
// (1.9.0-beta.1 < 1.9.0); prerelease identifiers compare one by one, numeric ones as numbers and
// below alphanumeric ones; build metadata (+...) is ignored. Anything unreadable counts as 0, so
// the result is never NaN.

export interface UpdateStatus {
  available: boolean
  currentVersion: string
  latestVersion: string
  releaseUrl: string
  releaseNotes: string
}

interface ParsedVersion {
  core: string[]
  prerelease: string[]
}

const DIGITS = /^\d+$/

function parseVersion(raw: unknown): ParsedVersion {
  let text = typeof raw === 'string' ? raw.trim().replace(/^v/i, '') : ''
  const build = text.indexOf('+')
  if (build >= 0) text = text.slice(0, build)
  const dash = text.indexOf('-')
  const corePart = dash >= 0 ? text.slice(0, dash) : text
  const prereleasePart = dash >= 0 ? text.slice(dash + 1) : ''
  return {
    core: corePart.split('.').map((part) => (DIGITS.test(part) ? part : '0')),
    prerelease: prereleasePart === '' ? [] : prereleasePart.split('.'),
  }
}

/** Digit strings of any length, compared without converting to a (lossy) number. */
function compareDigits(a: string, b: string): number {
  const left = a.replace(/^0+(?=\d)/, '')
  const right = b.replace(/^0+(?=\d)/, '')
  if (left.length !== right.length) return left.length < right.length ? -1 : 1
  return left < right ? -1 : left > right ? 1 : 0
}

function compareIdentifier(a: string, b: string): number {
  const aNumeric = DIGITS.test(a)
  const bNumeric = DIGITS.test(b)
  if (aNumeric && bNumeric) return compareDigits(a, b)
  if (aNumeric) return -1
  if (bNumeric) return 1
  return a < b ? -1 : a > b ? 1 : 0
}

/** Negative when `a` is behind `b`, zero when they are the same version, positive when ahead. */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a)
  const right = parseVersion(b)

  for (let i = 0; i < Math.max(left.core.length, right.core.length); i++) {
    const diff = compareDigits(left.core[i] ?? '0', right.core[i] ?? '0')
    if (diff !== 0) return diff
  }

  // A release is ahead of its own prereleases.
  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0
  if (left.prerelease.length === 0) return 1
  if (right.prerelease.length === 0) return -1

  for (let i = 0; i < Math.max(left.prerelease.length, right.prerelease.length); i++) {
    const x = left.prerelease[i]
    const y = right.prerelease[i]
    // With every shared identifier equal, the shorter list is the lower precedence.
    if (x === undefined) return -1
    if (y === undefined) return 1
    const diff = compareIdentifier(x, y)
    if (diff !== 0) return diff
  }
  return 0
}

/** True when `latest` is a newer version than `current`. */
export function isNewerVersion(current: string, latest: string): boolean {
  return compareVersions(latest, current) > 0
}
