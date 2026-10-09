// The numbers behind the sidebar progress rings: how many tasks of a project are done out of all
// its tasks. The done count comes from the main process (one cheap request per project, carriers
// excluded); the open count is read off the open tasks the sidebar already holds.

export interface ProjectProgress {
  done: number
  total: number
  /** 0 to 1; the share of the project's tasks that are done. */
  fraction: number
}

/** Open (not done) tasks per project id. Tasks that are done are ignored. */
export function openCountsByProject(tasks: ReadonlyArray<{ project_id: number; done: boolean }>): Map<number, number> {
  const counts = new Map<number, number>()
  for (const task of tasks) {
    if (task.done) continue
    counts.set(task.project_id, (counts.get(task.project_id) ?? 0) + 1)
  }
  return counts
}

/** Null when the project has no tasks (a ring would say nothing) or a count is not known yet. */
export function projectProgress(done: number | undefined, open: number | undefined): ProjectProgress | null {
  if (done === undefined || open === undefined) return null
  if (!Number.isFinite(done) || !Number.isFinite(open) || done < 0 || open < 0) return null
  const total = done + open
  if (total === 0) return null
  return { done, total, fraction: done / total }
}

/** What assistive technology reads for a ring: "3 of 8 done". */
export function progressLabel(progress: ProjectProgress): string {
  return `${progress.done} of ${progress.total} done`
}
