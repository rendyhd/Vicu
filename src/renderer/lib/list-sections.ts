// Small rules of the grouped lists (Today, Upcoming, Anytime, Tag): what a section header counts and
// when a group is too small to deserve a header (docs/design-system-v1.md, section headers).

/** The tasks of a group that are still open: the number a header shows, so it drops when one completes. */
export function openCount(tasks: ReadonlyArray<{ done?: boolean }>): number {
  let open = 0
  for (const task of tasks) if (!task.done) open += 1
  return open
}

/**
 * A group of one task gets no header; its project goes on the row's meta line instead. The size is
 * the number of tasks in the group, finished ones included, so completing a task never makes the
 * header of its neighbours appear or vanish under the pointer.
 */
export function showsGroupHeader(tasks: ReadonlyArray<unknown>): boolean {
  return tasks.length > 1
}
