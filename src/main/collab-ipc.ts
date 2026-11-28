import {
  addTaskAssignee,
  createTaskRelation,
  deleteTaskRelation,
  createTaskComment,
  deleteTaskComment,
  fetchAvatar,
  fetchProjectTeamShares,
  fetchProjectUserShares,
  fetchTaskComments,
  markTaskRead,
  removeProjectUserShare,
  removeTaskAssignee,
  searchProjectUsers,
  searchUsers,
  shareProjectWithUser,
  subscribeToTask,
  unsubscribeFromTask,
  updateProjectUserShare,
  updateTaskComment,
} from './api-client'
import type { ApiError, ApiResult } from './api-result'
import { loadConfig } from './config'
import { overlayComments } from './offline/comment-overlay'
import { parseTaskWriteOptions, taskWriteReply, taskWrites, writeTask, type TaskWriteDeps, type TaskWriteOutcome } from './offline/task-writes'
import { normalizeServerUrl } from './offline/owner'
import type { Handle } from './handlers/types'
import type { WriteQueue } from './handlers/write-queue'
import type { QueuedCommentReply, QueuedWriteReply } from '../shared/offline-queue-types'

// Assignees, comments, project sharing, subscriptions and avatars (docs/cross-app-semantics-v1.md
// section 9). Changes to a task's assignees and comments go through the same write gate as every
// other task change (offline/task-writes.ts), so they queue behind waiting changes and replay in
// order; sharing and subscriptions need the server's answer and are never queued.

const invalid = (what: string): ApiError => ({ success: false, error: `Invalid ${what}` })
const isId = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v !== 0
const isPositiveId = (v: unknown): v is number => isId(v) && v > 0
const isPermission = (v: unknown): v is 0 | 1 | 2 => v === 0 || v === 1 || v === 2
const isUsername = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= 250
const isHtml = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= 100_000

/** A temp id whose create has replayed since the window last looked becomes the real id. */
function taskIdFor(queue: WriteQueue, taskId: number): number {
  return queue.resolveTaskRef(taskId) ?? taskId
}

// At most a few member lookups at once: the sidebar asks for every project when the app starts.
const MEMBER_LOOKUP_CONCURRENCY = 4
let lookupsRunning = 0
const lookupWaiting: Array<() => void> = []

async function limited<T>(run: () => Promise<T>): Promise<T> {
  if (lookupsRunning >= MEMBER_LOOKUP_CONCURRENCY) await new Promise<void>((resolve) => lookupWaiting.push(resolve))
  lookupsRunning++
  try {
    return await run()
  } finally {
    lookupsRunning--
    lookupWaiting.shift()?.()
  }
}

// Avatars are kept for the session, per server, user and size; overlapping requests share one.
const AVATAR_CACHE_LIMIT = 200
const avatars = new Map<string, Promise<ApiResult<string>>>()

function avatarFor(username: string, size: number): Promise<ApiResult<string>> {
  const config = loadConfig()
  const key = `${config?.vikunja_url ? normalizeServerUrl(config.vikunja_url) : ''}|${username}|${size}`
  const cached = avatars.get(key)
  if (cached) return cached
  const request = fetchAvatar(username, size).then((result) => {
    // A failure is not remembered: the next row that needs the avatar asks again.
    if (!result.success) avatars.delete(key)
    return result
  })
  avatars.set(key, request)
  if (avatars.size > AVATAR_CACHE_LIMIT) avatars.delete(avatars.keys().next().value as string)
  return request
}

/** What a queue-aware comment create answers: the stored comment, or the temp id of the queued one. */
function commentCreateReply(outcome: TaskWriteOutcome): ApiResult<unknown> | QueuedCommentReply {
  if (outcome.kind === 'queued') {
    const tempCommentId = (outcome.enqueued as { tempCommentId?: unknown } | undefined)?.tempCommentId
    if (typeof tempCommentId === 'number') return { success: true, queued: true, data: { tempCommentId } }
    return { success: false, error: 'The comment could not be saved offline' }
  }
  return taskWriteReply(outcome) as ApiResult<unknown>
}

export interface CollabDeps {
  /** The write gate's queue and how to ask for a replay (offline/task-writes.ts). */
  taskWriteDeps(): TaskWriteDeps
  /** The signed-in user's id when it is known (the desktop reads it for the configured server). */
  currentUserId(): number | undefined
}

