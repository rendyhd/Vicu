import { Extension, InputRule, wrappingInputRule } from '@tiptap/core'
import { markdownHref } from '@/lib/markdown-input'

/**
 * The typing shortcuts of description format "Markdown input" that StarterKit, TaskItem and
 * Link do not have themselves:
 *
 * - `1) ` starts a numbered list (StarterKit only knows `1. `);
 * - `[ ] ` or `[x] ` at the start of a bullet item makes it a checklist item, so `- [ ] ` typed
 *   in one go works (TaskItem only wraps a paragraph);
 * - typing the `)` of `[text](url)` makes a link when the URL qualifies.
 *
 * Undo (Mod+Z right after) puts the typed characters back, as with every input rule.
 */
export const MarkdownShortcuts = Extension.create({
  name: 'markdownShortcuts',

  addInputRules() {
    const { schema } = this.editor
    const rules: InputRule[] = []

    if (schema.nodes.orderedList) {
      rules.push(
        wrappingInputRule({
          find: /^(\d+)\)\s$/,
          type: schema.nodes.orderedList,
          getAttributes: (match) => ({ start: Number(match[1]) }),
          joinPredicate: (match, node) => node.childCount + node.attrs.start === Number(match[1]),
        }),
      )
    }

    rules.push(
      new InputRule({
        find: /^\[([ x])\]\s$/,
        handler: ({ state, range, match, chain }) => {
          const { $from } = state.selection
          const inBulletItem =
            $from.depth >= 3 &&
            $from.parent.type.name === 'paragraph' &&
            $from.node(-1).type.name === 'listItem' &&
            $from.node(-2).type.name === 'bulletList' &&
            $from.index(-1) === 0
          if (!inBulletItem || !schema.nodes.taskList) return null
          chain()
            .deleteRange(range)
            .liftListItem('listItem')
            .toggleTaskList()
            .updateAttributes('taskItem', { checked: match[1] === 'x' })
            .run()
        },
      }),
    )

    const link = schema.marks.link
    if (link) {
      rules.push(
        new InputRule({
          find: /(?:^|\s)(\[([^[\]]+)\]\(([^\s()]+)\))$/,
          handler: ({ state, range, match }) => {
            const href = markdownHref(match[3])
            if (!href) return null
            const start = range.to - match[1].length
            const text = match[2]
            state.tr
              .replaceWith(start, range.to, state.schema.text(text, [link.create({ href })]))
              .removeStoredMark(link)
              .setMeta('preventAutolink', true)
          },
        }),
      )
    }

    return rules
  },
})
