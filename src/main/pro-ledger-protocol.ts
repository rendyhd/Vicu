import { HIDDEN_TASK_READ_MAX_BYTES, HIDDEN_TASK_WRITE_MAX_BYTES, kindMarkerPattern } from '../shared/hidden-tasks'
import { PRO_LEDGER_VERSION, normalizeLedger, type ProArchivePart, type ProLedger } from '../shared/pro/ledger'

/**
 * The Pro ledger's envelope (docs/cross-app-semantics-v1.md section 21.7): a hidden done task titled
 * `Vicu Pro ledger (sync metadata — do not delete)` whose description is
 * `<!-- vicu-pro:v1:<base64url JSON> -->`, and its archive parts `vicu-pro-archive:v1`. The document
 * rules are in `shared/pro/ledger.ts`.
 */

export const PRO_LEDGER_TITLE = 'Vicu Pro ledger (sync metadata — do not delete)'
/** Search text that finds the ledger (and not its archive parts: `vicu-pro:` is not in `vicu-pro-archive:`). */
export const PRO_LEDGER_SEARCH = 'vicu-pro:v'
export const PRO_ARCHIVE_SEARCH = 'vicu-pro-archive'

export const proArchiveTitle = (quarter: string): string => `Vicu Pro archive ${quarter} (sync metadata — do not delete)`

const LEDGER_START_RE = kindMarkerPattern('pro')
const ARCHIVE_START_RE = kindMarkerPattern('pro-archive')
const LEDGER_RE = /<!--[ \t\r\n]*vicu-pro:v(\d+):([A-Za-z0-9_-]+={0,2})[ \t\r\n]*-->/
const ARCHIVE_RE = /<!--[ \t\r\n]*vicu-pro-archive:v(\d+):([A-Za-z0-9_-]+={0,2})[ \t\r\n]*-->/

export interface ParsedEnvelope<T> {
  isCarrier: boolean
  document?: T
  futureVersion?: number
  error?: string
}

export function hasProLedgerMarker(description?: string | null): boolean {
  return !!description && LEDGER_START_RE.test(description)
}

export function hasProArchiveMarker(description?: string | null): boolean {
  return !!description && ARCHIVE_START_RE.test(description)
}

function decode(marker: RegExpMatchArray, what: string): { version: number; json?: unknown; error?: string } {
  const version = Number(marker[1])
  try {
    const bytes = Buffer.from(marker[2].replace(/-/g, '+').replace(/_/g, '/'), 'base64')
    if (bytes.byteLength > HIDDEN_TASK_READ_MAX_BYTES) return { version, error: `${what} is too large` }
    return { version, json: JSON.parse(bytes.toString('utf8')) }
  } catch {
    return { version, error: `Cannot decode ${what}` }
  }
}

export function parseProLedgerEnvelope(description?: string | null): ParsedEnvelope<ProLedger> {
  if (!hasProLedgerMarker(description)) return { isCarrier: false }
  const marker = description!.match(LEDGER_RE)
  if (!marker) return { isCarrier: true, error: 'Malformed Pro ledger' }
  const { version, json, error } = decode(marker, 'the Pro ledger')
  if (version > PRO_LEDGER_VERSION) return { isCarrier: true, futureVersion: version, error: `Pro ledger version ${version} is not supported` }
  if (error) return { isCarrier: true, error }
  const payloadVersion = (json as { version?: unknown } | null)?.version
  if (typeof payloadVersion === 'number' && payloadVersion > PRO_LEDGER_VERSION) {
    return { isCarrier: true, futureVersion: payloadVersion, error: `Pro ledger version ${payloadVersion} is not supported` }
  }
  try {
    return { isCarrier: true, document: normalizeLedger(json) }
  } catch (problem) {
    return { isCarrier: true, error: problem instanceof Error ? problem.message : 'Malformed Pro ledger' }
  }
}

function encode(kind: 'pro' | 'pro-archive', document: unknown, what: string): string {
  const bytes = Buffer.from(JSON.stringify(document), 'utf8')
  if (bytes.byteLength > HIDDEN_TASK_WRITE_MAX_BYTES) throw new Error(`${what} is too large`)
  return `<!-- vicu-${kind}:v${PRO_LEDGER_VERSION}:${bytes.toString('base64url')} -->`
}

export function encodeProLedgerEnvelope(document: ProLedger): string {
  normalizeLedger(document)
  return encode('pro', document, 'The Pro ledger')
}

export function parseProArchiveEnvelope(description?: string | null): ParsedEnvelope<ProArchivePart> {
  if (!hasProArchiveMarker(description)) return { isCarrier: false }
  const marker = description!.match(ARCHIVE_RE)
  if (!marker) return { isCarrier: true, error: 'Malformed Pro archive part' }
  const { version, json, error } = decode(marker, 'a Pro archive part')
  if (version > PRO_LEDGER_VERSION) return { isCarrier: true, futureVersion: version }
  if (error) return { isCarrier: true, error }
  const part = json as Partial<ProArchivePart> | null
  if (!part || typeof part !== 'object' || typeof part.quarter !== 'string') return { isCarrier: true, error: 'Malformed Pro archive part' }
  if (typeof part.version === 'number' && part.version > PRO_LEDGER_VERSION) return { isCarrier: true, futureVersion: part.version }
  return { isCarrier: true, document: part as ProArchivePart }
}

export function encodeProArchiveEnvelope(part: ProArchivePart): string {
  return encode('pro-archive', part, 'A Pro archive part')
}
