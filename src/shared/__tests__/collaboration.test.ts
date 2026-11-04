import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  applyMention,
  assignChipLabel,
  assignedLabel,
  avatarInitial,
  commentAttachmentAddress,
  commentCountLabel,
  decodeCommentHtml,
  effectivePermission,
  encodeCommentHtml,
  isCommentEdited,
  isInlineImageType,
  isSharedProject,
  memberPermission,
  mentionQueryAt,
  mentionSuggestions,
  nameList,
  visibleToText,
  type CollabUser,
  type CommentAttachment,
  type CommentSegment,
  type ShareGraph,
} from '../collaboration'

// The `collaboration` vectors of test-fixtures/cross-app-semantics-v1.json (contract section 9).
// Android runs the same file in CollaborationFixtureTest.

interface Fixture {
  collaboration: {
    shared: { name: string; me: number; members: number[]; expect: boolean }[]
    memberPermission: {
      projects: { id: number; parent: number; owner: number }[]
      shares: Record<string, { user: number; permission: number }[]>
      teams: Record<string, { permission: number; members: number[] }[]>
      vectors: { name: string; project: number; user: number; expect: number | null }[]
    }
    names: {
      name: string
      me: number
      people: CollabUser[]
      expect: { list: string; visibleTo: string; assigned: string; chip: string }
    }[]
    countLabel: { count: number; unread: boolean; expect: string }[]
    encode: { members: CollabUser[]; vectors: { name: string; text: string; expect: string }[] }
    decode: {
      members: CollabUser[]
      vectors: { name: string; html: string; segments: CommentSegment[]; plain: boolean; editText: string | null }[]
    }
    attachments: {
      task: number
      members: CollabUser[]
      address: { name: string; server: string; task: number; attachment: number; expect: string }[]
      inlineTypes: { type: string; expect: boolean }[]
      encode: { name: string; text: string; attachments: CommentAttachment[]; expect: string }[]
      decode: { name: string; html: string; segments: CommentSegment[]; plain: boolean; editText: string | null }[]
    }
    mention: {
      me: number
      members: CollabUser[]
      vectors: {
        name: string
        text: string
        caret: number
        query: string | null
        suggestions: string[]
        pick?: string
        pickedText?: string
        pickedCaret?: number
      }[]
    }
    edited: { name: string; created: string; updated: string; expect: boolean }[]
  }
}

const fixture = JSON.parse(
  readFileSync(join(process.cwd(), 'test-fixtures', 'cross-app-semantics-v1.json'), 'utf8'),
) as Fixture
const c = fixture.collaboration

describe('collaboration: shared projects', () => {
  for (const v of c.shared) {
    it(v.name, () => expect(isSharedProject(v.members, v.me)).toBe(v.expect))
  }
  it('is never shared without a signed-in user', () => {
    expect(isSharedProject([1, 2], null)).toBe(false)
  })
})

describe('collaboration: member permission', () => {
  const graph: ShareGraph = {
    projects: c.memberPermission.projects,
    shares: Object.fromEntries(Object.entries(c.memberPermission.shares).map(([k, v]) => [Number(k), v])),
    teams: Object.fromEntries(Object.entries(c.memberPermission.teams).map(([k, v]) => [Number(k), v])),
  }
  for (const v of c.memberPermission.vectors) {
    it(v.name, () => expect(memberPermission(v.project, v.user, graph)).toBe(v.expect))
  }
  it('stops at a cycle in the project tree', () => {
    const cyclic: ShareGraph = {
      projects: [
        { id: 1, parent: 2, owner: 9 },
        { id: 2, parent: 1, owner: 9 },
      ],
      shares: { 2: [{ user: 5, permission: 1 }] },
      teams: {},
    }
    expect(memberPermission(1, 5, cyclic)).toBe(1)
  })
})

describe('collaboration: names', () => {
  for (const v of c.names) {
    it(v.name, () => {
      expect(nameList(v.people, v.me)).toBe(v.expect.list)
      expect(visibleToText(v.people, v.me)).toBe(v.expect.visibleTo)
      expect(assignedLabel(v.people, v.me)).toBe(v.expect.assigned)
      expect(assignChipLabel(v.people, v.me)).toBe(v.expect.chip)
    })
  }
  for (const v of c.countLabel) {
    it(`count ${v.count}${v.unread ? ' unread' : ''}`, () => expect(commentCountLabel(v.count, v.unread)).toBe(v.expect))
  }
  it('takes the avatar letter from the display name', () => {
    expect(avatarInitial({ id: 1, username: 'maya', name: ' maya lee' })).toBe('M')
    expect(avatarInitial({ id: 2, username: 'éa', name: '' })).toBe('É')
  })
})

