// Collaboration rules shared by the main process and the renderer (docs/cross-app-semantics-v1.md
// section 9, pinned by the `collaboration` vectors of test-fixtures/cross-app-semantics-v1.json).
// The Android app has the same rules in `util/Collaboration.kt`.
//
// Pure and import-free: no Electron, no DOM. Comment HTML is read with a small tokenizer of its own
// so both apps read it the same way, whatever the platform's HTML parser would do.

/** A person as the API returns one: `User` without the fields Vicu does not use. */
export interface CollabUser {
  id: number
  username: string
  name?: string | null
}

// --- People and names ------------------------------------------------------------------------

/** `name`, trimmed, when it is not empty; otherwise the username. */
export function displayName(user: CollabUser): string {
  const name = (user.name ?? '').trim()
  return name || user.username
}

/** You first, then everyone else in the order the server returned them. */
export function orderPeople<T extends CollabUser>(people: readonly T[], me: number | null | undefined): T[] {
  if (me === null || me === undefined) return [...people]
  const mine = people.filter((p) => p.id === me)
  return [...mine, ...people.filter((p) => p.id !== me)]
}

function namesOf(people: readonly CollabUser[], me: number | null | undefined, you: string): string[] {
  return orderPeople(people, me).map((p) => (p.id === me ? you : displayName(p)))
}

/** "You, Maya": the names joined with ", ", you first as "You". */
export function nameList(people: readonly CollabUser[], me: number | null | undefined): string {
  return namesOf(people, me, 'You').join(', ')
}

