import { isQueueableFailure } from './error-classify'
import { imageToken } from './image-tokens'

// What Quick Entry does after its create succeeded: attach labels and upload pasted images. Each of
// those is its own request, so the network can drop between them. A step that fails because the
// server could not be reached (or is overloaded) is handed to the offline queue; one the server
// rejected is dropped, because replaying it would be rejected again.

interface ApiLike {
  success: boolean
  error?: string
  statusCode?: number
}

export interface FollowUpLabel {
  id?: number
  title?: string
}

export interface FollowUpImage {
  name: string
  mime: string
  bytes: Uint8Array
}

export interface FollowUpApi {
  addLabelToTask(taskId: number, labelId: number): Promise<ApiLike>
  createLabel(label: { title: string }): Promise<ApiLike & { data?: { id: number } }>
  uploadAttachment(taskId: number, bytes: Uint8Array, name: string, mime: string): Promise<ApiLike>
  fetchTaskAttachments(taskId: number): Promise<ApiLike & { data?: Array<{ id: number }> }>
  updateTask(taskId: number, patch: Record<string, unknown>): Promise<ApiLike>
  queueFollowUps(
    taskId: number,
    extras: { labels: FollowUpLabel[]; images: FollowUpImage[] },
    title?: string
  ): Promise<{ success: boolean; error?: string }>
}

export interface FollowUpInput {
  taskId: number
  /** Names the task in the pending list. */
  title: string
  description: string
  labels: FollowUpLabel[]
  images: FollowUpImage[]
}

export interface FollowUpOutcome {
  queuedLabels: number
  queuedImages: number
  /** Steps the server rejected: neither applied nor queued. */
  dropped: number
  /** Set when the queue could not take what was handed to it. */
  queueError?: string
}

type Failed = { success: false; error: string; statusCode?: number }

/** A call that throws (the IPC itself failed) counts as a failed call, so one bad step never stops the rest. */
async function attempt<T extends ApiLike>(call: () => Promise<T>): Promise<T | Failed> {
  try {
    return await call()
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

const queueable = (result: ApiLike): boolean =>
  isQueueableFailure({ error: result.error ?? '', statusCode: result.statusCode }, 'change')

export async function applyQuickEntryFollowUps(api: FollowUpApi, input: FollowUpInput): Promise<FollowUpOutcome> {
  const queuedLabels: FollowUpLabel[] = []
  const queuedImages: FollowUpImage[] = []
  let dropped = 0

  for (const original of input.labels) {
    let label = original
    if (label.id === undefined) {
      const title = label.title
      if (!title) continue
      const created = await attempt(() => api.createLabel({ title }))
      if (!created.success) {
        if (queueable(created)) queuedLabels.push({ title })
        else dropped++
        continue
      }
      const newId = (created as { data?: { id: number } }).data?.id
      if (newId === undefined) continue
      label = { id: newId, title }
    }
    const labelId = label.id as number
    const added = await attempt(() => api.addLabelToTask(input.taskId, labelId))
    if (added.success) continue
    if (queueable(added)) queuedLabels.push(label)
    else dropped++
  }

  let uploaded = 0
  for (const image of input.images) {
    const result = await attempt(() => api.uploadAttachment(input.taskId, image.bytes, image.name, image.mime))
    if (result.success) uploaded++
    else if (queueable(result)) queuedImages.push(image)
    else dropped++
  }

  // The upload endpoint does not reliably return the attachment id, so ask for the list. The task is
  // new, so every attachment on it is one just added; ascending id is upload order. Best effort: the
  // files are attached either way.
  if (uploaded > 0) {
    const after = await attempt(() => api.fetchTaskAttachments(input.taskId))
    const ids = (after as { data?: Array<{ id: number }> }).data?.map((a) => a.id).sort((a, b) => a - b) ?? []
    if (after.success && ids.length > 0) {
      const tokens = ids.map((id) => imageToken(id)).join('\n')
      await attempt(() => api.updateTask(input.taskId, { description: input.description ? `${input.description}\n${tokens}` : tokens }))
    }
  }

  const outcome: FollowUpOutcome = { queuedLabels: queuedLabels.length, queuedImages: queuedImages.length, dropped }
  if (queuedLabels.length > 0 || queuedImages.length > 0) {
    const queued = await attempt(() => api.queueFollowUps(input.taskId, { labels: queuedLabels, images: queuedImages }, input.title))
    if (!queued.success) outcome.queueError = queued.error ?? 'Could not save offline'
  }
  return outcome
}
