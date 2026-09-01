const METADATA_MARKER_RE = /<!--\s*vicu-(?:routine|custom-lists):[\s\S]*?-->/

/** True for implementation-detail tasks that must never render as user tasks. */
export function hasVicuMetadataMarker(description?: string | null): boolean {
  return !!description && METADATA_MARKER_RE.test(description)
}