/** "Visible to you, Maya and Sam"; empty when there is nobody. */
export function visibleToText(people: readonly CollabUser[], me: number | null | undefined): string {
  const names = namesOf(people, me, 'you')
  if (names.length === 0) return ''
  if (names.length === 1) return `Visible to ${names[0]}`
  return `Visible to ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** The accessible name of a row's avatars: "Assigned to you, Maya"; empty when nobody is assigned. */
export function assignedLabel(people: readonly CollabUser[], me: number | null | undefined): string {
  const names = namesOf(people, me, 'you')
  return names.length === 0 ? '' : `Assigned to ${names.join(', ')}`
}

/** The accessible name of the Assign chip: "Assigned: You, Maya", or "Assign" when nobody is assigned. */
export function assignChipLabel(people: readonly CollabUser[], me: number | null | undefined): string {
  return people.length === 0 ? 'Assign' : `Assigned: ${nameList(people, me)}`
}

/** "1 comment", "4 comments", "2 comments, new". */
export function commentCountLabel(count: number, unread: boolean): string {
  return `${count} ${count === 1 ? 'comment' : 'comments'}${unread ? ', new' : ''}`
}

/** The letter of the avatar fallback: the first character of the display name, in upper case. */
export function avatarInitial(user: CollabUser): string {
  const first = Array.from(displayName(user))[0] ?? '?'
  return first.toUpperCase()
}

// --- Sharing and permissions -----------------------------------------------------------------

/** Read only, read and write, admin (`max_permission`, a share's `permission`). */
export type Permission = 0 | 1 | 2

/** A project is shared when its members include someone who is not you (section 9.1). */
export function isSharedProject(memberIds: readonly number[], me: number | null | undefined): boolean {
  if (me === null || me === undefined) return false
  return memberIds.some((id) => id !== me)
}

/** Your permission on a project: archived counts as read only, unknown as read and write. */
export function effectivePermission(maxPermission: number | null | undefined, archived = false): Permission {
  if (archived) return 0
  if (maxPermission === 0 || maxPermission === 1 || maxPermission === 2) return maxPermission
  return 1
}

export interface ProjectNode {
  id: number
  /** 0 for a top-level project. */
  parent: number
  owner: number
}

export interface UserShareEntry {
  user: number
  permission: number
}

export interface TeamShareEntry {
  permission: number
  members: readonly number[]
}

export interface ShareGraph {
  projects: readonly ProjectNode[]
  /** Direct user shares per project id. */
  shares: Readonly<Record<number, readonly UserShareEntry[] | undefined>>
  /** Team shares per project id. */
  teams: Readonly<Record<number, readonly TeamShareEntry[] | undefined>>
}

/** The project and its parents, nearest first. Stops at a missing parent or a cycle. */
export function projectChain(projectId: number, projects: readonly ProjectNode[]): ProjectNode[] {
  const byId = new Map(projects.map((p) => [p.id, p]))
  const chain: ProjectNode[] = []
  const seen = new Set<number>()
  let current = byId.get(projectId)
  while (current && !seen.has(current.id)) {
    chain.push(current)
    seen.add(current.id)
    current = current.parent > 0 ? byId.get(current.parent) : undefined
  }
  return chain
}

/**
 * A member's permission for the "Can view only" note (section 9.1): 2 for the owner of the project
 * or a parent; otherwise the highest direct or team share on the project and its parents; null when
 * nothing is known.
 */
export function memberPermission(projectId: number, userId: number, graph: ShareGraph): number | null {
  const chain = projectChain(projectId, graph.projects)
  if (chain.some((p) => p.owner === userId)) return 2
  let best: number | null = null
  for (const node of chain) {
    for (const share of graph.shares[node.id] ?? []) {
      if (share.user === userId && (best === null || share.permission > best)) best = share.permission
    }
    for (const team of graph.teams[node.id] ?? []) {
      if (team.members.includes(userId) && (best === null || team.permission > best)) best = team.permission
    }
  }
  return best
}

/** Whether a member can be picked in Assign: unknown counts as read and write. */
export function canMemberWrite(permission: number | null): boolean {
  return permission === null || permission >= 1
}

// --- Comment HTML ------------------------------------------------------------------------------

const WORD_CHAR = /[\p{L}\p{Nd}_]/u

/** A letter (any Unicode letter category), a decimal digit or `_`, looked at one UTF-16 unit at a time. */
function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && WORD_CHAR.test(ch)
}

const TRIM_CHARS = new Set([' ', '\t', '\n', '\r', ' '])

function trimStart(text: string): string {
  let i = 0
  while (i < text.length && TRIM_CHARS.has(text[i])) i++
  return text.slice(i)
}

function trimEnd(text: string): string {
  let i = text.length
  while (i > 0 && TRIM_CHARS.has(text[i - 1])) i--
  return text.slice(0, i)
}

function trimBoth(text: string): string {
  return trimEnd(trimStart(text))
}

function escapeHtml(text: string): string {
  let out = ''
  for (const ch of text) {
    if (ch === '&') out += '&amp;'
    else if (ch === '<') out += '&lt;'
    else if (ch === '>') out += '&gt;'
    else if (ch === '"') out += '&quot;'
    else out += ch
  }
  return out
}

function attachmentHtml(attachment: CommentAttachment): string {
  const url = escapeHtml(attachment.url)
  const name = escapeHtml(attachment.name)
  return attachment.image ? `<img src="${url}" alt="${name}">` : `<p><a href="${url}">${name}</a></p>`
}

/**
 * The HTML a comment is sent as (section 9.5): one paragraph, `<br>` for line breaks, escaped
 * text, each `@username` of a member as a `mention-user` element so the server notifies them, and
 * then the attachments. Empty when there is nothing to send.
 */
export function encodeCommentHtml(text: string, members: readonly CollabUser[], attachments: readonly CommentAttachment[] = []): string {
  return encodeCommentText(text, members) + attachments.map(attachmentHtml).join('')
}

/** Where a comment points at an attachment (section 9.5; `v1` is what the web app recognises). */
export function commentAttachmentAddress(server: string, taskId: number, attachmentId: number): string {
  return `${server.replace(/\/+$/, '')}/api/v1/tasks/${taskId}/attachments/${attachmentId}`
}

const INLINE_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

/** Whether a file of this type goes into a comment as an image: the ones every browser can show. */
export function isInlineImageType(mimeType: string): boolean {
  return INLINE_IMAGE_TYPES.has(mimeType.split(';')[0].trim().toLowerCase())
}

/** The attachment of `taskId` that `address` points at, or null when it points at anything else. */
function attachmentIdIn(address: string | undefined, taskId: number | undefined): number | null {
  if (address === undefined || taskId === undefined) return null
  const match = /\/tasks\/(\d+)\/attachments\/(\d+)(?:[?#].*)?$/.exec(address)
  if (!match || Number(match[1]) !== taskId) return null
  const id = Number(match[2])
  return Number.isSafeInteger(id) ? id : null
}

function encodeCommentText(text: string, members: readonly CollabUser[]): string {
  const normalized = trimBoth(text.replace(/\r\n?/g, '\n'))
  if (!normalized) return ''
  // Longest username first; equal lengths keep the members' order (sort is stable).
  const candidates = members.filter((m) => m.username.length > 0).sort((a, b) => b.username.length - a.username.length)
  let out = ''
  let i = 0
  while (i < normalized.length) {
    const ch = normalized[i]
    if (ch === '@' && (i === 0 || !isWordChar(normalized[i - 1]))) {
      const member = candidates.find((m) => {
        const end = i + 1 + m.username.length
        return (
          normalized.slice(i + 1, end).toLowerCase() === m.username.toLowerCase() &&
          (end >= normalized.length || !isWordChar(normalized[end]))
        )
      })
      if (member) {
        const username = escapeHtml(member.username)
        out += `<mention-user data-id="${username}" data-label="${escapeHtml(displayName(member))}">@${username}</mention-user>`
        i += 1 + member.username.length
        continue
      }
    }
    out += ch === '\n' ? '<br>' : escapeHtml(ch)
    i++
  }
  return `<p>${out}</p>`
}

/** A task attachment a comment points at (section 9.5). */
export interface CommentAttachment {
  attachment: number
  /** The `alt` or `title` of an image, the text of a link, trimmed; it can be empty. */
  name: string
  /** An `img`, shown inline; otherwise a link, shown as a file. */
  image: boolean
  /** The address as written, so saving an edit changes nothing about it. */
  url: string
}

export type CommentSegment = { text: string } | { mention: string; label: string } | CommentAttachment

export interface DecodedComment {
  segments: CommentSegment[]
  /** The attachments among the segments, in reading order. */
  attachments: CommentAttachment[]
  /**
   * Only `p`, `br`, `mention-user` and attachments, with nothing after the first attachment but more
   * of them: Vicu can edit it without losing anything.
   */
  plain: boolean
  /** The text the editor starts from (mentions as `@username`); null when the comment is not plain. */
  editText: string | null
}

const NAMED_REFERENCES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

/** Decode the character references section 9.5 names; any other stays as written. */
export function decodeReferences(text: string): string {
  return text.replace(/&(#[0-9]+|#[xX][0-9a-fA-F]+|[A-Za-z]+);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X'
      const code = hex ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return whole
      return String.fromCodePoint(code)
    }
    return NAMED_REFERENCES[body] ?? whole
  })
}

const BLOCK_TAGS = new Set(['p', 'div', 'li', 'blockquote', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
const PLAIN_TAGS = new Set(['p', 'br', 'mention-user'])
const SKIPPED_CONTENT = new Set(['script', 'style'])

interface ParsedTag {
  closing: boolean
  selfClosing: boolean
  name: string
  attrs: Record<string, string>
}

const isAsciiLetter = (ch: string | undefined): boolean => ch !== undefined && /[A-Za-z]/.test(ch)
const isSpace = (ch: string | undefined): boolean => ch !== undefined && /[ \t\n\r\f]/.test(ch)

/** The index of the `>` that ends the tag starting at `start`, outside quoted values; -1 when none. */
function tagEnd(html: string, start: number): number {
  let quote: string | null = null
  for (let i = start + 1; i < html.length; i++) {
    const ch = html[i]
    if (quote) {
      if (ch === quote) quote = null
    } else if (ch === '"' || ch === "'") {
      quote = ch
    } else if (ch === '>') {
      return i
    }
  }
  return -1
}

function parseTag(inner: string): ParsedTag {
  let i = 0
  let closing = false
  if (inner[0] === '/') {
    closing = true
    i = 1
  }
  let name = ''
  while (i < inner.length && /[A-Za-z0-9-]/.test(inner[i])) name += inner[i++]
  const attrs: Record<string, string> = {}
  let selfClosing = false
  while (i < inner.length) {
    const ch = inner[i]
    if (isSpace(ch)) {
      i++
      continue
    }
    if (ch === '/') {
      selfClosing = true
      i++
      continue
    }
    let attrName = ''
    while (i < inner.length && !isSpace(inner[i]) && inner[i] !== '=' && inner[i] !== '/') attrName += inner[i++]
    while (isSpace(inner[i])) i++
    let value = ''
    if (inner[i] === '=') {
      i++
      while (isSpace(inner[i])) i++
      const quote = inner[i]
      if (quote === '"' || quote === "'") {
        const close = inner.indexOf(quote, i + 1)
        const end = close === -1 ? inner.length : close
        value = inner.slice(i + 1, end)
        i = end + 1
      } else {
        while (i < inner.length && !isSpace(inner[i])) value += inner[i++]
      }
    }
    const key = attrName.toLowerCase()
    if (key && !(key in attrs)) attrs[key] = decodeReferences(value)
  }
  return { closing, selfClosing, name: name.toLowerCase(), attrs }
}

/**
 * What a comment shows (section 9.5): text and mentions, line breaks for `<br>` and block ends,
 * everything else as its text. Mentions take the member's display name when the member is known.
 * With `taskId`, the task the comment belongs to, what points at one of its attachments is an
 * attachment; nothing else in a comment is ever fetched.
 */
export function decodeCommentHtml(html: string, members: readonly CollabUser[], taskId?: number): DecodedComment {
  const segments: CommentSegment[] = []
  let plain = true
  let pendingBreak = false
  let wroteAny = false
  let mention: { id: string; label: string; text: string } | null = null
  let fileLink: { attachment: number; url: string; text: string } | null = null

  const pushText = (text: string) => {
    if (!text) return
    const last = segments[segments.length - 1]
    if (last && 'text' in last) last.text += text
    else segments.push({ text })
  }
  const flush = () => {
    if (pendingBreak && wroteAny) pushText('\n')
    pendingBreak = false
  }
  const addAttachment = (attachment: CommentAttachment) => {
    // The line breaks around an attachment are its own place in the comment.
    pendingBreak = false
    segments.push(attachment)
    wroteAny = true
  }
  const finishFileLink = () => {
    if (!fileLink) return
    const link = fileLink
    fileLink = null
    addAttachment({ attachment: link.attachment, name: trimBoth(link.text), image: false, url: link.url })
  }
  const appendText = (raw: string) => {
    if (mention) {
      mention.text += raw
      return
    }
    if (fileLink) {
      fileLink.text += raw
      return
    }
    const text = raw.replace(/\r\n|\r|\n/g, ' ')
    if (!text) return
    if (pendingBreak && trimBoth(text) === '') return
    flush()
    pushText(text)
    wroteAny = true
  }
  const finishMention = () => {
    if (!mention) return
    const current = mention
    mention = null
    const id = current.id.trim()
    if (!id) {
      appendText(current.text)
      return
    }
    const member = members.find((m) => m.username.toLowerCase() === id.toLowerCase())
    const fromText = trimBoth(current.text).replace(/^@+/, '')
    const label = member ? displayName(member) : current.label.trim() || fromText || id
    flush()
    segments.push({ mention: id, label })
    wroteAny = true
  }

  let i = 0
  const n = html.length
  while (i < n) {
    const ch = html[i]
    if (ch === '<') {
      if (html.startsWith('<!--', i)) {
        const end = html.indexOf('-->', i + 4)
        i = end === -1 ? n : end + 3
        continue
      }
      const next = html[i + 1]
      if (next === '!') {
        const end = html.indexOf('>', i)
        i = end === -1 ? n : end + 1
        continue
      }
      if (next === '/' || isAsciiLetter(next)) {
        const end = tagEnd(html, i)
        if (end === -1) {
          appendText(decodeReferences(html.slice(i)))
          break
        }
        const tag = parseTag(html.slice(i + 1, end))
        i = end + 1
        if (!tag.name) continue
        if (fileLink) {
          if (tag.name === 'a' && tag.closing) finishFileLink()
          else if (!PLAIN_TAGS.has(tag.name)) plain = false
          continue
        }
        if (!mention && !tag.closing) {
          if (tag.name === 'img') {
            const url = tag.attrs['data-src'] || tag.attrs['src']
            const id = attachmentIdIn(url, taskId)
            if (id !== null) {
              addAttachment({ attachment: id, name: trimBoth(tag.attrs['alt'] ?? '') || trimBoth(tag.attrs['title'] ?? ''), image: true, url })
              continue
            }
          }
          if (tag.name === 'a') {
            const url = tag.attrs['href']
            const id = attachmentIdIn(url, taskId)
            if (id !== null) {
              fileLink = { attachment: id, url, text: '' }
              if (tag.selfClosing) finishFileLink()
              continue
            }
          }
        }
        if (!PLAIN_TAGS.has(tag.name)) plain = false
        if (!tag.closing && SKIPPED_CONTENT.has(tag.name)) {
          const close = html.toLowerCase().indexOf(`</${tag.name}`, i)
          if (close === -1) {
            i = n
          } else {
            const closeEnd = html.indexOf('>', close)
            i = closeEnd === -1 ? n : closeEnd + 1
          }
          continue
        }
        if (tag.name === 'mention-user') {
          if (tag.closing) finishMention()
          else {
            finishMention()
            mention = { id: tag.attrs['data-id'] ?? '', label: tag.attrs['data-label'] ?? '', text: '' }
            if (tag.selfClosing) finishMention()
          }
          continue
        }
        if (mention) continue
        if (tag.name === 'br') {
          if (!tag.closing) {
            flush()
            pushText('\n')
            wroteAny = true
          }
          continue
        }
        if (tag.closing && BLOCK_TAGS.has(tag.name)) pendingBreak = true
        continue
      }
    }
    let j = html.indexOf('<', ch === '<' ? i + 1 : i)
    if (j === -1) j = n
    appendText(decodeReferences(html.slice(i, j)))
    i = j
  }
  finishMention()
  finishFileLink()

  // Text next to an attachment loses its spaces and line breaks on that side.
  const isAttachment = (s: CommentSegment | undefined): boolean => s !== undefined && 'attachment' in s
  for (let index = segments.length - 1; index >= 0; index--) {
    const segment = segments[index]
    if (!('text' in segment)) continue
    if (isAttachment(segments[index - 1])) segment.text = trimStart(segment.text)
    if (isAttachment(segments[index + 1])) segment.text = trimEnd(segment.text)
    if (!segment.text) segments.splice(index, 1)
  }
  // Trim the ends across segments: a text segment at either end loses its spaces and line breaks.
  const first = segments[0]
  if (first && 'text' in first) {
    first.text = trimStart(first.text)
    if (!first.text) segments.shift()
  }
  const last = segments[segments.length - 1]
  if (last && 'text' in last) {
    last.text = trimEnd(last.text)
    if (!last.text) segments.pop()
  }

  // An edit puts the attachments back after the text, so only that order can be edited.
  const firstAttachment = segments.findIndex((s) => 'attachment' in s)
  if (firstAttachment !== -1 && segments.slice(firstAttachment).some((s) => !('attachment' in s))) plain = false

  const attachments = segments.filter((s): s is CommentAttachment => 'attachment' in s)
  const editText = plain ? segments.map((s) => ('text' in s ? s.text : 'mention' in s ? `@${s.mention}` : '')).join('') : null
  return { segments, attachments, plain, editText }
}

/** The comment as plain text, mentions as "@" and the label: for previews and search. */
export function commentPlainText(html: string, members: readonly CollabUser[]): string {
  return decodeCommentHtml(html, members)
    .segments.map((s) => ('text' in s ? s.text : 'label' in s ? `@${s.label}` : ''))
    .join('')
}

// --- Mention suggestions -----------------------------------------------------------------------

export interface MentionQuery {
  /** What follows the `@`, as typed. */
  query: string
  /** The index of the `@`. */
  start: number
}

/** The mention being typed at the caret, or null (section 9.5). */
export function mentionQueryAt(text: string, caret: number): MentionQuery | null {
  const before = text.slice(0, Math.max(0, Math.min(caret, text.length)))
  const at = before.lastIndexOf('@')
  if (at === -1) return null
  const query = before.slice(at + 1)
  if (/\s/.test(query)) return null
  if (at > 0 && !/\s/.test(before[at - 1])) return null
  return { query, start: at }
}

/** Members other than you whose username, display name or a word of it starts with the query. */
export function mentionSuggestions<T extends CollabUser>(query: string, members: readonly T[], me: number | null | undefined): T[] {
  const q = query.toLowerCase()
  return members.filter((m) => {
    if (m.id === me) return false
    if (m.username.toLowerCase().startsWith(q)) return true
    const name = displayName(m).toLowerCase()
    return name.startsWith(q) || name.split(/\s+/).some((word) => word.startsWith(q))
  })
}

/** Replace `@query` with `@username ` and put the caret after the space. */
export function applyMention(text: string, caret: number, mention: MentionQuery, username: string): { text: string; caret: number } {
  const insert = `@${username} `
  return {
    text: text.slice(0, mention.start) + insert + text.slice(Math.max(caret, mention.start)),
    caret: mention.start + insert.length,
  }
}

// --- Edited ----------------------------------------------------------------------------------

function parseInstant(value: string | null | undefined): number {
  if (!value) return NaN
  // The server writes up to nine fraction digits; Date.parse wants at most three.
  return Date.parse(value.replace(/(\.\d{3})\d+/, '$1'))
}

/** A comment is edited when `updated` is at least one second after `created`. */
export function isCommentEdited(created: string | null | undefined, updated: string | null | undefined): boolean {
  const c = parseInstant(created)
  const u = parseInstant(updated)
  if (!Number.isFinite(c) || !Number.isFinite(u)) return false
  return u - c >= 1000
}
