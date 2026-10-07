import type { CreateExtras } from './offline-mutations'
import type { Label } from './vikunja-types'

// What the new-task composer hands to the offline queue when its create cannot reach the server:
// the labels the user picked or typed, the images pasted into the notes and the files attached. The
// queue keeps them with the create and applies them once the task exists.

const PENDING_TOKEN = /\[\[image-pending:[a-z0-9-]+\]\]\n?/g

/** Remove placeholders for images that were not uploaded; the queue appends the real tokens after uploading. */
export function stripPendingImageTokens(description: string): string {
  return description.replace(PENDING_TOKEN, '')
}

export interface ComposerAttachment {
  name: string
  mime: string
  bytes: Uint8Array
  /** Set for an image pasted into the notes (it has a placeholder in the description). */
  pendingToken?: string
}

export interface ComposerExtrasInput {
  explicitLabels: readonly Label[]
  parsedLabelNames: readonly string[]
  knownLabels: readonly Label[]
  attachments: readonly ComposerAttachment[]
  description: string
}

export function buildCreateExtras(input: ComposerExtrasInput): CreateExtras & { queuedDescription?: string } {
  const labels: Array<{ id?: number; title?: string }> = []
  const display: Label[] = []
  const seen = new Set<string>()
  const add = (found: Label | undefined, name: string) => {
    const key = (found?.title ?? name).toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    if (found) {
      labels.push({ id: found.id, title: found.title })
      display.push(found)
    } else {
      labels.push({ title: name })
    }
  }
  for (const label of input.explicitLabels) add(label, label.title)
  for (const name of input.parsedLabelNames) {
    add(input.knownLabels.find((label) => label.title.toLowerCase() === name.toLowerCase()), name)
  }

  const images = input.attachments.map((attachment) => ({
    name: attachment.name,
    mime: attachment.mime,
    bytes: attachment.bytes,
    ...(attachment.pendingToken ? {} : { inline: false }),
  }))

  const stripped = stripPendingImageTokens(input.description)
  return {
    ...(labels.length > 0 ? { labels } : {}),
    ...(display.length > 0 ? { displayLabels: display } : {}),
    ...(images.length > 0 ? { images } : {}),
    ...(stripped !== input.description ? { queuedDescription: stripped } : {}),
  }
}
