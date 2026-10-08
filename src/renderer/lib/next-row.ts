/**
 * Where keyboard focus goes when a row is completed from the keyboard: the checkbox of the next open
 * row, else the previous open one, else nowhere. Rows that are done (held) are skipped, and so is
 * the row just completed (its done flag may not have reached the screen yet).
 */
export function pickNextRow(rows: ReadonlyArray<{ id: number; done: boolean }>, currentId: number): number | null {
  const index = rows.findIndex((row) => row.id === currentId)
  const open = (row: { id: number; done: boolean }) => !row.done && row.id !== currentId
  if (index === -1) return rows.find(open)?.id ?? null
  const after = rows.slice(index + 1).find(open)
  if (after) return after.id
  for (let i = index - 1; i >= 0; i--) if (open(rows[i])) return rows[i].id
  return null
}

/** The rows on screen, in order, as the DOM shows them. */
function visibleRows(): Array<{ id: number; done: boolean; checkbox: HTMLElement }> {
  const out: Array<{ id: number; done: boolean; checkbox: HTMLElement }> = []
  for (const row of document.querySelectorAll<HTMLElement>('[data-task-id]')) {
    const checkbox = row.querySelector<HTMLElement>('button[role="checkbox"]')
    const id = Number(row.dataset.taskId)
    if (!checkbox || !Number.isFinite(id)) continue
    out.push({ id, done: checkbox.getAttribute('aria-checked') === 'true', checkbox })
  }
  return out
}

/** Focus the checkbox of the row that follows `currentId`; returns its task id (null when there is none). */
export function focusNextCheckbox(currentId: number): number | null {
  const rows = visibleRows()
  const nextId = pickNextRow(rows, currentId)
  if (nextId === null) return null
  rows.find((row) => row.id === nextId)?.checkbox.focus()
  return nextId
}

/** Focus the checkbox of a row once it is on screen (a restored row appears a moment after Undo). */
export function focusCheckboxWhenShown(taskId: number, frames = 45): void {
  const attempt = (left: number) => {
    const checkbox = document.querySelector<HTMLElement>(`[data-task-id="${taskId}"] button[role="checkbox"]`)
    if (checkbox) checkbox.focus()
    else if (left > 0) requestAnimationFrame(() => attempt(left - 1))
  }
  attempt(frames)
}
