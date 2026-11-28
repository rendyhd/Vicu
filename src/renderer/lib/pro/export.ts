import type { Task } from '@/lib/vikunja-types'
import type { PromiseWorld } from '@/hooks/use-promise-world'
import { effectiveDue } from '../../../shared/pro/promises'
import { finalVerdictOf } from '../../../shared/pro/ledger'
import type { ExportPromise } from '../../../shared/pro/import'

/**
 * The open promises a page exports or puts in a Copilot prompt (cross-app semantics 21.12): theirs by
 * the person's name, yours as "me". `keep` narrows them (a person, an initiative).
 */
export function openPromises(world: PromiseWorld, projectTitle: (projectId: number) => string | null, keep: (task: Task, person: number | null) => boolean = () => true): ExportPromise[] {
  const out: ExportPromise[] = []
  for (const task of world.open) {
    const promise = world.promiseFor(task)
    if (!promise || finalVerdictOf(promise) || !keep(task, promise.person)) continue
    const initiative = promise.initiative ? projectTitle(promise.initiative) : null
    out.push({
      taskId: task.id,
      owner: promise.dir === 'mine' ? 'me' : world.nameOf(promise.person),
      what: task.title,
      due: effectiveDue(task, promise),
      initiative,
    })
  }
  return out
}
