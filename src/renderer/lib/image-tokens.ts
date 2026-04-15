export type ImageToken =
  | { kind: 'image'; attachmentId: number; raw: string }
  | { kind: 'pending'; uuid: string; raw: string }

const PENDING_RE = /\[\[image-pending:([a-z0-9-]+)\]\]/g

/** Find all image/pending tokens in a description string, in order of appearance. */
export function findImageTokens(text: string): ImageToken[] {
  const combined = /\[\[image:(\d+)\]\]|\[\[image-pending:([a-z0-9-]+)\]\]/g
  const tokens: ImageToken[] = []
  for (const m of text.matchAll(combined)) {
    if (m[1] !== undefined) {
      tokens.push({ kind: 'image', attachmentId: Number(m[1]), raw: m[0] })
    } else if (m[2] !== undefined) {
      tokens.push({ kind: 'pending', uuid: m[2], raw: m[0] })
    }
  }
  return tokens
}

/** Split text into a sequence of plain-text and token segments for rendering. */
export type Segment =
  | { kind: 'text'; text: string }
  | { kind: 'image'; attachmentId: number }
  | { kind: 'pending'; uuid: string }

export function segmentDescription(text: string): Segment[] {
  const segments: Segment[] = []
  const combined = /\[\[image:(\d+)\]\]|\[\[image-pending:([a-z0-9-]+)\]\]/g
  let lastIndex = 0
  for (const m of text.matchAll(combined)) {
    const start = m.index ?? 0
    if (start > lastIndex) {
      segments.push({ kind: 'text', text: text.slice(lastIndex, start) })
    }
    if (m[1] !== undefined) {
      segments.push({ kind: 'image', attachmentId: Number(m[1]) })
    } else if (m[2] !== undefined) {
      segments.push({ kind: 'pending', uuid: m[2] })
    }
    lastIndex = start + m[0].length
  }
  if (lastIndex < text.length) {
    segments.push({ kind: 'text', text: text.slice(lastIndex) })
  }
  return segments
}

/** Insert a token at a cursor position in text. */
export function insertTokenAt(text: string, cursor: number, token: string): string {
  const before = text.slice(0, cursor)
  const after = text.slice(cursor)
  const needsLeadingNewline = before.length > 0 && !before.endsWith('\n')
  const needsTrailingNewline = after.length > 0 && !after.startsWith('\n')
  return (
    before +
    (needsLeadingNewline ? '\n' : '') +
    token +
    (needsTrailingNewline ? '\n' : '') +
    after
  )
}

/** Replace pending tokens with real image tokens based on a mapping. */
export function replacePendingTokens(text: string, mapping: Record<string, number>): string {
  return text.replace(PENDING_RE, (full, uuid) => {
    const id = mapping[uuid]
    return id == null ? full : `[[image:${id}]]`
  })
}

export function imageToken(attachmentId: number): string {
  return `[[image:${attachmentId}]]`
}

export function pendingToken(uuid: string): string {
  return `[[image-pending:${uuid}]]`
}
