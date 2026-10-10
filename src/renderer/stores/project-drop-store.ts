import { create } from 'zustand'
import type { DropZone } from '@/lib/project-moves'

/**
 * Where a dragged project would land right now, set while it moves (AppShell) and read by the
 * rows that draw the drop line or the "into" highlight. `dndId` is the row's draggable id, so the
 * sidebar and the Settings list each mark only their own row.
 */
export type ProjectDropTarget =
  | { kind: 'row'; dndId: string; projectId: number; zone: DropZone }
  | { kind: 'root'; dndId: string }

interface ProjectDropState {
  target: ProjectDropTarget | null
}

export const useProjectDropStore = create<ProjectDropState>(() => ({ target: null }))

export function setProjectDropTarget(target: ProjectDropTarget | null): void {
  const current = useProjectDropStore.getState().target
  const same =
    current === target ||
    (current !== null &&
      target !== null &&
      current.dndId === target.dndId &&
      current.kind === target.kind &&
      (current.kind === 'root' || (target.kind === 'row' && current.zone === target.zone)))
  if (!same) useProjectDropStore.setState({ target })
}

/** The zone shown on this row, or null when the drag is not over it. */
export function useRowDropZone(dndId: string): DropZone | null {
  return useProjectDropStore((s) => (s.target?.kind === 'row' && s.target.dndId === dndId ? s.target.zone : null))
}

export function useRootDropActive(dndId: string): boolean {
  return useProjectDropStore((s) => s.target?.kind === 'root' && s.target.dndId === dndId)
}
