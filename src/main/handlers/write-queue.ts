import type {
  OfflineEnqueueResult,
  OfflineImageInput,
  OfflineLabelRef,
  OfflineQueueCounts,
} from '../../shared/offline-queue-types'
import type { CommentAction } from '../offline/types'

/** The title a queued change shows in the sync panel's summary line. */
interface Meta {
  title?: string
}

/**
 * What portable code (the write gate, the collaboration handlers) calls on the offline queue.
 * The desktop's `OfflineQueue` (offline/queue.ts) implements it; the web host brings its own.
 * Declared here so portable code never imports the queue's file, which needs Node.
 */
export interface WriteQueue {
  counts(): OfflineQueueCounts
  hasPendingFor(taskId: number): boolean
  /** A task as a window names it (id, temp id or `pending_x`) to the number the queue uses; null when unknown. */
  resolveTaskRef(ref: number | string): number | null
  /** The real id of a comment created offline, once its create replayed. */
  resolveCommentRef(commentId: number): number | null
  /** The queued comment actions of one task, in queue order. */
  commentActionsFor(taskId: number): CommentAction[]
  enqueueUpdate(
    ref: number | string,
    patch: Record<string, unknown>,
    meta?: Meta & {
      completedDue?: string | null
      baseDescription?: string
    }
  ): Promise<OfflineEnqueueResult>
  enqueueDelete(ref: number | string, meta?: Meta): Promise<OfflineEnqueueResult>
  enqueueAddLabel(ref: number | string, label: OfflineLabelRef, meta?: Meta): Promise<OfflineEnqueueResult>
  enqueueRemoveLabel(ref: number | string, labelId: number, meta?: Meta): Promise<OfflineEnqueueResult>
  enqueueAddRelation(ref: number | string, otherRef: number | string, kind: string, meta?: Meta): Promise<OfflineEnqueueResult>
  enqueueRemoveRelation(ref: number | string, otherRef: number | string, kind: string, meta?: Meta): Promise<OfflineEnqueueResult>
  enqueueAddAssignee(ref: number | string, userId: number, meta?: Meta & { username?: string }): Promise<OfflineEnqueueResult>
  enqueueRemoveAssignee(ref: number | string, userId: number, meta?: Meta & { username?: string }): Promise<OfflineEnqueueResult>
  enqueueCreateComment(ref: number | string, comment: string, meta?: Meta): Promise<OfflineEnqueueResult & { tempCommentId: number }>
  enqueueUpdateComment(ref: number | string, commentId: number, comment: string, meta?: Meta): Promise<OfflineEnqueueResult>
  enqueueDeleteComment(ref: number | string, commentId: number, meta?: Meta): Promise<OfflineEnqueueResult>
  enqueueUpload(
    ref: number | string,
    image: OfflineImageInput,
    options?: { addImageToken?: boolean; title?: string }
  ): Promise<OfflineEnqueueResult>
}
