import { describe, expect, it } from 'vitest'
import { getSchema } from '@tiptap/core'
import { StarterKit } from '@tiptap/starter-kit'
import { TaskList } from '@tiptap/extension-task-list'
import { TaskItem } from '@tiptap/extension-task-item'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import type { Node } from '@tiptap/pm/model'
import { canMoveListItem, isInListItem, moveListItem } from './move-list-item'

const schema = getSchema([StarterKit, TaskList, TaskItem.configure({ nested: true })])

const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const item = (text: string, ...nested: unknown[]) => ({
  type: 'listItem',
  content: [paragraph(text), ...nested],
})
const bullets = (...items: unknown[]) => ({ type: 'bulletList', content: items })
const tasks = (...texts: string[]) => ({
  type: 'taskList',
  content: texts.map((text) => ({ type: 'taskItem', attrs: { checked: false }, content: [paragraph(text)] })),
})

/** A state with the cursor inside the text [word]. */
function stateAt(word: string, ...content: unknown[]): EditorState {
  const doc = schema.nodeFromJSON({ type: 'doc', content })
  let pos = -1
  doc.descendants((node, at) => {
    if (node.isText && node.text?.includes(word)) pos = at + 1
  })
  expect(pos).toBeGreaterThan(-1)
  return EditorState.create({ doc, selection: TextSelection.create(doc, pos) })
}

const texts = (doc: Node) => {
  const found: string[] = []
  doc.descendants((node) => {
    if (node.isText && node.text) found.push(node.text)
  })
  return found
}

const cursorText = (state: EditorState) => state.selection.$from.parent.textContent

describe('moveListItem', () => {
  it('moves a line down and keeps the cursor on it', () => {
    const tr = moveListItem(stateAt('a', bullets(item('a'), item('b'), item('c'))), 1)!
    expect(texts(tr.doc)).toEqual(['b', 'a', 'c'])
    expect(tr.selection.$from.parent.textContent).toBe('a')
    expect(tr.selection.$from.parentOffset).toBe(1)
  })

  it('moves a line up and keeps the cursor on it', () => {
    const tr = moveListItem(stateAt('c', bullets(item('a'), item('b'), item('c'))), -1)!
    expect(texts(tr.doc)).toEqual(['a', 'c', 'b'])
    expect(tr.selection.$from.parent.textContent).toBe('c')
  })

  it('moves checklist lines', () => {
    const tr = moveListItem(stateAt('two', tasks('one', 'two')), -1)!
    expect(texts(tr.doc)).toEqual(['two', 'one'])
  })

  it('takes nested lines along', () => {
    const state = stateAt('a', bullets(item('a', bullets(item('nested'))), item('b')))
    expect(texts(moveListItem(state, 1)!.doc)).toEqual(['b', 'a', 'nested'])
  })

  it('moves a nested line within its own list', () => {
    const state = stateAt('y', bullets(item('a', bullets(item('x'), item('y'))), item('b')))
    expect(texts(moveListItem(state, -1)!.doc)).toEqual(['a', 'y', 'x', 'b'])
    expect(canMoveListItem(state, 1)).toBe(false)
  })

  it('stops at the ends of the list', () => {
    const list = bullets(item('a'), item('b'))
    expect(canMoveListItem(stateAt('a', list), -1)).toBe(false)
    expect(moveListItem(stateAt('a', list), -1)).toBeNull()
    expect(moveListItem(stateAt('b', list), 1)).toBeNull()
  })

  it('leaves plain text alone', () => {
    const state = stateAt('plain', paragraph('plain'), paragraph('other'))
    expect(isInListItem(state)).toBe(false)
    expect(moveListItem(state, 1)).toBeNull()
    expect(cursorText(state)).toBe('plain')
  })
})
