import { base64ToBytes, bytesToBase64Url, bytesToUtf8, utf8Bytes } from '../shared/bytes'
import { HIDDEN_TASK_READ_MAX_BYTES, HIDDEN_TASK_WRITE_MAX_BYTES, kindMarkerPattern } from '../shared/hidden-tasks'
import { SYNCED_PREFS_VERSION, validateSyncedPrefs, type SyncedPrefsDocument } from '../shared/synced-prefs'

/**
 * The preferences carrier's envelope (docs/cross-app-semantics-v1.md section 11.1): a hidden done
 * task titled `Vicu preferences (sync metadata — do not delete)` whose description is
 * `<!-- vicu-prefs:v1:<base64url JSON> -->`. The document rules are in `shared/synced-prefs.ts`.
 */

export const PREFS_CARRIER_TITLE = 'Vicu preferences (sync metadata — do not delete)'
/** Search text that finds the carrier server side (the marker name inside the HTML comment). */
export const PREFS_CARRIER_SEARCH = 'vicu-prefs'

const MARKER_START_RE = kindMarkerPattern('prefs')
const MARKER_RE = /<!--[ \t\r\n]*vicu-prefs:v(\d+):([A-Za-z0-9_-]+={0,2})[ \t\r\n]*-->/

export interface ParsedPrefsEnvelope {
  isCarrier: boolean
  document?: SyncedPrefsDocument
  /** Set when a newer version wrote it (marker or payload): the preferences are read only then. */
  futureVersion?: number
  error?: string
}

/** True when the description holds the preferences marker, readable or not. */
export function hasPrefsMarker(description?: string | null): boolean {
  return !!description && MARKER_START_RE.test(description)
}

export function parsePrefsEnvelope(description?: string | null): ParsedPrefsEnvelope {
  if (!hasPrefsMarker(description)) return { isCarrier: false }
  const marker = description!.match(MARKER_RE)
  if (!marker) return { isCarrier: true, error: 'Malformed preferences metadata' }
  const version = Number(marker[1])
  if (version > SYNCED_PREFS_VERSION) {
    return { isCarrier: true, futureVersion: version, error: `Preferences metadata version ${version} is not supported` }
  }
  if (version !== SYNCED_PREFS_VERSION) return { isCarrier: true, error: `Preferences metadata version ${version} is not supported` }
  try {
    const bytes = base64ToBytes(marker[2])
    if (bytes.byteLength > HIDDEN_TASK_READ_MAX_BYTES) throw new Error('Preferences metadata is too large')
    const document = JSON.parse(bytesToUtf8(bytes)) as unknown
    const payloadVersion = (document as { version?: unknown } | null)?.version
    if (typeof payloadVersion === 'number' && payloadVersion > SYNCED_PREFS_VERSION) {
      return { isCarrier: true, futureVersion: payloadVersion, error: `Preferences metadata version ${payloadVersion} is not supported` }
    }
    validateSyncedPrefs(document)
    return { isCarrier: true, document }
  } catch (error) {
    return { isCarrier: true, error: error instanceof Error ? error.message : 'Cannot decode preferences metadata' }
  }
}

/** The carrier's description: only the marker. */
export function encodePrefsEnvelope(document: SyncedPrefsDocument): string {
  validateSyncedPrefs(document)
  const bytes = utf8Bytes(JSON.stringify(document))
  if (bytes.byteLength > HIDDEN_TASK_WRITE_MAX_BYTES) throw new Error('Preferences metadata is too large')
  return `<!-- vicu-prefs:v${SYNCED_PREFS_VERSION}:${bytesToBase64Url(bytes)} -->`
}
