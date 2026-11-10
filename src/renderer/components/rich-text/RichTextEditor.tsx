import { useEffect, useRef, useState } from 'react'
import { useEditor, useEditorState, EditorContent, type Editor } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import { StarterKit } from '@tiptap/starter-kit'
import { TaskList } from '@tiptap/extension-task-list'
import { TaskItem } from '@tiptap/extension-task-item'
import { Placeholder } from '@tiptap/extension-placeholder'
import { ArrowDown, ArrowUp, Bold as BoldIcon, Italic as ItalicIcon, Strikethrough, Underline as UnderlineIcon, Code as CodeIcon, List, ListOrdered, ListChecks, Link2 } from 'lucide-react'
import { cn } from '@/lib/cn'
import { resolveOpenableDescriptionHref } from '@/lib/description-html'
import { DescriptionLink } from '@/components/rich-text/description-link'
import { MarkdownShortcuts } from '@/components/rich-text/markdown-shortcuts'
import { sanitizeTaskHtmlForStorage } from '@/lib/sanitize-html'
import { markdownPasteContent } from '@/lib/markdown-input'
import type { EditorView } from '@tiptap/pm/view'
import { LinkDialog } from '@/components/rich-text/LinkDialog'
import { MoveListItem, canMoveListItem, isInListItem, moveListItem, type MoveDirection } from '@/components/rich-text/move-list-item'

/** How long after Shift+Mod+V a paste counts as "paste as plain text". */
const PLAIN_PASTE_WINDOW_MS = 1000

/**
 * Pasted Markdown becomes notes (description format, "Markdown input"): only text that comes
 * without an HTML version, outside a code block, and not pasted as plain text.
 */
function pasteMarkdown(view: EditorView, event: ClipboardEvent, plainPasteAt: number): boolean {
  const data = event.clipboardData
  if (!data || data.types.includes('text/html') || Date.now() - plainPasteAt < PLAIN_PASTE_WINDOW_MS) return false
  if (view.state.selection.$from.parent.type.spec.code) return false
  const content = markdownPasteContent(data.getData('text/plain'))
  if (!content) return false
  const editor = (view.dom as HTMLElement & { editor?: Editor }).editor
  if (!editor) return false
  event.preventDefault()
  const html = sanitizeTaskHtmlForStorage(content.html)
  editor
    .chain()
    .focus()
    .insertContent(html, content.inline ? undefined : { parseOptions: { preserveWhitespace: false } })
    .run()
  return true
}

interface RichTextEditorProps {
  value: string
  onChange: (html: string) => void
  onBlur?: () => void
  onKeyDown?: (e: KeyboardEvent) => boolean | void
  onPaste?: (e: ClipboardEvent) => boolean | void
  placeholder?: string
  editorRef?: React.MutableRefObject<Editor | null>
  onReady?: (normalizedHtml: string) => void
  autoFocus?: boolean
  className?: string
}

