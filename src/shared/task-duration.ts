/**
 * Task duration is stored as a hidden HTML comment in the Vikunja description.
 * It is independent of start_date, due_date and end_date.
 *
 * This file must stay free of imports so every tsconfig can include it.
 */

const DURATION_MARKER_RE = /<!--[ \t\r\n]*vicu-duration:v1:([1-9]\d*)[ \t\r\n]*-->/
const ANY_V1_DURATION_MARKER_RE = /<!--[ \t\r\n]*vicu-duration:v1:\d+[ \t\r\n]*-->/g

function isValidMinutes(minutes: number): boolean {
  return Number.isSafeInteger(minutes) && minutes > 0
}

/** Read a valid v1 duration in minutes. Malformed and unsupported markers are ignored. */
export function parseTaskDuration(description: string | null | undefined): number | null {
  const match = description?.match(DURATION_MARKER_RE)
  if (!match) return null
  const minutes = Number(match[1])
  return isValidMinutes(minutes) ? minutes : null
}

/** Remove the v1 duration marker without touching the editable body or other metadata. */
export function stripTaskDuration(description: string | null | undefined): string {
  return (description ?? '').replace(ANY_V1_DURATION_MARKER_RE, '').trimEnd()
}

/** Set or clear the v1 duration marker, appending it after the rest of the description. */
export function withTaskDuration(
  description: string | null | undefined,
  minutes: number | null,
): string {
  const body = stripTaskDuration(description)
  if (minutes === null) return body
  if (!isValidMinutes(minutes)) throw new Error('Duration must be a positive whole number of minutes')
  const marker = `<!-- vicu-duration:v1:${minutes} -->`
  return body ? `${body}\n${marker}` : marker
}

/** The compact duration label used by parser chips, the property button and Planner rows. */
export function formatTaskDuration(minutes: number): string {
  return `${minutes}m`
}
