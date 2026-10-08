import type { ReactNode } from 'react'

/**
 * The list that task rows belong to: a row is a `listitem` and needs a `list` around it. Put it
 * around the rows of one group only (not its header or composer), and not at all when the group
 * has no rows, because an empty list is itself an accessibility error.
 */
export function TaskRowGroup({ children }: { children: ReactNode }) {
  return <div role="list">{children}</div>
}