describe('collaboration: your permission', () => {
  it('reads max_permission, archived as read only, unknown as write', () => {
    expect(effectivePermission(0)).toBe(0)
    expect(effectivePermission(2)).toBe(2)
    expect(effectivePermission(2, true)).toBe(0)
    expect(effectivePermission(undefined)).toBe(1)
    expect(effectivePermission(7)).toBe(1)
  })
})

describe('collaboration: comment HTML from text', () => {
  for (const v of c.encode.vectors) {
    it(v.name, () => expect(encodeCommentHtml(v.text, c.encode.members)).toBe(v.expect))
  }
})

describe('collaboration: text from comment HTML', () => {
  for (const v of c.decode.vectors) {
    it(v.name, () => {
      const decoded = decodeCommentHtml(v.html, c.decode.members)
      expect(decoded.segments).toEqual(v.segments)
      expect(decoded.plain).toBe(v.plain)
      expect(decoded.editText).toBe(v.editText)
    })
  }
  it('round-trips a plain comment through the editor', () => {
    const html = encodeCommentHtml('Hi @maya,\nsee you', c.decode.members)
    const decoded = decodeCommentHtml(html, c.decode.members)
    expect(decoded.plain).toBe(true)
    expect(encodeCommentHtml(decoded.editText ?? '', c.decode.members)).toBe(html)
  })
  it('does not hang on broken markup', () => {
    for (const html of ['<p', '<p class="x', '<mention-user data-id="a"', '<a href=x>y', '<<<>>>', '&#xFFFFFFFF;', '<p>a</p', '</>']) {
      expect(() => decodeCommentHtml(html, [])).not.toThrow()
    }
  })
})

describe('collaboration: attachments in a comment', () => {
  const a = c.attachments
  for (const v of a.address) {
    it(`address: ${v.name}`, () => expect(commentAttachmentAddress(v.server, v.task, v.attachment)).toBe(v.expect))
  }
  for (const v of a.inlineTypes) {
    it(`inline type: ${v.type || 'none'}`, () => expect(isInlineImageType(v.type)).toBe(v.expect))
  }
  for (const v of a.encode) {
    it(`encode: ${v.name}`, () => expect(encodeCommentHtml(v.text, a.members, v.attachments)).toBe(v.expect))
  }
  for (const v of a.decode) {
    it(`decode: ${v.name}`, () => {
      const decoded = decodeCommentHtml(v.html, a.members, a.task)
      expect(decoded.segments).toEqual(v.segments)
      expect(decoded.plain).toBe(v.plain)
      expect(decoded.editText).toBe(v.editText)
    })
  }
  for (const v of a.decode.filter((vector) => vector.plain)) {
    it(`an edit keeps the attachments as they were: ${v.name}`, () => {
      const decoded = decodeCommentHtml(v.html, a.members, a.task)
      const again = encodeCommentHtml(decoded.editText ?? '', a.members, decoded.attachments)
      const reread = decodeCommentHtml(again, a.members, a.task)
      expect(reread.segments).toEqual(decoded.segments)
      expect(reread.plain).toBe(true)
    })
  }
  it('without the task nothing is an attachment', () => {
    const decoded = decodeCommentHtml('<p>a</p><img src="/api/v1/tasks/7/attachments/3">', [])
    expect(decoded.segments).toEqual([{ text: 'a' }])
    expect(decoded.attachments).toEqual([])
    expect(decoded.plain).toBe(false)
  })
})

describe('collaboration: mention suggestions', () => {
  const { me, members } = c.mention
  for (const v of c.mention.vectors) {
    it(v.name, () => {
      const query = mentionQueryAt(v.text, v.caret)
      expect(query?.query ?? null).toBe(v.query)
      const suggestions = query ? mentionSuggestions(query.query, members, me).map((m) => m.username) : []
      expect(suggestions).toEqual(v.suggestions)
      if (v.pick && query) {
        expect(applyMention(v.text, v.caret, query, v.pick)).toEqual({ text: v.pickedText, caret: v.pickedCaret })
      }
    })
  }
})

describe('collaboration: edited', () => {
  for (const v of c.edited) {
    it(v.name, () => expect(isCommentEdited(v.created, v.updated)).toBe(v.expect))
  }
})
