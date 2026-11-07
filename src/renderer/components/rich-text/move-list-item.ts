import { Extension } from '@tiptap/core'
import { TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state'

/**
 * Moves the list or checklist line under the cursor past its neighbour, within the same list. A line
 * takes its nested lines with it, and plain paragraphs have nothing to move.
 */

export type MoveDirection = -1 | 1

const LIST_ITEMS = new Set(['listItem', 'taskItem'])

function listItemAtCursor(state: EditorState) {
  const { $from } = state.selection
  for (let depth = $from.depth; depth > 0; depth--) {
    if (LIST_ITEMS.has($from.node(depth).type.name)) {
      return {
        node: $from.node(depth),
        start: $from.before(depth),
        list: $from.node(depth - 1),
        index: $from.index(depth - 1),
      }
    }
  }
  return null
}

export function isInListItem(state: EditorState): boolean {
  return listItemAtCursor(state) !== null
}

export function canMoveListItem(state: EditorState, direction: MoveDirection): boolean {
  const item = listItemAtCursor(state)
  if (!item) return false
  const target = item.index + direction
  return target >= 0 && target < item.list.childCount
}

/** The change that moves the line, keeping the cursor on it; null when it cannot move that way. */
export function moveListItem(state: EditorState, direction: MoveDirection): Transaction | null {
  if (!canMoveListItem(state, direction)) return null
  const { node, start, list, index } = listItemAtCursor(state)!
  const end = start + node.nodeSize
  const neighbour = list.child(index + direction)
  const shift = direction * neighbour.nodeSize
  const { from, to } = state.selection
  const tr = state.tr
  if (direction < 0) {
    tr.delete(start, end).insert(start - neighbour.nodeSize, node)
  } else {
    tr.insert(end + neighbour.nodeSize, node).delete(start, end)
  }
  return tr.setSelection(TextSelection.create(tr.doc, from + shift, to + shift)).scrollIntoView()
}

/** Alt+Up and Alt+Down, the keys behind the bubble menu's Move buttons. */
export const MoveListItem = Extension.create({
  name: 'moveListItem',
  addKeyboardShortcuts() {
    const run = (direction: MoveDirection) => {
      const { state, view } = this.editor
      if (!isInListItem(state)) return false
      const tr = moveListItem(state, direction)
      if (tr) view.dispatch(tr)
      return true
    }
    return {
      'Alt-ArrowUp': () => run(-1),
      'Alt-ArrowDown': () => run(1),
    }
  },
})
