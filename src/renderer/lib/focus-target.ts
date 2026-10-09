const FOCUSABLE = 'button:not([tabindex="-1"]), [role="button"]:not([tabindex="-1"]), a[href], [tabindex]:not([tabindex="-1"])'

/**
 * The control a sidebar row's context menu should give focus back to: the row itself when it is
 * focusable (a tag button), else its first focusable control (a project row is a box around the
 * chevron and the project button). Null when there is none.
 */
export function focusTargetOf(row: Element | null): HTMLElement | null {
  if (!(row instanceof HTMLElement)) return null
  if (row.matches(FOCUSABLE)) return row
  return row.querySelector<HTMLElement>(FOCUSABLE)
}