export function registerCollaborationIpc(handle: Handle, deps: CollabDeps): void {
  const writeDeps = (): TaskWriteDeps => deps.taskWriteDeps()
  const { currentUserId } = deps

  // --- People and sharing ---

  handle('search-project-users', (_event, projectId: unknown) => {
    if (!isPositiveId(projectId)) return invalid('project')
    return limited(() => searchProjectUsers(projectId))
  })

  /** The direct user shares and the team shares of one project, for permissions and the Share dialog. */
  handle('fetch-project-shares', async (_event, projectId: unknown) => {
    if (!isPositiveId(projectId)) return invalid('project')
    const [users, teams] = await Promise.all([fetchProjectUserShares(projectId), fetchProjectTeamShares(projectId)])
    if (!users.success) return users
    if (!teams.success) return teams
    return { success: true, data: { users: users.data, teams: teams.data } }
  })

  handle('search-users', (_event, query: unknown) => {
    if (!isUsername(query)) return invalid('search')
    return searchUsers(query.trim())
  })

  handle('share-project', (_event, projectId: unknown, username: unknown, permission: unknown) => {
    if (!isPositiveId(projectId) || !isUsername(username) || !isPermission(permission)) return invalid('share')
    return shareProjectWithUser(projectId, username.trim(), permission)
  })

  handle('update-project-share', (_event, projectId: unknown, username: unknown, permission: unknown) => {
    if (!isPositiveId(projectId) || !isUsername(username) || !isPermission(permission)) return invalid('share')
    return updateProjectUserShare(projectId, username, permission)
  })

  handle('remove-project-share', (_event, projectId: unknown, username: unknown) => {
    if (!isPositiveId(projectId) || !isUsername(username)) return invalid('share')
    return removeProjectUserShare(projectId, username)
  })

  handle('fetch-avatar', (_event, username: unknown, size: unknown) => {
    if (!isUsername(username) || typeof size !== 'number' || !Number.isFinite(size) || size < 1 || size > 512) return invalid('avatar')
    return avatarFor(username, Math.round(size))
  })

  // --- Assignees (never a field of a task patch) ---

  handle('add-task-assignee', async (_event, taskId: unknown, userId: unknown, options?: unknown) => {
    if (!isId(taskId) || !isPositiveId(userId)) return invalid('assignee')
    const { queue, title, username } = parseTaskWriteOptions(options)
    const deps = writeDeps()
    const spec = taskWrites.addAssignee(deps.queue, { addTaskAssignee }, taskIdFor(deps.queue, taskId), { id: userId, username }, title)
    return taskWriteReply(await writeTask(deps, spec, { queue })) as ApiResult<unknown> | QueuedWriteReply
  })

  handle('remove-task-assignee', async (_event, taskId: unknown, userId: unknown, options?: unknown) => {
    if (!isId(taskId) || !isPositiveId(userId)) return invalid('assignee')
    const { queue, title, username } = parseTaskWriteOptions(options)
    const deps = writeDeps()
    const spec = taskWrites.removeAssignee(deps.queue, { removeTaskAssignee }, taskIdFor(deps.queue, taskId), { id: userId, username }, title)
    return taskWriteReply(await writeTask(deps, spec, { queue })) as ApiResult<unknown> | QueuedWriteReply
  })

  // --- Relations through the write gate, queued offline: Pro's "after" (cross-app semantics 21.2,
  // decision 24) is a `blocked` relation, a subtask attached or removed (section 24) a `subtask`
  // relation on the parent. A new subtask's own relation still goes through `create-task-relation`.

  const changeRelation = async (add: boolean, kind: 'blocked' | 'subtask', taskId: unknown, otherTaskId: unknown, options?: unknown) => {
    if (!isId(taskId) || !isId(otherTaskId) || taskId === otherTaskId) return invalid('relation')
    const { queue, title } = parseTaskWriteOptions(options)
    const deps = writeDeps()
    const self = taskIdFor(deps.queue, taskId)
    const other = taskIdFor(deps.queue, otherTaskId)
    const spec = add
      ? taskWrites.addRelation(deps.queue, { createTaskRelation }, self, other, kind, title)
      : taskWrites.removeRelation(deps.queue, { deleteTaskRelation }, self, other, kind, title)
    // A task that exists only offline cannot be related on the server yet: straight to the queue.
    if (self < 0 || other < 0) {
      await spec.enqueue()
      return { success: true as const, data: null, queued: true }
    }
    return taskWriteReply(await writeTask(deps, spec, { queue })) as ApiResult<unknown> | QueuedWriteReply
  }

  handle('pro:add-after', (_event, taskId: unknown, otherTaskId: unknown, options?: unknown) =>
    changeRelation(true, 'blocked', taskId, otherTaskId, options))
  handle('pro:remove-after', (_event, taskId: unknown, otherTaskId: unknown, options?: unknown) =>
    changeRelation(false, 'blocked', taskId, otherTaskId, options))
  // The parent first, then the task that is (or stops being) its subtask.
  handle('attach-subtask', (_event, parentId: unknown, taskId: unknown, options?: unknown) =>
    changeRelation(true, 'subtask', parentId, taskId, options))
  handle('detach-subtask', (_event, parentId: unknown, taskId: unknown, options?: unknown) =>
    changeRelation(false, 'subtask', parentId, taskId, options))

  // --- Comments ---

  /**
   * One page of a task's thread, newest first, with the queued comment changes laid over it. A task
   * that only exists offline has no thread on the server yet: just the queued comments.
   */
  handle('fetch-task-comments', async (_event, taskId: unknown, page: unknown) => {
    if (!isId(taskId) || !isPositiveId(page)) return invalid('comments request')
    const queue = writeDeps().queue
    const realId = queue.resolveTaskRef(taskId)
    const me = currentUserId()
    if (realId === null || realId < 0) {
      const id = realId ?? taskId
      return { success: true, data: { items: overlayComments([], queue.commentActionsFor(id), page, me), page, totalPages: 1 } }
    }
    const result = await fetchTaskComments(realId, page)
    if (!result.success) return result
    const items = overlayComments(result.data.items, queue.commentActionsFor(realId), page, me)
    return { success: true, data: { ...result.data, items } }
  })

  handle('create-task-comment', async (_event, taskId: unknown, html: unknown, options?: unknown) => {
    if (!isId(taskId) || !isHtml(html)) return invalid('comment')
    const { queue, title } = parseTaskWriteOptions(options)
    const deps = writeDeps()
    const spec = taskWrites.createComment(deps.queue, { createTaskComment }, taskIdFor(deps.queue, taskId), html, title)
    return commentCreateReply(await writeTask(deps, spec, { queue }))
  })

  handle('update-task-comment', async (_event, taskId: unknown, commentId: unknown, html: unknown, options?: unknown) => {
    if (!isId(taskId) || !isId(commentId) || !isHtml(html)) return invalid('comment')
    const { queue, title } = parseTaskWriteOptions(options)
    const deps = writeDeps()
    // A comment that was written offline and has been sent since is edited under its real id.
    const resolved = deps.queue.resolveCommentRef(commentId) ?? commentId
    const spec = taskWrites.updateComment(deps.queue, { updateTaskComment }, taskIdFor(deps.queue, taskId), resolved, html, title)
    // An edit of a comment still waiting to be created can only go into the queue.
    if (resolved < 0) return taskWriteReply(await writeTask(deps, { ...spec, send: async () => notCreatedYet() }, { queue }))
    return taskWriteReply(await writeTask(deps, spec, { queue }))
  })

  handle('delete-task-comment', async (_event, taskId: unknown, commentId: unknown, options?: unknown) => {
    if (!isId(taskId) || !isId(commentId)) return invalid('comment')
    const { queue, title } = parseTaskWriteOptions(options)
    const deps = writeDeps()
    const resolved = deps.queue.resolveCommentRef(commentId) ?? commentId
    const spec = taskWrites.deleteComment(deps.queue, { deleteTaskComment }, taskIdFor(deps.queue, taskId), resolved, title)
    if (resolved < 0) return taskWriteReply(await writeTask(deps, { ...spec, send: async () => notCreatedYet() }, { queue }))
    return taskWriteReply(await writeTask(deps, spec, { queue }))
  })

  // --- Read and subscriptions (online only, cross-app semantics 9.6) ---

  handle('mark-task-read', (_event, taskId: unknown) => {
    if (!isPositiveId(taskId)) return invalid('task')
    return markTaskRead(taskId)
  })

  handle('set-task-subscription', (_event, taskId: unknown, subscribed: unknown) => {
    if (!isPositiveId(taskId) || typeof subscribed !== 'boolean') return invalid('subscription')
    return subscribed ? subscribeToTask(taskId) : unsubscribeFromTask(taskId)
  })
}

/**
 * A comment with a negative id exists only in the queue; this never happens in practice because the
 * queue holds its create (so the gate queues the change), but a send must never reach the server.
 */
function notCreatedYet(): ApiError {
  return { success: false, error: 'Network error: the comment is still waiting to be sent (ENETUNREACH)' }
}
