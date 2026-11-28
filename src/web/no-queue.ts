import type { WriteQueue } from '../main/handlers/write-queue'

// The web version keeps no changes for later: you are online, or the change fails and the page
// says so. The write gate (src/main/offline/task-writes.ts) still wants a queue to ask "is anything
// waiting for this task"; this one always answers no, and refuses to take a change.

const refuse = (): Promise<never> =>
  Promise.reject(new Error('The web version does not keep changes for later'))

export const noQueue: WriteQueue = {
  counts: () => ({ pending: 0, failed: 0 }),
  hasPendingFor: () => false,
  // A task is only ever named by its server id here: nothing is created offline.
  resolveTaskRef: (ref) => (typeof ref === 'number' && Number.isInteger(ref) ? ref : null),
  resolveCommentRef: () => null,
  commentActionsFor: () => [],
  enqueueUpdate: refuse,
  enqueueDelete: refuse,
  enqueueAddLabel: refuse,
  enqueueRemoveLabel: refuse,
  enqueueAddRelation: refuse,
  enqueueRemoveRelation: refuse,
  enqueueAddAssignee: refuse,
  enqueueRemoveAssignee: refuse,
  enqueueCreateComment: refuse,
  enqueueUpdateComment: refuse,
  enqueueDeleteComment: refuse,
  enqueueUpload: refuse,
}