export function RichTextEditor({
  value,
  onChange,
  onBlur,
  onKeyDown,
  onPaste,
  placeholder,
  editorRef,
  onReady,
  autoFocus,
  className,
}: RichTextEditorProps) {
  const onChangeRef = useRef(onChange)
  const onBlurRef = useRef(onBlur)
  const onKeyDownRef = useRef(onKeyDown)
  const onPasteRef = useRef(onPaste)
  const onReadyRef = useRef(onReady)
  onChangeRef.current = onChange
  onBlurRef.current = onBlur
  onKeyDownRef.current = onKeyDown
  onPasteRef.current = onPaste
  onReadyRef.current = onReady

  const plainPasteAt = useRef(0)

  const [linkDialog, setLinkDialog] = useState<{
    open: boolean
    initialUrl: string
    canRemove: boolean
  }>({ open: false, initialUrl: '', canRemove: false })

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: false }),
      DescriptionLink,
      TaskList,
      TaskItem.configure({ nested: true }),
      MoveListItem,
      MarkdownShortcuts,
      Placeholder.configure({ placeholder: placeholder ?? '' }),
    ],
    // Pasted Markdown is converted by pasteMarkdown, by the shared rules; StarterKit's own paste
    // rules would also format `*text*` in HTML pastes and plain-text pastes. Link's rule stays, so
    // a pasted URL is still a link.
    enablePasteRules: ['link'],
    content: sanitizeTaskHtmlForStorage(value),
    autofocus: autoFocus ? 'end' : false,
    editorProps: {
      attributes: {
        class: cn(
          'prose prose-sm dark:prose-invert max-w-none focus:outline-none',
          'min-h-[18px]',
          className,
        ),
      },
      handleKeyDown: (_view, event) => {
        // Shift+paste is "paste as plain text": the paste that follows is not read as Markdown.
        if (event.shiftKey && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') {
          plainPasteAt.current = Date.now()
        }
        const result = onKeyDownRef.current?.(event)
        return result === true
      },
      handlePaste: (view, event) => {
        if (onPasteRef.current?.(event) === true) return true
        return pasteMarkdown(view, event, plainPasteAt.current)
      },
      handleClick: (_view, _pos, event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
          return false
        }
        const target = event.target as HTMLElement | null
        const anchor = target?.closest?.('a')
        if (!anchor || !_view.dom.contains(anchor)) return false
        const href = resolveOpenableDescriptionHref(anchor.getAttribute('href'))
        if (!href) return false
        event.preventDefault()
        void window.api.openDeepLink(href)
        return true
      },
    },
    onUpdate: ({ editor: e }) => {
      onChangeRef.current(sanitizeTaskHtmlForStorage(e.getHTML()))
    },
    onBlur: () => {
      onBlurRef.current?.()
    },
    onCreate: ({ editor: e }) => {
      const sanitized = sanitizeTaskHtmlForStorage(e.getHTML())
      if (sanitized !== e.getHTML()) e.commands.setContent(sanitized, { emitUpdate: false })
      onReadyRef.current?.(sanitized)
    },
  })

  useEffect(() => {
    if (editorRef) editorRef.current = editor
    return () => {
      if (editorRef) editorRef.current = null
    }
  }, [editor, editorRef])

  useEffect(() => {
    if (!editor) return
    // Compare stored forms: replacing the document whenever the editor's own
    // HTML differs only in what the sanitizer drops would reset the text being
    // typed (rendyhd/Vicu#67).
    const sanitized = sanitizeTaskHtmlForStorage(value)
    if (sanitizeTaskHtmlForStorage(editor.getHTML()) !== sanitized) {
      editor.commands.setContent(sanitized, { emitUpdate: false })
    }
  }, [value, editor])

  const listLine = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e && isInListItem(e.state)
        ? { canUp: canMoveListItem(e.state, -1), canDown: canMoveListItem(e.state, 1) }
        : null,
    equalityFn: (a, b) => a?.canUp === b?.canUp && a?.canDown === b?.canDown,
  })

  if (!editor) return null

  const moveLine = (direction: MoveDirection) => {
    const tr = moveListItem(editor.state, direction)
    if (tr) editor.view.dispatch(tr)
  }

  const closeLinkDialog = () => {
    setLinkDialog({ open: false, initialUrl: '', canRemove: false })
  }

  return (
    <>
      <BubbleMenu
        editor={editor}
        className="flex items-center gap-0.5 rounded-popover border border-[var(--border-color)] bg-[var(--bg-primary)] p-1 shadow-md"
      >
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBold().run()}
          active={editor.isActive('bold')}
          title="Bold (Ctrl+B)"
        >
          <BoldIcon className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleItalic().run()}
          active={editor.isActive('italic')}
          title="Italic (Ctrl+I)"
        >
          <ItalicIcon className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleStrike().run()}
          active={editor.isActive('strike')}
          title="Strikethrough"
        >
          <Strikethrough className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          active={editor.isActive('underline')}
          title="Underline"
        >
          <UnderlineIcon className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleCode().run()}
          active={editor.isActive('code')}
          title="Inline code"
        >
          <CodeIcon className="h-3.5 w-3.5" />
        </ToolbarButton>
        <span className="mx-0.5 h-4 w-px bg-[var(--border-color)]" />
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          active={editor.isActive('bulletList')}
          title="Bullet list"
        >
          <List className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          active={editor.isActive('orderedList')}
          title="Numbered list"
        >
          <ListOrdered className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleTaskList().run()}
          active={editor.isActive('taskList')}
          title="Checklist"
        >
          <ListChecks className="h-3.5 w-3.5" />
        </ToolbarButton>
        {listLine && (
          <>
            <ToolbarButton onClick={() => moveLine(-1)} disabled={!listLine.canUp} title="Move line up (Alt+Up)">
              <ArrowUp className="h-3.5 w-3.5" />
            </ToolbarButton>
            <ToolbarButton onClick={() => moveLine(1)} disabled={!listLine.canDown} title="Move line down (Alt+Down)">
              <ArrowDown className="h-3.5 w-3.5" />
            </ToolbarButton>
          </>
        )}
        <span className="mx-0.5 h-4 w-px bg-[var(--border-color)]" />
        <ToolbarButton
          onClick={() => {
            const prev = (editor.getAttributes('link').href as string | undefined) ?? ''
            setLinkDialog({ open: true, initialUrl: prev, canRemove: editor.isActive('link') })
          }}
          active={editor.isActive('link')}
          title="Link"
        >
          <Link2 className="h-3.5 w-3.5" />
        </ToolbarButton>
      </BubbleMenu>
      <EditorContent editor={editor} />
      <LinkDialog
        open={linkDialog.open}
        initialUrl={linkDialog.initialUrl}
        canRemove={linkDialog.canRemove}
        onApply={(url) => {
          editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
          closeLinkDialog()
        }}
        onRemove={() => {
          editor.chain().focus().unsetLink().run()
          closeLinkDialog()
        }}
        onCancel={closeLinkDialog}
      />
    </>
  )
}

interface ToolbarButtonProps {
  onClick: () => void
  active?: boolean
  disabled?: boolean
  title: string
  children: React.ReactNode
}

function ToolbarButton({ onClick, active, disabled, title, children }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onMouseDown={(e) => {
        e.preventDefault()
        if (!disabled) onClick()
      }}
      title={title}
      aria-label={title}
      className={cn(
        'flex h-7 w-7 items-center justify-center rounded-control transition-colors',
        disabled
          ? 'text-[var(--text-secondary)] opacity-40'
          : active
            ? 'bg-accent-blue/15 text-[var(--accent-blue)]'
            : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]',
      )}
    >
      {children}
    </button>
  )
}
